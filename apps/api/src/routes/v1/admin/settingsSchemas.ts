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
} from '../../../config/storefront.js';
import { httpUrl, optionalPlainText, plainText } from '../../../utils/contentSchemas.js';

export const emailField = z.string().trim().toLowerCase().email().max(200);
export const phoneField = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+]?[\d\s()-]{5,40}$/, 'Phone number may contain only digits, spaces and + ( ) - characters.');
export const timezoneField = z
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

export const storeSchema = z
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

export const contactSchema = z
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

export const socialSchema = z
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

export const seoSchema = z
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

export const shippingSchema = z
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

export const taxSchema = z
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

export const invoiceSchema = z
  .object({
    showLogo: z.boolean().optional(),
    showTaxNumber: z.boolean().optional(),
    footerNote: optionalPlainText(2_000),
    termsNote: optionalPlainText(2_000),
    contactLine: optionalPlainText(300),
  })
  .strict();

export const emailSchema = z
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

export const maintenanceSchema = z.object({ maintenanceMode: z.boolean(), maintenanceMessage: plainText(500).optional() }).strict();
