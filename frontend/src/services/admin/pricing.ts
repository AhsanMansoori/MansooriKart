import { apiClient, unwrap, unwrapMeta } from '../apiClient';

export type PricingRule = {
  id: string;
  name: string;
  description?: string | null;
  supplier?: string | null;
  category?: string | null;
  brand?: string | null;
  markupType: 'PERCENTAGE' | 'FIXED';
  markupValue: number;
  minimumProfit?: number | null;
  roundingRule: 'NONE' | 'END_99';
  priority: number;
  isActive: boolean;
};

export type PricingRow = {
  productId: string;
  name: string | null;
  sku: string | null;
  status: string;
  fulfillmentType: string;
  supplierId: string | null;
  supplierSku: string | null;
  supplierCost: number | null;
  currentPrice: number | null;
  sellingPriceOverridden: boolean;
  rule: { id: string; name: string } | null;
  newPrice: number | null;
  grossUnitMargin: number | null;
  grossMarginPercent: number | null;
  willChange: boolean;
  eligible: boolean;
  issues: Array<{ code: string; message: string }>;
};

export type PricingBatch = {
  rule: { id: string; name: string } | null;
  rows: PricingRow[];
  summary: {
    targets: number;
    eligible: number;
    willChange: number;
    preservedOverrides: number;
    blocked: number;
    updated: number;
  };
  marginBasis: string;
};

export async function listPricingRules() {
  const response = await apiClient.get('/admin/pricing-rules', { params: { isActive: 'true', page: 1, limit: 100 } });
  return { items: unwrap(response) as PricingRule[], meta: unwrapMeta(response) };
}

export async function previewDraftDropshipPricing(ruleId?: string) {
  const response = await apiClient.post('/admin/pricing/preview', {
    status: 'DRAFT',
    fulfillmentType: 'DROPSHIP',
    ...(ruleId ? { ruleId } : {}),
  });
  return unwrap(response) as PricingBatch;
}

export async function applyDraftDropshipPricing(ruleId?: string) {
  const response = await apiClient.post('/admin/pricing/apply', {
    status: 'DRAFT',
    fulfillmentType: 'DROPSHIP',
    ...(ruleId ? { ruleId } : {}),
  });
  return unwrap(response) as PricingBatch;
}
