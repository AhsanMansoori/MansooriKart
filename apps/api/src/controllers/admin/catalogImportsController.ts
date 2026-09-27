import type { NextFunction, Request, Response } from 'express';
import { CSV_LIMITS } from '../../config/dropshipping.js';
import {
  cancelJob,
  CatalogImportError,
  confirmMapping,
  getJob,
  listJobs,
  listRows,
  MAPPING_TARGETS,
  OVERWRITABLE,
  previewJob,
  REQUIRED_TARGETS,
  runImport,
  uploadCsv,
} from '../../services/catalogImportService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const fail = (error: unknown, request: Request, response: Response, next: NextFunction) =>
  error instanceof CatalogImportError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);

const meta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNextPage: page * limit < total,
  hasPreviousPage: page > 1,
});

const asId = (value: unknown) => (value ? String(value) : null);
const diagnostics = (list: unknown) =>
  ((list as any[]) ?? []).map((entry: any) => ({ code: entry.code, ...(entry.field ? { field: entry.field } : {}), message: entry.message }));
const overwriteView = (flags: any) => Object.fromEntries(OVERWRITABLE.map(field => [field, Boolean(flags?.[field])]));

const jobView = (job: any) => ({
  id: asId(job._id),
  jobNumber: job.jobNumber,
  supplier: asId(job.supplier),
  fileName: job.fileName,
  fileSize: job.fileSize,
  status: job.status,
  headers: job.headers ?? [],
  mapping: {
    entries: ((job.mapping?.entries as any[]) ?? []).map((entry: any) => ({ column: entry.column, target: entry.target })),
    allowFieldOverwrite: overwriteView(job.mapping?.allowFieldOverwrite),
    confirmedAt: job.mapping?.confirmedAt ?? null,
    confirmedBy: asId(job.mapping?.confirmedBy),
  },
  pricingRule: asId(job.pricingRule),
  applyPricingToNewProducts: Boolean(job.applyPricingToNewProducts),
  fulfillmentType: job.fulfillmentType ?? 'DROPSHIP',
  counters: {
    totalRows: job.totalRows ?? 0,
    validRows: job.validRows ?? 0,
    invalidRows: job.invalidRows ?? 0,
    createdRows: job.createdRows ?? 0,
    updatedRows: job.updatedRows ?? 0,
    skippedRows: job.skippedRows ?? 0,
    failedRows: job.failedRows ?? 0,
  },
  startedAt: job.startedAt ?? null,
  completedAt: job.completedAt ?? null,
  createdBy: asId(job.createdBy),
  errorSummary: ((job.errorSummary as any[]) ?? []).map((entry: any) => ({ code: entry.code, message: entry.message, count: entry.count })),
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const rowView = (row: any) => ({
  id: asId(row._id),
  rowNumber: row.rowNumber,
  supplierSku: row.supplierSku ?? null,
  productName: row.productName ?? null,
  result: row.result,
  action: row.action ?? 'NONE',
  product: asId(row.product),
  supplierCatalogItem: asId(row.supplierCatalogItem),
  errors: diagnostics(row.errors),
  warnings: diagnostics(row.warnings),
  changes: row.changes ?? null,
  createdAt: row.createdAt,
});

export const getMappingTargets = (_request: Request, response: Response) =>
  sendSuccess(response, {
    targets: MAPPING_TARGETS,
    required: REQUIRED_TARGETS,
    overwritable: OVERWRITABLE,
    limits: {
      maxFileBytes: CSV_LIMITS.maxFileBytes,
      maxRows: CSV_LIMITS.maxRows,
      maxColumns: CSV_LIMITS.maxColumns,
      maxFieldLength: CSV_LIMITS.maxFieldLength,
      previewRows: CSV_LIMITS.previewRows,
    },
  });

export const uploadCatalogCsv = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!Buffer.isBuffer(request.body))
      return sendFailure(response, 415, 'CSV_CONTENT_TYPE_UNSUPPORTED', 'Send the file as a raw CSV body with a text/csv content type.', request.requestId);
    const query = request.query as any;
    const result = await uploadCsv(
      request.auth!.userId,
      {
        supplierId: String(query.supplierId),
        fileName: String(query.fileName),
        contentType: request.header('content-type') || 'text/csv',
        body: request.body,
        ...(query.fulfillmentType ? { fulfillmentType: query.fulfillmentType } : {}),
      },
      request.requestId
    );
    return sendSuccess(
      response,
      { job: jobView(result.job), headers: result.headers, suggestedMapping: result.suggestedMapping, templateMapping: result.templateMapping },
      201
    );
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const confirmCatalogMapping = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, jobView(await confirmMapping(request.auth!.userId, String(request.params.id), request.body, request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const previewCatalogJob = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await previewJob(String(request.params.id));
    return sendSuccess(response, {
      job: jobView(result.job),
      totalRows: result.totalRows,
      sampledRows: result.sampledRows,
      hasMoreRows: result.hasMoreRows,
      rows: result.rows,
    });
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const runCatalogImport = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const result = await runImport(request.auth!.userId, String(request.params.id), request.requestId);
    return sendSuccess(response, { job: jobView(result.job), replayed: result.replayed });
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const cancelCatalogJob = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, jobView(await cancelJob(request.auth!.userId, String(request.params.id), request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const listCatalogJobs = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const { items, total } = await listJobs({
      ...(query.supplierId ? { supplierId: String(query.supplierId) } : {}),
      ...(query.status ? { status: String(query.status) } : {}),
      ...(query.from ? { from: new Date(query.from).toISOString() } : {}),
      ...(query.to ? { to: new Date(query.to).toISOString() } : {}),
      page: query.page,
      limit: query.limit,
    });
    return sendSuccess(response, items.map(jobView), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const getCatalogJobById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    return sendSuccess(response, jobView(await getJob(String(request.params.id))));
  } catch (error) {
    return fail(error, request, response, next);
  }
};

export const listCatalogJobRows = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const { items, total } = await listRows(String(request.params.id), {
      ...(query.result ? { result: String(query.result) } : {}),
      page: query.page,
      limit: query.limit,
    });
    return sendSuccess(response, items.map(rowView), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return fail(error, request, response, next);
  }
};
