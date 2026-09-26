import express from 'express';
import { z } from 'zod';
import {
  CONTENT_LIMITS,
  CURRENCY_DISPLAYS,
  ROBOTS_DIRECTIVES,
  SHIPPING_DEFAULTS,
  SOCIAL_CHANNELS,
  STORE_DEFAULTS,
  SUPPORTED_LOCALES,
  TAX_DEFAULTS,
} from '../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { adminStoreConfiguration } from '../../serializers/marketingAdmin.js';
import { getStoreConfiguration, updateStoreConfiguration } from '../../services/storeConfigService.js';
import { sendSuccess } from '../../utils/api-response.js';
import { httpUrl, optionalPlainText, plainText } from '../../utils/contentSchemas.js';

/**
 * Super-Admin store settings: one singleton document, edited one typed section at a time.
 *
 * **No credential is accepted anywhere in this router.** There is no field for an SMTP
 * host, password or provider API key, and because every schema here is `.strict()`, a
 * request that tries to introduce one is a 400 rather than a silently stored secret.
 * Runtime secrets stay in the deployment environment (§33).
 *
 * Each section has its own declared schema instead of a generic `key/value` store (§50),
 * so a settings write cannot invent a field, store the wrong type, or exceed a bound. A
 * PATCH is flattened to dotted paths by `updateStoreConfiguration`, so sending one key
 * leaves the rest of the section alone.
 *
 * Two settings change what customers are charged — `shipping` and `tax` — and both are
 * consumed by checkout through the same functions this router writes, with no cache in
 * between. An update therefore takes effect on the next order with no restart (§46), and
 * it never touches an existing order: totals were snapshotted when that order was placed.
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const audit = (r: any, action: string, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor: r.auth!.userId, action, resourceType: 'StoreConfiguration', resourceId: 'STORE', requestId: r.requestId, metadata });

/**
 * Applies one validated section patch.
 *
 * Values equal to what is already stored are not written and not audited, so an admin UI
 * that submits its whole form on every save does not fill the trail with no-ops (§59).
 */
async function applySection(
  r: any,
  s: any,
  section: string | null,
  patch: Record<string, unknown>,
  action = 'SETTINGS_UPDATED',
  extra: Record<string, unknown> = {}
) {
  const current = await getStoreConfiguration();
  const scope: Record<string, any> = (section ? current?.[section] : current) ?? {};
  const fields = Object.keys(patch).filter(key => patch[key] !== undefined && JSON.stringify(scope[key] ?? null) !== JSON.stringify(patch[key] ?? null));
  if (!fields.length) return sendSuccess(s, adminStoreConfiguration(current));
  const updated = await updateStoreConfiguration(section, patch, r.auth!.userId);
  await audit(r, action, { section: section ?? 'store', fields, ...extra });
  return sendSuccess(s, adminStoreConfiguration(updated));
}
const emailField = z.string().trim().toLowerCase().email().max(200);
/** Phone numbers are format-checked, not parsed: digits and separators only. */
const phoneField = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+]?[\d\s()-]{5,40}$/, 'Phone number may contain only digits, spaces and + ( ) - characters.');
/**
 * IANA timezone name, verified against the runtime's own database.
 *
 * This is a *display* timezone. Timestamps are stored in UTC and are never rewritten when
 * it changes, so switching it cannot alter when a historical order was placed (§20).
 */
const timezoneField = z
  .string()
  .trim()
  .max(60)
  .refine(
    value => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Timezone must be a valid IANA timezone name.' }
  );

router.get('/settings', async (r, s, n) => {
  try {
    return sendSuccess(s, adminStoreConfiguration(await getStoreConfiguration()));
  } catch (e) {
    return n(e);
  }
});

/**
 * Store identity.
 *
 * `defaultCurrency` relabels; it never converts. MansooriKart stores every amount in one
 * currency and has no exchange-rate layer, so changing this code changes the symbol a
 * customer sees and nothing about what they are charged (§18).
 */
const storeSchema = z
  .object({
    storeName: plainText(160).optional(),
    legalName: optionalPlainText(200),
    tagline: optionalPlainText(300),
    logoUrl: httpUrl.optional(),
    faviconUrl: httpUrl.optional(),
    defaultCurrency: z.string().trim().toUpperCase().length(3).optional(),
    currencyDisplay: z.enum(CURRENCY_DISPLAYS as [string, ...string[]]).optional(),
    timezone: timezoneField.optional(),
    defaultLocale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]).optional(),
    orderPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(8)
      .regex(/^[A-Z0-9]+$/, 'Order prefix may contain only letters and digits.')
      .optional(),
    lowStockThreshold: z.number().int().min(0).max(STORE_DEFAULTS.maxLowStockThreshold).optional(),
  })
  .strict();
router.patch('/settings/store', validate(storeSchema), (r, s, n) => applySection(r, s, null, r.body).catch(n));
const contactSchema = z
  .object({
    supportEmail: emailField.optional(),
    supportPhone: phoneField.optional(),
    businessEmail: emailField.optional(),
    businessPhone: phoneField.optional(),
    whatsapp: phoneField.optional(),
    addressLine1: optionalPlainText(200),
    addressLine2: optionalPlainText(200),
    city: optionalPlainText(120),
    stateProvince: optionalPlainText(120),
    postalCode: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9\s-]{3,30}$/, 'Postal code may contain only letters, digits, spaces and hyphens.')
      .optional(),
    country: optionalPlainText(120),
    supportHours: optionalPlainText(300),
  })
  .strict();
router.patch('/settings/contact', validate(contactSchema), (r, s, n) => applySection(r, s, 'contact', r.body).catch(n));

/**
 * Social links: the whole list, replaced.
 *
 * One entry per channel, from a closed channel set, with an `http(s)` URL. Replacing the
 * list rather than patching entries keeps "which channels exist" a single decision, and
 * the duplicate-channel check stops two conflicting Instagram URLs from being stored.
 */
const socialSchema = z
  .object({
    links: z
      .array(z.object({ channel: z.enum(SOCIAL_CHANNELS as [string, ...string[]]), url: httpUrl, enabled: z.boolean().default(true) }).strict())
      .max(SOCIAL_CHANNELS.length),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.links.forEach((link, index) => {
      if (seen.has(link.channel))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['links', index, 'channel'], message: `Duplicate channel ${link.channel}.` });
      seen.add(link.channel);
    });
  });
router.patch('/settings/social', validate(socialSchema), (r, s, n) =>
  applySection(r, s, null, { socialLinks: r.body.links }, 'SETTINGS_UPDATED', { section: 'social' }).catch(n)
);

/**
 * Storefront SEO.
 *
 * `robots` is an enum and every URL is scheme-validated, so no value here can carry a
 * newline into a rendered meta tag or a `javascript:` target into a canonical link (§25).
 */
const seoSchema = z
  .object({
    metaTitle: optionalPlainText(CONTENT_LIMITS.maxTitleLength),
    metaDescription: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    metaKeywords: z.array(plainText(60)).max(30).optional(),
    canonicalUrl: httpUrl.optional(),
    robots: z.enum(ROBOTS_DIRECTIVES as [string, ...string[]]).optional(),
    socialImageUrl: httpUrl.optional(),
    openGraphTitle: optionalPlainText(CONTENT_LIMITS.maxTitleLength),
    openGraphDescription: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    twitterHandle: z
      .string()
      .trim()
      .max(60)
      .regex(/^@?[A-Za-z0-9_]{1,15}$/, 'Handle may contain only letters, digits and underscores.')
      .optional(),
  })
  .strict();
router.patch('/settings/seo', validate(seoSchema), (r, s, n) => applySection(r, s, 'seo', r.body).catch(n));
/**
 * Shipping. These numbers are what checkout charges.
 *
 * `orderService` calls `quoteShipping()` with the server's own discounted subtotal and the
 * city from the address the server loaded, so a client can never supply a delivery total
 * (§28). `codEnabled: false` makes checkout refuse Cash on Delivery; it is `true` by
 * default, which is the behaviour MansooriKart already shipped (§73).
 */
const shippingSchema = z
  .object({
    enabled: z.boolean().optional(),
    standardFee: z.number().min(0).max(SHIPPING_DEFAULTS.maxFee).optional(),
    freeShippingEnabled: z.boolean().optional(),
    freeShippingThreshold: z.number().min(0).max(SHIPPING_DEFAULTS.maxThreshold).optional(),
    codEnabled: z.boolean().optional(),
    cityOverrides: z
      .array(z.object({ city: plainText(120), fee: z.number().min(0).max(SHIPPING_DEFAULTS.maxFee) }).strict())
      .max(SHIPPING_DEFAULTS.maxCityOverrides)
      .optional(),
    deliveryEstimate: optionalPlainText(200),
    notes: optionalPlainText(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    const cities = (value.cityOverrides ?? []).map(entry => entry.city.trim().toLowerCase());
    if (new Set(cities).size !== cities.length)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cityOverrides'], message: 'Each city may appear only once.' });
  });
router.patch('/settings/shipping', validate(shippingSchema), (r, s, n) => applySection(r, s, 'shipping', r.body).catch(n));

/**
 * Tax foundation.
 *
 * Disabled by default, which reproduces the pre-Phase-H behaviour exactly: every order
 * was taxed at zero and an unconfigured store still is. There is no jurisdiction engine
 * and no customer-supplied tax input anywhere — `computeTax()` derives the amount from
 * the server's discounted subtotal alone (§29–30).
 */
const taxSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultRate: z.number().min(0).max(TAX_DEFAULTS.maxRate).optional(),
    pricesIncludeTax: z.boolean().optional(),
    displayTaxSeparately: z.boolean().optional(),
    label: plainText(40).optional(),
    taxNumber: z
      .string()
      .trim()
      .max(60)
      .regex(/^[A-Za-z0-9-]{3,60}$/, 'Tax number may contain only letters, digits and hyphens.')
      .optional(),
  })
  .strict();
router.patch('/settings/tax', validate(taxSchema), (r, s, n) => applySection(r, s, 'tax', r.body).catch(n));

/**
 * Invoice presentation.
 *
 * Presentation only: the PDF generator built in an earlier phase remains the single
 * invoice authority, and every figure on an invoice comes from the order's own immutable
 * snapshot. Changing a footer note cannot restate a historical total (§31–32).
 */
const invoiceSchema = z
  .object({
    showLogo: z.boolean().optional(),
    showTaxNumber: z.boolean().optional(),
    footerNote: optionalPlainText(2_000),
    termsNote: optionalPlainText(2_000),
    contactLine: optionalPlainText(300),
  })
  .strict();
router.patch('/settings/invoice', validate(invoiceSchema), (r, s, n) => applySection(r, s, 'invoice', r.body).catch(n));
/**
 * Transactional-email behaviour.
 *
 * Behaviour, not transport. There is no host, port, username, password or API-key field
 * here, and `.strict()` rejects a body that invents one — so a well-meaning operator
 * cannot put an SMTP password in the database through this endpoint (§33). Templates are
 * fixed in code: `brandingHeadline` and `brandingFooter` are plain text, not markup, so
 * there is no place for executable template code either (§34).
 */
const emailSchema = z
  .object({
    fromName: plainText(120).optional(),
    replyTo: emailField.optional(),
    supportEmail: emailField.optional(),
    brandingHeadline: optionalPlainText(200),
    brandingFooter: optionalPlainText(500),
    orderConfirmationEnabled: z.boolean().optional(),
    shippingUpdateEnabled: z.boolean().optional(),
    deliveryEmailEnabled: z.boolean().optional(),
    includeInvoiceLink: z.boolean().optional(),
  })
  .strict();
router.patch('/settings/email', validate(emailSchema), (r, s, n) => applySection(r, s, 'email', r.body).catch(n));

/**
 * Maintenance mode.
 *
 * Turning it on makes public storefront *content* answer 503 with a generic message. It
 * deliberately does not touch `/health`, Super Admin authentication or any admin route:
 * an operator must still be able to sign in and fix the store while it is closed, and a
 * monitor must still be able to see that the process is alive (§38).
 */
const maintenanceSchema = z.object({ maintenanceMode: z.boolean(), maintenanceMessage: plainText(500).optional() }).strict();
router.patch('/settings/maintenance', validate(maintenanceSchema), (r, s, n) =>
  applySection(r, s, null, r.body, r.body.maintenanceMode ? 'MAINTENANCE_MODE_ENABLED' : 'MAINTENANCE_MODE_DISABLED', { section: 'maintenance' }).catch(n)
);
export default router;
