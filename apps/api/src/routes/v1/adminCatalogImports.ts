import express from 'express';
import { z } from 'zod';
import { CSV_LIMITS } from '../../config/dropshipping.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
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

/**
 * Admin CSV catalog import routes (§40).
 *
 * Four steps, each its own request: upload the file, confirm the column mapping,
 * preview what the import would do, then import. Splitting them is what makes §13
 * enforceable — the import step is the only one that writes products, it always writes
 * them as `DRAFT`, and no step here publishes anything.
 *
 * Every route is SUPER_ADMIN only (§49) and every body is a strict allowlist, so the
 * server-owned parts of a job — its number, status, counters, row results, row hashes
 * and supplier ownership reference — cannot be supplied by a client (§48).
 */
const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const oid = /^[a-f\d]{24}$/i;
const idParam = z.object({ id: z.string().regex(oid) }).strict();
const noBody = z.object({}).strict();
const fail = (error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) =>
  error instanceof CatalogImportError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);
const meta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNextPage: page * limit < total,
  hasPreviousPage: page > 1,
});

/**
 * The CSV arrives as a raw body rather than multipart form data: a single-file import
 * needs no upload dependency, and this phase adds none. The global JSON parser is
 * content-type gated so it never touches these bytes, and the `limit` here is the real
 * file ceiling — an oversize upload is refused by the parser before it is buffered,
 * which the error handler reports as 413 `REQUEST_BODY_TOO_LARGE` (§8).
 */
const csvBody = express.raw({
  type: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
  limit: CSV_LIMITS.maxFileBytes,
});
const uploadQuery = z
  .object({
    supplierId: z.string().regex(oid),
    fileName: z.string().trim().min(1).max(260),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
  })
  .strict();
const overwriteFlags = z
  .object({ name: z.boolean(), description: z.boolean(), category: z.boolean(), brand: z.boolean(), images: z.boolean() })
  .partial()
  .strict();
const mappingBody = z
  .object({
    entries: z
      .array(z.object({ column: z.string().trim().min(1).max(CSV_LIMITS.maxHeaderLength), target: z.enum(MAPPING_TARGETS) }).strict())
      .min(1)
      .max(CSV_LIMITS.maxColumns),
    allowFieldOverwrite: overwriteFlags.optional(),
    pricingRuleId: z.string().regex(oid).nullable().optional(),
    applyPricingToNewProducts: z.boolean().optional(),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
    saveAsTemplate: z.boolean().optional(),
    templateName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
const listQuery = z
  .object({
    supplierId: z.string().regex(oid).optional(),
    status: z.enum(['UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const rowsQuery = z
  .object({
    result: z.enum(['VALID', 'INVALID', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const asId = (value: unknown) => (value ? String(value) : null);
/** Diagnostics travel as stable codes plus an operator-readable message, never parser text (§7). */
const diagnostics = (list: unknown) =>
  ((list as any[]) ?? []).map((entry: any) => ({ code: entry.code, ...(entry.field ? { field: entry.field } : {}), message: entry.message }));
const overwriteView = (flags: any) => Object.fromEntries(OVERWRITABLE.map(field => [field, Boolean(flags?.[field])]));

/**
 * Job projection.
 *
 * The stored mapping, the counters and the bounded error summary are what an operator
 * needs to judge a run. The uploaded bytes are deliberately not echoed back: the file is
 * kept only so mapping, preview and import read the same input, and a response is not a
 * download endpoint for supplier data.
 */
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

/** Row diagnostics answer §7's questions: which row, which supplier SKU, what happened, and why. */
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
  // Cost and stock movement observed on a repeat import (§27, §28).
  changes: row.changes ?? null,
  createdAt: row.createdAt,
});

/** The mapping vocabulary, so a client never has to hard-code it. Declared before `/:id`. */
router.get('/catalog-imports/mapping-targets', (_request, response) =>
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
  })
);

/**
 * Step 1 of 4. Stores the file, parses its header row and proposes a mapping.
 *
 * Nothing about the catalog changes here. The response carries both a heuristic
 * suggestion and this supplier's saved template (§11) so the operator confirms a mapping
 * rather than retyping one.
 */
router.post('/catalog-imports', csvBody, validate(uploadQuery, 'query'), async (request, response, next) => {
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
});

/**
 * Step 2 of 4. Records the operator's column decisions and moves the job to READY.
 *
 * Omitting an `allowFieldOverwrite` flag means "keep what the admin curated" (§14), so a
 * partial body is always the safe body.
 */
router.post('/catalog-imports/:id/mapping', validate(idParam, 'params'), validate(mappingBody), async (request, response, next) => {
  try {
    return sendSuccess(response, jobView(await confirmMapping(request.auth!.userId, String(request.params.id), request.body, request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/** Step 3 of 4. A bounded, strictly read-only prediction — no product is touched (§12). */
router.get('/catalog-imports/:id/preview', validate(idParam, 'params'), async (request, response, next) => {
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
});

/**
 * Step 4 of 4. Creates DRAFT products and supplier sources, and publishes nothing.
 *
 * `replayed: true` is how a retry is reported: the job had already finished, so the
 * caller receives that result rather than a second set of products (§44, §45).
 */
router.post('/catalog-imports/:id/import', validate(idParam, 'params'), validate(noBody), async (request, response, next) => {
  try {
    const result = await runImport(request.auth!.userId, String(request.params.id), request.requestId);
    return sendSuccess(response, { job: jobView(result.job), replayed: result.replayed });
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/** Abandons a job that has not started importing. Never a way to disown created products. */
router.post('/catalog-imports/:id/cancel', validate(idParam, 'params'), validate(noBody), async (request, response, next) => {
  try {
    return sendSuccess(response, jobView(await cancelJob(request.auth!.userId, String(request.params.id), request.requestId)));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/** Import history (§15 of the deliverable list, §52 pagination). Newest first. */
router.get('/catalog-imports', validate(listQuery, 'query'), async (request, response, next) => {
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
});

router.get('/catalog-imports/:id', validate(idParam, 'params'), async (request, response, next) => {
  try {
    return sendSuccess(response, jobView(await getJob(String(request.params.id))));
  } catch (error) {
    return fail(error, request, response, next);
  }
});

/** Per-row error reporting. A 5,000-row job is never returned in one response (§52). */
router.get('/catalog-imports/:id/rows', validate(idParam, 'params'), validate(rowsQuery, 'query'), async (request, response, next) => {
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
});

export default router;
