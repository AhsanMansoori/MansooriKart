/**
 * The store-configuration authority: one document, read on demand, no cache.
 *
 * Every consumer — checkout, the settings API, the public storefront serializers —
 * goes through this module, so there is exactly one place that decides what an
 * unconfigured store means. Reads are deliberately uncached: the document is a
 * single lookup on a unique key, and reading it per request is what makes an admin
 * settings change take effect immediately with no restart, no cache-invalidation
 * protocol and no window in which two workers disagree about the delivery fee.
 *
 * Shipping and tax live here rather than in `orderService` so that the admin API and
 * checkout cannot drift apart: the numbers an operator configures are the numbers
 * checkout charges, computed by the same two functions.
 */

import { SHIPPING_DEFAULTS, TAX_DEFAULTS } from '../config/storefront.js';
import { StoreConfiguration } from '../models/storeConfiguration.js';

export const STORE_CONFIG_KEY = 'STORE';
const money = (n: number) => Number(n.toFixed(2));

/**
 * Creates the singleton if it is missing and returns it.
 *
 * `$setOnInsert` with `upsert` makes this idempotent, and the unique index on `key`
 * makes it safe under concurrency: if two requests race, one insert wins and the
 * loser's duplicate-key error is answered by re-reading the winner's document. The
 * store can therefore never end up with two active configuration records (§19).
 */
export async function ensureStoreConfiguration(): Promise<any> {
  // The uniqueness guarantee above is the index's, so the (cached) index build is awaited
  // before the first insert rather than assumed to have finished.
  await StoreConfiguration.init();
  const existing = await StoreConfiguration.findOne({ key: STORE_CONFIG_KEY });
  if (existing) return existing;
  try {
    return await StoreConfiguration.findOneAndUpdate(
      { key: STORE_CONFIG_KEY },
      { $setOnInsert: { key: STORE_CONFIG_KEY } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    return await StoreConfiguration.findOne({ key: STORE_CONFIG_KEY });
  }
}

/** The current configuration as a plain object, initialising it on first read. */
export async function getStoreConfiguration(): Promise<any> {
  const document = await ensureStoreConfiguration();
  return typeof document?.toObject === 'function' ? document.toObject() : document;
}

/**
 * Applies a validated patch to one section, or to the root when `section` is null.
 *
 * The patch is flattened to dotted paths so a partial write updates only the keys it
 * names: sending `{ standardFee: 300 }` to the shipping section leaves
 * `freeShippingThreshold` alone instead of resetting the section to defaults. Only
 * keys the route's Zod schema already accepted reach this function, so no caller can
 * reach a field the schema does not declare.
 */
export async function updateStoreConfiguration(section: string | null, patch: Record<string, unknown>, actor?: string): Promise<any> {
  await ensureStoreConfiguration();
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    set[section ? `${section}.${key}` : key] = value;
  }
  if (actor) set.updatedBy = actor;
  const updated = await StoreConfiguration.findOneAndUpdate({ key: STORE_CONFIG_KEY }, Object.keys(set).length ? { $set: set } : {}, { new: true });
  return typeof updated?.toObject === 'function' ? updated.toObject() : updated;
}

/** Normalised shipping settings, falling back to the pre-Phase-H constants. */
export function shippingSettings(config: any) {
  const shipping = config?.shipping ?? {};
  return {
    enabled: shipping.enabled ?? SHIPPING_DEFAULTS.enabled,
    standardFee: typeof shipping.standardFee === 'number' ? shipping.standardFee : SHIPPING_DEFAULTS.standardFee,
    freeShippingEnabled: shipping.freeShippingEnabled ?? SHIPPING_DEFAULTS.freeShippingEnabled,
    freeShippingThreshold: typeof shipping.freeShippingThreshold === 'number' ? shipping.freeShippingThreshold : SHIPPING_DEFAULTS.freeShippingThreshold,
    codEnabled: shipping.codEnabled ?? SHIPPING_DEFAULTS.codEnabled,
    cityOverrides: Array.isArray(shipping.cityOverrides) ? shipping.cityOverrides : [],
  };
}

/**
 * Server-authoritative delivery fee.
 *
 * The order of precedence is fixed: shipping disabled means no charge at all; the
 * free-shipping threshold wins over any city override, because a customer who has
 * earned free delivery must not be charged for living in a surcharge city; otherwise
 * a city override applies if one matches, and the standard fee applies if none does.
 *
 * A frontend-supplied shipping amount is never an input here. The only inputs are the
 * discounted subtotal the server computed and the city on the address the server
 * loaded, which is why a client cannot influence what it is charged for delivery.
 */
export function quoteShipping(config: any, discountedSubtotal: number, city?: string | null): number {
  const settings = shippingSettings(config);
  if (!settings.enabled) return 0;
  if (settings.freeShippingEnabled && settings.freeShippingThreshold >= 0 && discountedSubtotal >= settings.freeShippingThreshold) return 0;
  const normalized = (city ?? '').trim().toLowerCase();
  if (normalized) {
    const override = settings.cityOverrides.find(
      (entry: any) =>
        String(entry?.city ?? '')
          .trim()
          .toLowerCase() === normalized
    );
    if (override && typeof override.fee === 'number') return money(Math.max(0, override.fee));
  }
  return money(Math.max(0, settings.standardFee));
}

/** Normalised tax settings, falling back to "no tax", which is the default. */
export function taxSettings(config: any) {
  const tax = config?.tax ?? {};
  return {
    enabled: tax.enabled ?? TAX_DEFAULTS.enabled,
    defaultRate: typeof tax.defaultRate === 'number' ? tax.defaultRate : TAX_DEFAULTS.defaultRate,
    pricesIncludeTax: tax.pricesIncludeTax ?? TAX_DEFAULTS.pricesIncludeTax,
    displayTaxSeparately: tax.displayTaxSeparately ?? TAX_DEFAULTS.displayTaxSeparately,
    label: tax.label || TAX_DEFAULTS.label,
  };
}

/**
 * Server-authoritative tax amount for a checkout.
 *
 * Zero unless an admin has explicitly enabled tax with a positive rate, which is what
 * preserves the pre-Phase-H behaviour byte for byte on an unconfigured store. When
 * `pricesIncludeTax` is set the result is also zero: inclusive pricing means the tax
 * is already inside the item prices, so adding a line would charge it twice.
 *
 * A customer-supplied tax value is never accepted anywhere; `taxableBase` is the
 * server's own discounted subtotal. Delivery is not taxed.
 */
export function computeTax(config: any, taxableBase: number): number {
  const settings = taxSettings(config);
  if (!settings.enabled || settings.pricesIncludeTax || settings.defaultRate <= 0) return 0;
  return money(Math.max(0, taxableBase) * (settings.defaultRate / 100));
}

/** `true` when cash on delivery may be offered. Default `true` (existing behaviour). */
export function isCashOnDeliveryAllowed(config: any): boolean {
  return shippingSettings(config).codEnabled !== false;
}

/** `true` when the storefront is in maintenance mode. */
export const isMaintenanceMode = (config: any): boolean => Boolean(config?.maintenanceMode);
