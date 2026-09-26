/**
 * Single source of truth for every dropshipping, CSV-import and pricing limit.
 *
 * These values are deliberately centralised rather than sprinkled through route
 * handlers: the staleness threshold that decides whether supplier stock may be
 * trusted, the ingestion bounds that stop one upload from exhausting memory, and
 * the "significant cost change" threshold that decides what is worth auditing
 * must all mean the same thing everywhere they are read.
 */

/** Ingestion bounds. Every one of these is enforced before a row is persisted. */
export const CSV_LIMITS = {
  /** Hard cap on the uploaded body. Enforced by the body parser and re-checked in the service. */
  maxFileBytes: 5 * 1024 * 1024,
  /** Maximum data rows (excluding the header). Larger feeds must be split by the supplier. */
  maxRows: 5_000,
  /** Maximum columns in the header row. */
  maxColumns: 60,
  /** Maximum length of a single header cell. */
  maxHeaderLength: 120,
  /** Maximum length of a single data cell. Longer cells fail their row rather than truncating silently. */
  maxFieldLength: 2_000,
  /** Rows returned by the bounded preview endpoint. */
  previewRows: 20,
  /** Rows written to the database per bulk operation. */
  batchSize: 500,
} as const;

/**
 * Supplier stock is reported by a CSV feed, not by a live API, so it is advisory
 * and can be stale by definition. Anything older than this is flagged rather than
 * silently trusted.
 */
export const SUPPLIER_STOCK_STALE_AFTER_HOURS = 48;

/** At or below this supplier quantity the feed is reported as LOW_STOCK. */
export const SUPPLIER_LOW_STOCK_THRESHOLD = 5;

/** A supplier cost move of at least this percentage is audited individually. */
export const SIGNIFICANT_COST_CHANGE_PERCENT = 10;

/** Upper bounds for money and quantity values accepted from a supplier feed. */
export const SUPPLIER_VALUE_LIMITS = { maxCost: 100_000_000, maxStock: 10_000_000, maxPrice: 100_000_000 } as const;

/** Maximum products touched by one bulk pricing or publication request. */
export const BULK_LIMITS = { maxPricingTargets: 1_000, maxPublishTargets: 200 } as const;

/**
 * Placeholder used when a supplier feed carries no usable image URL.
 *
 * `Product.image` is required, and the import must not invent a remote URL or fetch
 * anything server-side, so an imported row without an image gets this local asset
 * path plus a row warning. The product stays DRAFT until an admin reviews it, which
 * is exactly when a real image should be attached.
 */
export const PLACEHOLDER_IMAGE_URL = '/images/placeholder-product.svg';

/**
 * Category assigned when the supplier feed has no category column mapped.
 *
 * Deliberately visible rather than blank: publication requires a category, so an
 * operator can see at a glance which imported rows still need classifying.
 */
export const DEFAULT_IMPORT_CATEGORY = 'Uncategorized';

/**
 * Supplier availability values that block adding to cart and checking out.
 *
 * Only an explicit OUT_OF_STOCK blocks. `UNKNOWN` does not: a feed that reports no
 * quantity is not evidence of absence, and refusing those orders would make most
 * supplier feeds unsellable. Stale-but-positive stock also does not block — see
 * `isSupplierStockStale`, which flags it for operators instead.
 */
export const BLOCKING_SUPPLIER_AVAILABILITY: readonly string[] = ['OUT_OF_STOCK'];

/**
 * `true` when supplier-reported stock is older than the central threshold, or when
 * no supplier update has ever been recorded. A missing timestamp is treated as
 * stale rather than fresh: the safe answer is "unknown", never "in stock".
 */
export function isSupplierStockStale(updatedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!updatedAt) return true;
  const at = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return true;
  return now.getTime() - at.getTime() > SUPPLIER_STOCK_STALE_AFTER_HOURS * 60 * 60 * 1000;
}

/** Derives feed availability from a reported quantity. `null`/absent means the feed said nothing. */
export function availabilityFor(stock: number | null | undefined): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN' {
  if (typeof stock !== 'number' || !Number.isFinite(stock)) return 'UNKNOWN';
  if (stock <= 0) return 'OUT_OF_STOCK';
  return stock <= SUPPLIER_LOW_STOCK_THRESHOLD ? 'LOW_STOCK' : 'IN_STOCK';
}
