import express from 'express';
import { z } from 'zod';
import { BULK_LIMITS, SUPPLIER_VALUE_LIMITS } from '../../config/dropshipping.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { PricingRule } from '../../models/pricingRule.js';
import { Supplier } from '../../models/supplier.js';
import { applyPricing, previewPricing, type PricingTargetQuery } from '../../services/bulkPricingService.js';
import { PricingError } from '../../services/pricingService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

/**
 * Admin pricing routes (§41).
 *
 * Two related surfaces: the rule book (`/pricing-rules`) and the two operations that use
 * it (`/pricing/preview`, `/pricing/apply`). Keeping preview and apply as separate
 * requests over the same computation is what makes §20 true — an operator sees the exact
 * numbers, then decides — and neither operation ever changes a product's status, so
 * repricing can never publish anything.
 *
 * `createdBy`/`updatedBy` are stamped from the token and rejected as input (§48), and a
 * rule is retired through the explicit disable route rather than by patching a flag, so
 * the audit trail names the decision.
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const noBody = z.object({}).strict();
const money = z.number().min(0).max(SUPPLIER_VALUE_LIMITS.maxPrice);
const fail = (error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) =>
  error instanceof PricingError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);
const meta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNextPage: page * limit < total,
  hasPreviousPage: page > 1,
});

const ruleFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  supplierId: z.string().regex(oid).nullable().optional(),
  category: z.string().trim().min(1).max(160).nullable().optional(),
  brand: z.string().trim().min(1).max(160).nullable().optional(),
  minCost: money.nullable().optional(),
  maxCost: money.nullable().optional(),
  markupType: z.enum(['PERCENTAGE', 'FIXED']),
  markupValue: money,
  minimumProfit: money.nullable().optional(),
  roundingRule: z.enum(['NONE', 'END_99']).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
};
const createRule = z.object(ruleFields).strict();
const patchRule = z
  .object({ ...ruleFields, markupType: ruleFields.markupType.optional(), markupValue: money.optional(), name: ruleFields.name.optional() })
  .strict()
  .refine(body => Object.keys(body).length > 0, { message: 'At least one field is required.' });
const ruleQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    markupType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
/**
 * A pricing target set. Ids, or a supplier/status/fulfillment-type filter — the service
 * refuses a request that selects nothing at all rather than repricing the whole catalog.
 */
const targetBody = z
  .object({
    productIds: z.array(z.string().regex(oid)).min(1).max(BULK_LIMITS.maxPricingTargets).optional(),
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
    ruleId: z.string().regex(oid).optional(),
    /** §19: opt in to move prices an admin set by hand. Off by default, deliberately. */
    includeOverridden: z.boolean().optional(),
  })
  .strict();

const asId = (value: unknown) => (value ? String(value) : null);
const ruleView = (rule: any) => ({
  id: asId(rule._id),
  name: rule.name,
  description: rule.description ?? null,
  supplier: asId(rule.supplier),
  category: rule.category ?? null,
  brand: rule.brand ?? null,
  minCost: rule.minCost ?? null,
  maxCost: rule.maxCost ?? null,
  markupType: rule.markupType,
  markupValue: rule.markupValue,
  minimumProfit: rule.minimumProfit ?? null,
  roundingRule: rule.roundingRule ?? 'NONE',
  priority: rule.priority ?? 0,
  isActive: rule.isActive !== false,
  createdBy: asId(rule.createdBy),
  updatedBy: asId(rule.updatedBy),
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

/** An explicit `null` in a patch clears a scope field, so absence and null are not the same. */
const effective = (body: any, current: any, key: string) => (key in body ? body[key] : (current?.[key] ?? null));
const RULE_KEYS = [
  'name',
  'description',
  'category',
  'brand',
  'minCost',
  'maxCost',
  'markupType',
  'markupValue',
  'minimumProfit',
  'roundingRule',
  'priority',
] as const;
const docFrom = (body: any) => {
  const doc: Record<string, unknown> = {};
  for (const key of RULE_KEYS) if (key in body) doc[key] = body[key];
  if ('supplierId' in body) doc.supplier = body.supplierId ?? null;
  return doc;
};

/**
 * Scope sanity, checked before the write rather than at selection time.
 *
 * An inverted cost band would silently match nothing, and a rule scoped to a supplier
 * that does not exist is dead on arrival; both are operator mistakes worth reporting now.
 * Category and brand stay free text on purpose — a rule may legitimately outlive a
 * renamed category, and rule matching is case-insensitive text anyway.
 */
async function assertRuleScope(body: any, current: any): Promise<void> {
  const min = effective(body, current, 'minCost');
  const max = effective(body, current, 'maxCost');
  if (typeof min === 'number' && typeof max === 'number' && min > max)
    throw new PricingError('PRICING_RULE_COST_BAND_INVALID', 'The minimum cost must not exceed the maximum cost.');
  if (body.supplierId && !(await Supplier.exists({ _id: body.supplierId })))
    throw new PricingError('PRICING_RULE_SUPPLIER_NOT_FOUND', 'The supplier was not found.');
}

/** Rule metadata only — never a product list or a computed price list (§50). */
const ruleAudit = (rule: any) => ({
  name: rule.name,
  supplier: asId(rule.supplier),
  category: rule.category ?? null,
  brand: rule.brand ?? null,
  markupType: rule.markupType,
  markupValue: rule.markupValue,
  minimumProfit: rule.minimumProfit ?? null,
  roundingRule: rule.roundingRule ?? 'NONE',
  priority: rule.priority ?? 0,
  isActive: rule.isActive !== false,
});
const audit = (actor: string, action: string, rule: any, requestId?: string) =>
  AuditLog.create({ actor, action, resourceType: 'PricingRule', resourceId: String(rule._id), requestId, metadata: ruleAudit(rule) });

async function loadRule(id: string): Promise<any> {
  const rule = await PricingRule.findById(id);
  if (!rule) throw new PricingError('PRICING_RULE_NOT_FOUND', 'The pricing rule was not found.', 404);
  return rule;
}

router.post('/pricing-rules', validate(createRule), async (request, response, next) => {
  try {
    await assertRuleScope(request.body, null);
    const rule = await PricingRule.create({ ...docFrom(request.body), createdBy: request.auth!.userId });
    await audit(request.auth!.userId, 'PRICING_RULE_CREATED', rule, request.requestId);
    return sendSuccess(response, ruleView(rule.toObject()), 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.get('/pricing-rules', validate(ruleQuery, 'query'), async (request, response, next) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = {};
    if (query.supplierId) filter.supplier = query.supplierId;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
    if (query.markupType) filter.markupType = query.markupType;
    const [items, total] = await Promise.all([
      // Same order the engine resolves in, so the list reads as the rule book it is.
      PricingRule.find(filter)
        .sort({ priority: -1, createdAt: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      PricingRule.countDocuments(filter),
    ]);
    return sendSuccess(response, items.map(ruleView), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.get('/pricing-rules/:id', validate(idParam, 'params'), async (request, response, next) => {
  try {
    const rule = await PricingRule.findById(request.params.id).lean();
    return rule
      ? sendSuccess(response, ruleView(rule))
      : sendFailure(response, 404, 'PRICING_RULE_NOT_FOUND', 'The pricing rule was not found.', request.requestId);
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.patch('/pricing-rules/:id', validate(idParam, 'params'), validate(patchRule), async (request, response, next) => {
  try {
    const current = await loadRule(String(request.params.id));
    await assertRuleScope(request.body, current);
    const updated = await PricingRule.findByIdAndUpdate(
      request.params.id,
      { $set: { ...docFrom(request.body), updatedBy: request.auth!.userId } },
      { new: true, runValidators: true }
    ).lean();
    await audit(request.auth!.userId, 'PRICING_RULE_UPDATED', updated, request.requestId);
    return sendSuccess(response, ruleView(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/**
 * Retiring and reinstating a rule are their own routes rather than a patched flag, so the
 * audit trail records the decision and a disabled rule can never be selected by the
 * engine (`loadActiveRules` and `loadRuleById` both refuse it).
 */
const setActive = (isActive: boolean, action: string) => async (request: express.Request, response: express.Response, next: express.NextFunction) => {
  try {
    await loadRule(String(request.params.id));
    const updated = await PricingRule.findByIdAndUpdate(request.params.id, { $set: { isActive, updatedBy: request.auth!.userId } }, { new: true }).lean();
    await audit(request.auth!.userId, action, updated, request.requestId);
    return sendSuccess(response, ruleView(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
};
router.post('/pricing-rules/:id/disable', validate(idParam, 'params'), validate(noBody), setActive(false, 'PRICING_RULE_DISABLED'));
router.post('/pricing-rules/:id/enable', validate(idParam, 'params'), validate(noBody), setActive(true, 'PRICING_RULE_ENABLED'));

/**
 * Bulk pricing (§20, §21).
 *
 * `preview` writes nothing; `apply` writes only the rows a preview would have marked
 * `willChange`. Both report the same per-product numbers — supplier cost, current price,
 * new price, gross unit margin, gross margin percent and any blocking issue — and the
 * margin label travels with the payload because these figures are merchandise margin,
 * not business profit (§21).
 */
const MARGIN_BASIS = 'gross merchandise margin';
router.post('/pricing/preview', validate(targetBody), async (request, response, next) => {
  try {
    const result = await previewPricing(request.body as PricingTargetQuery);
    return sendSuccess(response, { ...result, marginBasis: MARGIN_BASIS });
  } catch (error) {
    return fail(error, request, response, next);
  }
});

router.post('/pricing/apply', validate(targetBody), async (request, response, next) => {
  try {
    const result = await applyPricing(request.auth!.userId, request.body as PricingTargetQuery, request.requestId);
    return sendSuccess(response, { ...result, marginBasis: MARGIN_BASIS });
  } catch (error) {
    return fail(error, request, response, next);
  }
});

export default router;
