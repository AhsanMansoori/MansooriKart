import { Schema, model, models, type Model } from 'mongoose';

/**
 * A declarative selling-price suggestion rule.
 *
 * A rule turns a supplier cost into a *suggested* MansooriKart selling price. It
 * never writes `Product.price` on its own: an operator previews the effect and then
 * applies it explicitly, and a product whose price an admin has already set by hand
 * (`sellingPriceOverridden`) is left alone. See PRICING_ARCHITECTURE.md.
 *
 * Scope fields are all optional and are ANDed: a rule with `supplier` and `category`
 * matches only products sourced from that supplier in that category. Selection is
 * deterministic — narrower scope wins, then higher `priority`, then the older rule —
 * so the same product and cost always resolve to the same rule.
 *
 * `minimumProfit` is a floor applied after markup, and rounding is applied last and
 * may never push the price below cost plus that floor. A rule can therefore raise a
 * price but never produce a negative margin.
 */
const pricingRuleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 500 },
    /** Scope: supplier this rule applies to, or null for any supplier. */
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    /** Scope: product category name, or null for any category. Matched case-insensitively. */
    category: { type: String, trim: true, maxlength: 160, default: null },
    /** Scope: product brand name, or null for any brand. Matched case-insensitively. */
    brand: { type: String, trim: true, maxlength: 160, default: null },
    /** Scope: inclusive supplier-cost band. Either bound may be omitted. */
    minCost: { type: Number, min: 0, default: null },
    maxCost: { type: Number, min: 0, default: null },
    markupType: { type: String, enum: ['PERCENTAGE', 'FIXED'], required: true },
    /** Percent when markupType is PERCENTAGE (25 means +25%), absolute currency amount when FIXED. */
    markupValue: { type: Number, required: true, min: 0 },
    /** Absolute floor on selling price minus supplier cost, applied after markup. */
    minimumProfit: { type: Number, min: 0, default: null },
    /** NONE keeps the computed value; END_99 lowers to the nearest ...99 without breaking the profit floor. */
    roundingRule: { type: String, enum: ['NONE', 'END_99'], default: 'NONE' },
    /** Tie-breaker within an equally specific scope. Higher wins. */
    priority: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'pricingrules' }
);
// Rule resolution always filters to active rules and orders by priority, so one
// compound index serves the hot path. Scope fields are low-cardinality filters
// applied in memory over that bounded set rather than indexed separately.
pricingRuleSchema.index({ isActive: 1, priority: -1, createdAt: 1 });
pricingRuleSchema.index({ supplier: 1, isActive: 1 });
export const PricingRule: any = (models.PricingRule as Model<any>) || model('PricingRule', pricingRuleSchema);
