import { PricingRule } from '../models/pricingRule.js';
import { SUPPLIER_VALUE_LIMITS } from '../config/dropshipping.js';

/**
 * Selling-price suggestion engine.
 *
 * The rules of the road, restated because the whole module exists to enforce them:
 * a supplier controls their cost and nothing else, MansooriKart controls the selling
 * price, and a price an admin set by hand is never moved by an automated rule. This
 * module therefore only ever *computes* a suggestion. Writing `Product.price` is the
 * caller's explicit act. See PRICING_ARCHITECTURE.md.
 */

export class PricingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

const money = (n: number) => Number(n.toFixed(2));

export interface PricingRuleShape {
  _id?: unknown;
  name?: string;
  supplier?: unknown;
  category?: string | null;
  brand?: string | null;
  minCost?: number | null;
  maxCost?: number | null;
  markupType: 'PERCENTAGE' | 'FIXED';
  markupValue: number;
  minimumProfit?: number | null;
  roundingRule?: 'NONE' | 'END_99' | null;
  priority?: number;
  createdAt?: Date;
}

export interface PriceComputation {
  supplierCost: number;
  /** Price after markup, before the profit floor and rounding. */
  markupPrice: number;
  /** Final suggestion, guaranteed to be at least cost plus any minimum profit. */
  suggestedPrice: number;
  grossUnitMargin: number;
  grossMarginPercent: number;
  appliedMinimumProfit: boolean;
  appliedRounding: boolean;
}

/**
 * Applies one rule to one cost.
 *
 * Order is fixed and documented because operators reconcile these numbers by hand:
 * markup, then the minimum-profit floor, then rounding. Rounding is the only step
 * that can lower the number, and it is skipped when lowering would break the floor,
 * so the result can never fall below cost. A `FIXED` markup of 500 on a cost of 2000
 * yields 2500; `PERCENTAGE` 25 on 2000 also yields 2500.
 */
export function computePrice(supplierCost: number, rule: PricingRuleShape): PriceComputation {
  if (!Number.isFinite(supplierCost) || supplierCost < 0) throw new PricingError('PRICING_COST_INVALID', 'Supplier cost must be a non-negative number.');
  const cost = money(supplierCost);
  const markupPrice = rule.markupType === 'PERCENTAGE' ? money(cost + (cost * rule.markupValue) / 100) : money(cost + rule.markupValue);

  const floor = typeof rule.minimumProfit === 'number' && rule.minimumProfit > 0 ? money(cost + rule.minimumProfit) : cost;
  let price = markupPrice;
  const appliedMinimumProfit = price < floor;
  if (appliedMinimumProfit) price = floor;

  let appliedRounding = false;
  if ((rule.roundingRule ?? 'NONE') === 'END_99') {
    const rounded = roundEnd99(price);
    // Rounding down is cosmetic and must never eat the profit floor; if it would,
    // the unrounded price stands. This is the documented deterministic behaviour.
    if (rounded >= floor) {
      appliedRounding = rounded !== price;
      price = rounded;
    }
  }

  if (price > SUPPLIER_VALUE_LIMITS.maxPrice)
    throw new PricingError('PRICING_PRICE_TOO_LARGE', 'The computed selling price exceeds the maximum allowed price.');

  const grossUnitMargin = money(price - cost);
  return {
    supplierCost: cost,
    markupPrice,
    suggestedPrice: money(price),
    grossUnitMargin,
    grossMarginPercent: price > 0 ? Number(((grossUnitMargin / price) * 100).toFixed(2)) : 0,
    appliedMinimumProfit,
    appliedRounding,
  };
}

/**
 * Lowers a price to the nearest value ending in 99 minor-unit-free form, e.g. 2500 → 2499.
 * A price already below 99 has no ...99 below it, so it is returned unchanged.
 */
function roundEnd99(price: number): number {
  const whole = Math.floor(price);
  if (whole < 99) return money(price);
  const hundreds = Math.floor(whole / 100);
  const candidate = hundreds * 100 - 1;
  // 2500 → 2499; 2450 → 2399 would be a large drop, so prefer the same-hundred
  // ...99 when the value is already above it.
  const sameHundred = hundreds * 100 + 99;
  if (sameHundred <= whole) return sameHundred;
  return candidate;
}

/** How specific a rule's scope is. Higher wins, so supplier+category beats supplier. */
function specificity(rule: PricingRuleShape): number {
  let score = 0;
  if (rule.supplier) score += 8;
  if (rule.category) score += 4;
  if (rule.brand) score += 2;
  if (typeof rule.minCost === 'number' || typeof rule.maxCost === 'number') score += 1;
  return score;
}

const sameText = (a: unknown, b: unknown) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

export interface PricingTarget {
  supplier?: unknown;
  category?: string | null;
  brand?: string | null;
  supplierCost: number;
}

/** True when every populated scope field of `rule` matches `target`. Empty fields match anything. */
export function ruleMatches(rule: PricingRuleShape, target: PricingTarget): boolean {
  if (rule.supplier && !(target.supplier && String(rule.supplier) === String(target.supplier))) return false;
  if (rule.category && !sameText(rule.category, target.category)) return false;
  if (rule.brand && !sameText(rule.brand, target.brand)) return false;
  if (typeof rule.minCost === 'number' && target.supplierCost < rule.minCost) return false;
  if (typeof rule.maxCost === 'number' && target.supplierCost > rule.maxCost) return false;
  return true;
}

/**
 * Picks the one rule that governs a target, deterministically.
 *
 * Precedence is scope specificity first (supplier+category > supplier > category >
 * global), then `priority` descending, then the older rule. Two rules can therefore
 * never tie, and the same inputs always select the same rule — no random selection,
 * and no dependence on the order the driver happened to return documents in.
 */
export function selectRule(rules: PricingRuleShape[], target: PricingTarget): PricingRuleShape | null {
  const candidates = rules.filter(rule => ruleMatches(rule, target));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const bySpecificity = specificity(b) - specificity(a);
    if (bySpecificity !== 0) return bySpecificity;
    const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
    if (byPriority !== 0) return byPriority;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a._id ?? '').localeCompare(String(b._id ?? ''));
  });
  return candidates[0] ?? null;
}

/** Loads every active rule once, so a bulk pricing run does not query per product. */
export async function loadActiveRules(): Promise<PricingRuleShape[]> {
  return (await PricingRule.find({ isActive: true }).sort({ priority: -1, createdAt: 1 }).lean()) as PricingRuleShape[];
}

/** Loads one rule by id and refuses an inactive one, so an operator cannot apply a disabled rule. */
export async function loadRuleById(ruleId: unknown): Promise<PricingRuleShape> {
  const rule = (await PricingRule.findById(ruleId).lean()) as (PricingRuleShape & { isActive?: boolean }) | null;
  if (!rule) throw new PricingError('PRICING_RULE_NOT_FOUND', 'The pricing rule was not found.', 404);
  if (rule.isActive === false) throw new PricingError('PRICING_RULE_INACTIVE', 'The pricing rule is disabled.');
  return rule;
}

/**
 * Margin figures for one price/cost pair.
 *
 * Labelled *gross merchandise margin* on purpose: it is selling price minus supplier
 * cost and nothing else. It excludes shipping, payment fees, returns, refunds and
 * every operating expense, so it is not final business profit. Phase F's finance
 * module remains the authority for that.
 */
export function marginFor(sellingPrice: number | null | undefined, supplierCost: number | null | undefined) {
  const price = typeof sellingPrice === 'number' && Number.isFinite(sellingPrice) ? money(sellingPrice) : null;
  const cost = typeof supplierCost === 'number' && Number.isFinite(supplierCost) ? money(supplierCost) : null;
  if (price === null || cost === null) {
    return { sellingPrice: price, supplierCost: cost, grossUnitMargin: null, grossMarginPercent: null, basis: 'gross merchandise margin' as const };
  }
  const grossUnitMargin = money(price - cost);
  return {
    sellingPrice: price,
    supplierCost: cost,
    grossUnitMargin,
    grossMarginPercent: price > 0 ? Number(((grossUnitMargin / price) * 100).toFixed(2)) : 0,
    basis: 'gross merchandise margin' as const,
  };
}
