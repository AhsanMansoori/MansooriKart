import { apiClient, unwrap, unwrapMeta } from '../apiClient';

export type Supplier = {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  currency?: string;
};

export type MappingTargetConfig = {
  targets: string[];
  required: string[];
  overwritable: string[];
  limits: {
    maxFileBytes: number;
    maxRows: number;
    maxColumns: number;
    maxFieldLength: number;
    previewRows: number;
  };
};

export type MappingEntry = { column: string; target: string };

export type ImportJob = {
  id: string;
  jobNumber: string;
  supplier: string;
  fileName: string;
  fileSize: number;
  status: string;
  headers: string[];
  mapping?: { entries?: MappingEntry[]; allowFieldOverwrite?: Record<string, boolean> };
  fulfillmentType: 'OWN_STOCK' | 'DROPSHIP';
  counters: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    createdRows: number;
    updatedRows: number;
    skippedRows: number;
    failedRows: number;
  };
  errorSummary?: Array<{ code: string; message: string; count: number }>;
  createdAt: string;
  updatedAt: string;
};

export async function listSuppliers() {
  const response = await apiClient.get('/admin/suppliers', {
    params: { status: 'ACTIVE', limit: 100, sort: 'name', direction: 'asc' },
  });
  return unwrap(response) as Supplier[];
}

export async function getMappingTargets() {
  const response = await apiClient.get('/admin/catalog-imports/mapping-targets');
  return unwrap(response) as MappingTargetConfig;
}

export async function listCatalogImports(page = 1, limit = 10) {
  const response = await apiClient.get('/admin/catalog-imports', { params: { page, limit } });
  return {
    items: unwrap(response) as ImportJob[],
    meta: unwrapMeta(response),
  };
}

export async function uploadCatalogCsv(input: {
  supplierId: string;
  file: File;
  fulfillmentType?: 'DROPSHIP' | 'OWN_STOCK';
}) {
  const response = await apiClient.post('/admin/catalog-imports', input.file, {
    params: {
      supplierId: input.supplierId,
      fileName: input.file.name,
      fulfillmentType: input.fulfillmentType ?? 'DROPSHIP',
    },
    headers: { 'Content-Type': 'text/csv' },
    timeout: 30000,
  });
  return unwrap(response) as {
    job: ImportJob;
    headers: string[];
    suggestedMapping: unknown;
    templateMapping: unknown;
  };
}

export async function confirmCatalogMapping(
  jobId: string,
  body: {
    entries: MappingEntry[];
    fulfillmentType: 'DROPSHIP' | 'OWN_STOCK';
    allowFieldOverwrite?: Record<string, boolean>;
  }
) {
  const response = await apiClient.post(`/admin/catalog-imports/${jobId}/mapping`, body);
  return unwrap(response) as ImportJob;
}

export async function previewCatalogImport(jobId: string) {
  const response = await apiClient.get(`/admin/catalog-imports/${jobId}/preview`);
  return unwrap(response) as {
    job: ImportJob;
    totalRows: number;
    sampledRows: number;
    hasMoreRows: boolean;
    rows: Array<Record<string, unknown>>;
  };
}

export async function runCatalogImport(jobId: string) {
  const response = await apiClient.post(`/admin/catalog-imports/${jobId}/import`, {});
  return unwrap(response) as { job: ImportJob; replayed: boolean };
}
