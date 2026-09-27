import type { NextFunction, Request, Response } from 'express';
import { AuditLog } from '../../models/auditLog.js';
import { PricingRule } from '../../models/pricingRule.js';
import { Supplier } from '../../models/supplier.js';
import { applyPricing, previewPricing, type PricingTargetQuery } from '../../services/bulkPricingService.js';
import { PricingError } from '../../services/pricingService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (error: unknown, request: Request, response: Response, next: NextFunction) =>
  error instanceof PricingError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);

const meta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNextPage: page * limit < total,
  hasPreviousPage: page > 1,
});

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

async function assertRuleScope(body: any, current: any): Promise<void> {
  const min = effective(body, current, 'minCost');
  const max = effective(body, current, 'maxCost');
  if (typeof min === 'number' && typeof max === 'number' && min > max)
    throw new PricingError('PRICING_RULE_COST_BAND_INVALID', 'The minimum cost must not exceed the maximum cost.');
  if (body.supplierId && !(await Supplier.exists({ _id: body.supplierId })))
    throw new PricingError('PRICING_RULE_SUPPLIER_NOT_FOUND', 'The supplier was not found.');
}

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

const MARGIN_BASIS = 'gross merchandise margin';

export const createPricingRule = async (request: Request, response: Response, next: NextFunction) => {
  try {
    await assertRuleScope(request.body, null);
    const rule = await PricingRule.create({ ...docFrom(request.body), createdBy: request.auth!.userId });
    await audit(request.auth!.userId, 'PRICING_RULE_CREATED', rule, request.requestId);
    return sendSuccess(response, ruleView(rule.toObject()), 201);
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const listPricingRules = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = {};
    if (query.supplierId) filter.supplier = query.supplierId;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
    if (query.markupType) filter.markupType = query.markupType;
    const [items, total] = await Promise.all([
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
};

export const getPricingRuleById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const rule = await PricingRule.findById(request.params.id).lean();
    return rule
      ? sendSuccess(response, ruleView(rule))
      : sendFailure(response, 404, 'PRICING_RULE_NOT_FOUND', 'The pricing rule was not found.', request.requestId);
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const patchPricingRule = async (request: Request, response: Response, next: NextFunction) => {
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
};

export const disablePricingRule = async (request: Request, response: Response, next: NextFunction) => {
  try {
    await loadRule(String(request.params.id));
    const updated = await PricingRule.findByIdAndUpdate(
      request.params.id,
      { $set: { isActive: false, updatedBy: request.auth!.userId } },
      { new: true }
    ).lean();
    await audit(request.auth!.userId, 'PRICING_RULE_DISABLED', updated, request.requestId);
    return sendSuccess(response, ruleView(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const enablePricingRule = async (request: Request, response: Response, next: NextFunction) => {
  try {
    await loadRule(String(request.params.id));
    const updated = await PricingRule.findByIdAndUpdate(request.params.id, { $set: { isActive: true, updatedBy: request.auth!.userId } }, { new: true }).lean();
    await audit(request.auth!.userId, 'PRICING_RULE_ENABLED', updated, request.requestId);
    return sendSuccess(response, ruleView(updated));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const previewBulkPricing = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await previewPricing(request.body as PricingTargetQuery);
    return sendSuccess(response, { ...result, marginBasis: MARGIN_BASIS });
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const applyBulkPricing = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await applyPricing(request.auth!.userId, request.body as PricingTargetQuery, request.requestId);
    return sendSuccess(response, { ...result, marginBasis: MARGIN_BASIS });
  } catch (error) {
    return fail(error, request, response, next);
  }
};
