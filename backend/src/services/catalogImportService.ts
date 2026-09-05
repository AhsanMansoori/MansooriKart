import crypto from 'node:crypto';
import { Types } from 'mongoose';
import {
  availabilityFor,
  CSV_LIMITS,
  DEFAULT_IMPORT_CATEGORY,
  PLACEHOLDER_IMAGE_URL,
  SIGNIFICANT_COST_CHANGE_PERCENT,
  SUPPLIER_VALUE_LIMITS,
} from '../config/dropshipping.js';
import { AuditLog } from '../models/auditLog.js';
import { CatalogImportJob, CatalogImportRow, CatalogMappingTemplate } from '../models/catalogImport.js';
import { CatalogImportFile } from '../models/catalogImportFile.js';
import { Product } from '../models/product.js';
import { Supplier } from '../models/supplier.js';
import { SupplierCatalogItem } from '../models/supplierCatalogItem.js';
import { CsvFormatError, parseCsv, type CsvDocument } from '../utils/csv.js';
import { computePrice, loadActiveRules, loadRuleById, selectRule, type PriceComputation, type PricingRuleShape } from './pricingService.js';

/**
 * Supplier CSV catalog import.
 *
 * The lifecycle is four explicit requests — upload, mapping, preview, import — and
 * the server keeps the uploaded bytes between them so the client cannot substitute a
 * different file halfway through. See CSV_CATALOG_IMPORT_ARCHITECTURE.md.
 *
 * Three rules are load-bearing and enforced here rather than in a route handler:
 * every newly created product is DRAFT, an import never overwrites an admin-curated
 * canonical field unless that field was explicitly opted in, and a supplier feed sets
 * supplier cost but never the MansooriKart selling price.
 */

export class CatalogImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export const MAPPING_TARGETS = [
  'supplierSku',
  'name',
  'description',
  'supplierCost',
  'supplierStock',
  'category',
  'brand',
  'imageUrl',
  'imageUrls',
  'weight',
  'color',
  'size',
  'barcode',
  'externalId',
  'supplierSuggestedRetailPrice',
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];

/** Without these three a row cannot identify a supplier line, name a product, or be costed. */
export const REQUIRED_TARGETS: MappingTarget[] = ['supplierSku', 'name', 'supplierCost'];
/** Canonical fields an import may overwrite on an existing product, and only when opted in. */
export const OVERWRITABLE = ['name', 'description', 'category', 'brand', 'images'] as const;

type Diagnostic = { code: string; field?: string; message: string };

/**
 * Translates a parser code into a client-facing import error.
 *
 * Deliberately a fixed mapping rather than a pass-through: the API contract owns
 * these codes, and no parser internal, offset or stack ever reaches a caller.
 */
function fromCsvError(error: CsvFormatError): CatalogImportError {
  const known: Record<string, string> = {
    CSV_NOT_TEXT: 'The uploaded file is not a text CSV file.',
    CSV_EMPTY: 'The uploaded file is empty.',
    CSV_TOO_LARGE: 'The uploaded file is larger than the import limit.',
    CSV_ENCODING_INVALID: 'The uploaded file is not valid UTF-8 text.',
    CSV_FIELD_TOO_LONG: 'A cell in the uploaded file exceeds the maximum length.',
    CSV_TOO_MANY_COLUMNS: 'The uploaded file has too many columns.',
    CSV_HEADER_TOO_LONG: 'A column header exceeds the maximum length.',
    CSV_HEADER_MISSING: 'The uploaded file has no usable header row.',
    CSV_HEADER_BLANK: 'The uploaded file has a blank column header.',
    CSV_HEADER_DUPLICATE: 'The uploaded file has a duplicate column header.',
    CSV_QUOTE_INVALID: 'A quoted value in the uploaded file is malformed.',
    CSV_QUOTE_UNTERMINATED: 'A quoted value in the uploaded file is never closed.',
    CSV_NO_DATA_ROWS: 'The uploaded file contains a header but no data rows.',
  };
  const message = known[error.code];
  if (!message) return new CatalogImportError('CSV_INVALID', 'The uploaded file could not be read as CSV.');
  const suffix = error.row === undefined ? '' : ` (row ${error.row})`;
  return new CatalogImportError(error.code, `${message}${suffix}`);
}

/** Parses a supplier-supplied number, tolerating thousands separators and currency noise. */
function parseNumber(raw: string | undefined): { value?: number; code?: string } {
  const text = (raw ?? '').trim();
  if (!text) return {};
  const cleaned = text.replaceAll(',', '').replace(/[^\d.\-+eE]/g, '');
  if (!cleaned || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) return { code: 'INVALID' };
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { code: 'INVALID' };
  return { value };
}

/** Hosts that must never be reachable from a supplier-supplied URL. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fe80:/i,
  /metadata\.google\.internal$/i,
];

/**
 * Validates a supplier image URL without ever dereferencing it.
 *
 * The import stores a URL string and nothing more. Nothing is downloaded, HEADed or
 * probed server-side, which removes SSRF from the import path entirely; the private
 * and link-local host rejections below exist so a stored URL cannot later become an
 * internal request when some other component renders it.
 */
export function safeImageUrl(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (text.length > 2000) return null;
  // A site-relative asset path is fine and cannot address a host at all.
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host) return null;
  if (BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(host))) return null;
  return url.toString();
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';

/**
 * MansooriKart's own product SKU.
 *
 * Server-generated on every import without exception: a supplier SKU identifies the
 * supplier's line inside `SupplierCatalogItem` and never becomes the MansooriKart
 * identity, so two suppliers shipping the same manufacturer code stay distinct
 * products and a supplier renaming its codes cannot rewrite ours.
 */
const serverSku = () => `MK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const uniqueSlug = (name: string) => `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`;

/** Stable digest of the mapped values of a row, used to detect a genuinely unchanged line. */
const rowHash = (values: Record<string, string>) =>
  crypto
    .createHash('sha256')
    .update(
      Object.keys(values)
        .sort()
        .map(key => `${key}=${values[key] ?? ''}`)
        .join('\u0000')
    )
    .digest('hex');

const money = (n: number) => Number(n.toFixed(2));
const sequence = (prefix: string) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/** Creates a job, retrying on the unique-number collision rather than pre-reading the counter. */
async function createJobWithNumber(payload: Record<string, unknown>): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await CatalogImportJob.create({ ...payload, jobNumber: sequence('IMP') });
    } catch (error: any) {
      if (error?.code !== 11000 || attempt === 4) throw error;
    }
  }
  throw new CatalogImportError('IMPORT_JOB_NOT_CREATED', 'The import job could not be created.', 500);
}

/** Header spellings suppliers commonly use, per mapping target. Suggestion only — never applied silently. */
const HEADER_HINTS: Record<MappingTarget, string[]> = {
  supplierSku: ['suppliersku', 'sku', 'itemcode', 'productcode', 'code', 'partnumber', 'mpn'],
  name: ['name', 'productname', 'title', 'itemname', 'description1'],
  description: ['description', 'longdescription', 'details', 'productdescription'],
  supplierCost: ['cost', 'suppliercost', 'price', 'unitcost', 'wholesaleprice', 'buyingprice', 'costprice'],
  supplierStock: ['stock', 'quantity', 'qty', 'available', 'inventory', 'stockqty'],
  category: ['category', 'categoryname', 'producttype', 'department'],
  brand: ['brand', 'manufacturer', 'make', 'vendorbrand'],
  imageUrl: ['image', 'imageurl', 'picture', 'photo', 'mainimage', 'imagelink'],
  imageUrls: ['images', 'imageurls', 'gallery', 'additionalimages'],
  weight: ['weight', 'grossweight', 'itemweight'],
  color: ['color', 'colour'],
  size: ['size', 'variantsize'],
  barcode: ['barcode', 'ean', 'upc', 'gtin'],
  externalId: ['externalid', 'id', 'supplierid', 'productid'],
  supplierSuggestedRetailPrice: ['msrp', 'rrp', 'retailprice', 'suggestedretailprice', 'listprice', 'mrp'],
};

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Proposes a column → target mapping from the header row.
 *
 * A suggestion is returned to the operator and stored nowhere: §10's mapping is an
 * explicit, confirmed decision, so nothing here can cause an import on its own.
 */
export function suggestMapping(headers: string[]): { column: string; target: MappingTarget }[] {
  const taken = new Set<MappingTarget>();
  const entries: { column: string; target: MappingTarget }[] = [];
  for (const header of headers) {
    const key = normalizeHeader(header);
    if (!key) continue;
    const target = MAPPING_TARGETS.find(candidate => !taken.has(candidate) && (HEADER_HINTS[candidate] ?? []).includes(key));
    if (!target) continue;
    taken.add(target);
    entries.push({ column: header, target });
  }
  return entries;
}

/** Supplier feeds arrive with client file names; keep a label, never a path. */
const safeFileName = (raw: string) => {
  const base = raw
    .replace(/[\\/]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim();
  return (base || 'upload.csv').slice(0, 260);
};

async function requireSupplier(supplierId: string): Promise<any> {
  const supplier = await Supplier.findById(supplierId).lean();
  if (!supplier) throw new CatalogImportError('SUPPLIER_NOT_FOUND', 'Supplier not found.', 404);
  if (supplier.status === 'ARCHIVED') throw new CatalogImportError('SUPPLIER_INACTIVE', 'Supplier is archived and cannot be imported for.', 400);
  return supplier;
}

/**
 * Step 1 of 4. Validates the bytes, records a job, and retains the file server-side.
 *
 * The uploaded text is stored so that mapping, preview and import all read the same
 * bytes the operator uploaded. A client cannot resend a different file between steps,
 * which is what makes the preview in §12 an honest prediction of the import in §13.
 * Nothing is written to `Product` here.
 */
export async function uploadCsv(
  actor: string,
  input: { supplierId: string; fileName: string; contentType?: string; body: Buffer; fulfillmentType?: 'OWN_STOCK' | 'DROPSHIP' },
  requestId?: string
) {
  const supplier = await requireSupplier(input.supplierId);
  if (!Buffer.isBuffer(input.body) || input.body.length === 0) throw new CatalogImportError('CSV_EMPTY', 'The uploaded file is empty.');
  if (input.body.length > CSV_LIMITS.maxFileBytes) throw new CatalogImportError('CSV_TOO_LARGE', 'The uploaded file is larger than the import limit.', 413);
  let document: CsvDocument;
  try {
    document = parseCsv(input.body);
  } catch (error) {
    if (error instanceof CsvFormatError) throw fromCsvError(error);
    throw new CatalogImportError('CSV_INVALID', 'The uploaded file could not be read as CSV.');
  }
  // Refuse rather than silently drop rows: an operator who uploaded 8,000 lines must
  // not be told 5,000 imported successfully.
  if (document.truncated) throw new CatalogImportError('CSV_TOO_MANY_ROWS', `The uploaded file exceeds the ${CSV_LIMITS.maxRows} row import limit.`);

  const job = await createJobWithNumber({
    supplier: supplier._id,
    fileName: safeFileName(input.fileName),
    fileSize: input.body.length,
    status: 'UPLOADED',
    headers: document.headers,
    totalRows: document.rows.length,
    fulfillmentType: input.fulfillmentType ?? 'DROPSHIP',
    createdBy: actor,
  });
  try {
    await CatalogImportFile.create({
      job: job._id,
      contentType: input.contentType || 'text/csv',
      byteLength: input.body.length,
      content: input.body.toString('utf8'),
    });
  } catch (error) {
    // Without its bytes the job can never be mapped or imported, so it must not linger.
    await CatalogImportJob.deleteOne({ _id: job._id });
    throw error;
  }
  const template = await CatalogMappingTemplate.findOne({ supplier: supplier._id }).lean();
  // Metadata stays a handful of scalars: §50 forbids logging CSV contents or row bodies.
  await AuditLog.create({
    actor,
    action: 'CATALOG_IMPORT_UPLOADED',
    resourceType: 'CatalogImportJob',
    resourceId: String(job._id),
    requestId,
    metadata: { jobNumber: job.jobNumber, supplier: String(supplier._id), fileName: job.fileName, fileSize: job.fileSize, totalRows: job.totalRows },
  });
  return {
    job: job.toObject(),
    headers: document.headers,
    suggestedMapping: suggestMapping(document.headers),
    templateMapping: template?.mapping ?? null,
  };
}

/** Statuses from which a job may still be (re-)mapped. Once IMPORTING or finished, the mapping is history. */
const MAPPABLE = ['UPLOADED', 'VALIDATING', 'READY'];

async function loadJob(jobId: string): Promise<any> {
  const job = await CatalogImportJob.findById(jobId);
  if (!job) throw new CatalogImportError('IMPORT_JOB_NOT_FOUND', 'Import job not found.', 404);
  return job;
}

/**
 * Validates a proposed mapping against the file's own header row.
 *
 * Every target is optional except the three that make a row usable at all; a column
 * the operator did not map stays ignored, which is §51's rule that unknown supplier
 * columns are never persisted speculatively.
 */
export function assertMapping(entries: { column: string; target: string }[], headers: string[]): { column: string; target: MappingTarget }[] {
  if (!entries.length) throw new CatalogImportError('MAPPING_EMPTY', 'At least one column mapping is required.');
  const known = new Map(headers.map(header => [header.trim().toLowerCase(), header]));
  const seenTargets = new Set<string>();
  const seenColumns = new Set<string>();
  const resolved: { column: string; target: MappingTarget }[] = [];
  for (const entry of entries) {
    const column = known.get(entry.column.trim().toLowerCase());
    if (!column) throw new CatalogImportError('MAPPING_COLUMN_UNKNOWN', `The uploaded file has no column named ${entry.column}.`);
    if (seenColumns.has(column)) throw new CatalogImportError('MAPPING_COLUMN_DUPLICATE', `Column ${column} is mapped more than once.`);
    if (!(MAPPING_TARGETS as readonly string[]).includes(entry.target))
      throw new CatalogImportError('MAPPING_TARGET_UNKNOWN', `${entry.target} is not a supported import target.`);
    if (seenTargets.has(entry.target)) throw new CatalogImportError('MAPPING_TARGET_DUPLICATE', `Target ${entry.target} is mapped more than once.`);
    seenColumns.add(column);
    seenTargets.add(entry.target);
    resolved.push({ column, target: entry.target as MappingTarget });
  }
  const missing = REQUIRED_TARGETS.filter(target => !seenTargets.has(target));
  if (missing.length) throw new CatalogImportError('MAPPING_REQUIRED_MISSING', `These required targets are not mapped: ${missing.join(', ')}.`);
  return resolved;
}

export interface MappingInput {
  entries: { column: string; target: string }[];
  allowFieldOverwrite?: Partial<Record<(typeof OVERWRITABLE)[number], boolean>>;
  pricingRuleId?: string | null;
  applyPricingToNewProducts?: boolean;
  fulfillmentType?: 'OWN_STOCK' | 'DROPSHIP';
  saveAsTemplate?: boolean;
  templateName?: string;
}

/**
 * Step 2 of 4. Records the operator's column decisions and moves the job to READY.
 *
 * `allowFieldOverwrite` is reconstructed from scratch on every confirmation and
 * defaults to all-false, so an omitted flag can only ever mean "preserve what the
 * admin curated" (§14). A pricing rule named here is validated now rather than
 * mid-import, and still only ever produces a price for *new* products.
 */
export async function confirmMapping(actor: string, jobId: string, input: MappingInput, requestId?: string) {
  const job = await loadJob(jobId);
  if (!MAPPABLE.includes(job.status)) throw new CatalogImportError('IMPORT_JOB_NOT_MAPPABLE', `A ${job.status} import job can no longer be mapped.`, 409);
  const entries = assertMapping(input.entries, job.headers ?? []);
  const overwrite: Record<string, boolean> = {};
  for (const field of OVERWRITABLE) overwrite[field] = Boolean(input.allowFieldOverwrite?.[field]);
  if (input.pricingRuleId) await loadRuleById(input.pricingRuleId);
  job.mapping = { entries, allowFieldOverwrite: overwrite, confirmedAt: new Date(), confirmedBy: actor };
  job.pricingRule = input.pricingRuleId || null;
  if (input.applyPricingToNewProducts !== undefined) job.applyPricingToNewProducts = input.applyPricingToNewProducts;
  if (input.fulfillmentType) job.fulfillmentType = input.fulfillmentType;
  job.status = 'READY';
  await job.save();
  if (input.saveAsTemplate)
    await CatalogMappingTemplate.findOneAndUpdate(
      { supplier: job.supplier },
      {
        $set: { name: (input.templateName || `${job.fileName} mapping`).slice(0, 160), mapping: job.mapping, updatedBy: actor },
        $setOnInsert: { createdBy: actor },
      },
      { upsert: true, new: true }
    );
  await AuditLog.create({
    actor,
    action: 'CATALOG_IMPORT_MAPPED',
    resourceType: 'CatalogImportJob',
    resourceId: String(job._id),
    requestId,
    metadata: {
      jobNumber: job.jobNumber,
      targets: entries.map(entry => entry.target),
      allowFieldOverwrite: overwrite,
      pricingRule: input.pricingRuleId || null,
      savedTemplate: Boolean(input.saveAsTemplate),
    },
  });
  return job.toObject();
}

export interface MappedRow {
  rowNumber: number;
  /** Mapped target → trimmed supplier value. Unmapped supplier columns are absent by construction. */
  values: Record<string, string>;
  supplierSku: string;
  productName: string;
  cost: number | null;
  stock: number | null;
  msrp: number | null;
  images: string[];
  hash: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** Splits a multi-image cell. Suppliers use pipes, commas or newlines; all three are accepted. */
const splitImages = (value: string) =>
  value
    .split(/[|\n]+/)
    .flatMap(part => (part.includes('http') ? [part] : part.split(',')))
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 10);

function validateRow(row: MappedRow): void {
  if (!row.supplierSku) row.errors.push({ code: 'SUPPLIER_SKU_REQUIRED', field: 'supplierSku', message: 'Supplier SKU is required.' });
  else if (row.supplierSku.length > 120)
    row.errors.push({ code: 'SUPPLIER_SKU_TOO_LONG', field: 'supplierSku', message: 'Supplier SKU exceeds 120 characters.' });
  if (!row.productName) row.errors.push({ code: 'NAME_REQUIRED', field: 'name', message: 'Product name is required.' });
  const rawCost = row.values.supplierCost ?? '';
  if (!rawCost.trim()) row.errors.push({ code: 'COST_REQUIRED', field: 'supplierCost', message: 'Supplier cost is required.' });
  else {
    const parsed = parseNumber(rawCost);
    if (parsed.value === undefined) row.errors.push({ code: 'COST_INVALID', field: 'supplierCost', message: 'Supplier cost is not a valid number.' });
    else if (parsed.value < 0) row.errors.push({ code: 'COST_NEGATIVE', field: 'supplierCost', message: 'Supplier cost cannot be negative.' });
    else if (parsed.value > SUPPLIER_VALUE_LIMITS.maxCost)
      row.errors.push({ code: 'COST_TOO_LARGE', field: 'supplierCost', message: 'Supplier cost exceeds the maximum accepted value.' });
    else row.cost = money(parsed.value);
  }
}

/** Optional numeric and text checks. These add warnings, never a hard failure, unless the value is impossible. */
function validateOptional(row: MappedRow): void {
  const rawStock = (row.values.supplierStock ?? '').trim();
  if (rawStock) {
    const parsed = parseNumber(rawStock);
    if (parsed.value === undefined) row.errors.push({ code: 'STOCK_INVALID', field: 'supplierStock', message: 'Supplier stock is not a valid number.' });
    else if (parsed.value < 0) row.errors.push({ code: 'STOCK_NEGATIVE', field: 'supplierStock', message: 'Supplier stock cannot be negative.' });
    else if (parsed.value > SUPPLIER_VALUE_LIMITS.maxStock)
      row.errors.push({ code: 'STOCK_TOO_LARGE', field: 'supplierStock', message: 'Supplier stock exceeds the maximum accepted value.' });
    else row.stock = Math.floor(parsed.value);
  } else row.warnings.push({ code: 'STOCK_MISSING', field: 'supplierStock', message: 'No supplier stock reported; availability will be UNKNOWN.' });

  const rawMsrp = (row.values.supplierSuggestedRetailPrice ?? '').trim();
  if (rawMsrp) {
    const parsed = parseNumber(rawMsrp);
    if (parsed.value === undefined || parsed.value < 0 || parsed.value > SUPPLIER_VALUE_LIMITS.maxPrice)
      row.warnings.push({
        code: 'SUGGESTED_RETAIL_PRICE_INVALID',
        field: 'supplierSuggestedRetailPrice',
        message: 'Supplier suggested retail price was ignored because it is not a usable number.',
      });
    else row.msrp = money(parsed.value);
  }

  if (!(row.values.description ?? '').trim())
    row.warnings.push({ code: 'DESCRIPTION_MISSING', field: 'description', message: 'No description supplied; the product name will be used.' });
  if (!(row.values.category ?? '').trim())
    row.warnings.push({ code: 'CATEGORY_MISSING', field: 'category', message: `No category supplied; ${DEFAULT_IMPORT_CATEGORY} will be used.` });

  const candidates = [...splitImages(row.values.imageUrl ?? ''), ...splitImages(row.values.imageUrls ?? '')];
  let rejected = 0;
  for (const candidate of candidates) {
    const safe = safeImageUrl(candidate);
    if (!safe) rejected += 1;
    else if (!row.images.includes(safe)) row.images.push(safe);
  }
  if (rejected) row.warnings.push({ code: 'IMAGE_URL_INVALID', field: 'imageUrl', message: `${rejected} image URL(s) were rejected as unusable and skipped.` });
  if (!row.images.length) row.warnings.push({ code: 'IMAGE_MISSING', field: 'imageUrl', message: 'No usable image URL; a placeholder image will be used.' });
}

/**
 * Projects the parsed file through the confirmed mapping and validates every row.
 *
 * Pure: it touches no database and is therefore shared verbatim by preview and
 * import, which is what makes the preview a faithful prediction rather than a
 * separate implementation that can drift.
 */
export function mapRows(document: CsvDocument, entries: { column: string; target: MappingTarget }[]): MappedRow[] {
  const columnIndex = new Map<MappingTarget, number>();
  for (const entry of entries) {
    const index = document.headers.indexOf(entry.column);
    if (index >= 0) columnIndex.set(entry.target, index);
  }
  const rows: MappedRow[] = document.rows.map(source => {
    const values: Record<string, string> = {};
    for (const [target, index] of columnIndex) values[target] = (source.cells[index] ?? '').trim();
    const row: MappedRow = {
      rowNumber: source.rowNumber,
      values,
      supplierSku: values.supplierSku ?? '',
      productName: clip(values.name ?? '', 300),
      cost: null,
      stock: null,
      msrp: null,
      images: [],
      hash: rowHash(values),
      errors: [],
      warnings: [],
    };
    if (source.cells.length !== document.headers.length)
      row.errors.push({
        code: 'ROW_CELL_COUNT',
        message: `The row has ${source.cells.length} values but the header declares ${document.headers.length} columns.`,
      });
    validateRow(row);
    validateOptional(row);
    return row;
  });
  // §46: a supplier SKU repeated inside one file fails on every occurrence rather than
  // being resolved by "last row wins", which would silently discard one of the rows.
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    if (!row.supplierSku) continue;
    const key = row.supplierSku.toLowerCase();
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  for (const row of rows)
    if (row.supplierSku && (occurrences.get(row.supplierSku.toLowerCase()) ?? 0) > 1)
      row.errors.push({ code: 'SUPPLIER_SKU_DUPLICATE', field: 'supplierSku', message: 'This supplier SKU appears more than once in the uploaded file.' });
  return rows;
}

/** Reads back the exact bytes the operator uploaded. The client never re-supplies the file. */
async function loadDocument(job: any, maxRows?: number): Promise<CsvDocument> {
  const stored = await CatalogImportFile.findOne({ job: job._id }).lean();
  if (!stored) throw new CatalogImportError('IMPORT_FILE_MISSING', 'The uploaded file for this job is no longer available.', 409);
  try {
    return parseCsv(String(stored.content), maxRows === undefined ? {} : { maxRows });
  } catch (error) {
    if (error instanceof CsvFormatError) throw fromCsvError(error);
    throw new CatalogImportError('CSV_INVALID', 'The stored file could not be read as CSV.');
  }
}

function mappedEntries(job: any): { column: string; target: MappingTarget }[] {
  const entries: any[] = job.mapping?.entries ?? [];
  if (!entries.length || !job.mapping?.confirmedAt)
    throw new CatalogImportError('IMPORT_MAPPING_REQUIRED', 'Confirm a column mapping before previewing or importing.', 409);
  return entries.map(entry => ({ column: String(entry.column), target: entry.target as MappingTarget }));
}

/**
 * The rules in play for one job: either the single rule the operator pinned to it, or
 * every active rule, from which each row selects deterministically (§18).
 */
async function pricingContext(job: any): Promise<{ fixed: PricingRuleShape | null; rules: PricingRuleShape[] }> {
  if (job.pricingRule) return { fixed: await loadRuleById(String(job.pricingRule)), rules: [] };
  return { fixed: null, rules: await loadActiveRules() };
}

function priceFor(
  context: { fixed: PricingRuleShape | null; rules: PricingRuleShape[] },
  job: any,
  row: MappedRow
): { rule: PricingRuleShape | null; computation: PriceComputation | null } {
  if (row.cost === null) return { rule: null, computation: null };
  const rule =
    context.fixed ??
    selectRule(context.rules, {
      supplier: job.supplier,
      category: row.values.category ?? null,
      brand: row.values.brand ?? null,
      supplierCost: row.cost,
    });
  if (!rule) return { rule: null, computation: null };
  try {
    return { rule, computation: computePrice(row.cost, rule) };
  } catch {
    // A rule that cannot price this cost (for example a price above the ceiling) is
    // reported as "no suggestion" rather than failing the whole row.
    return { rule, computation: null };
  }
}

/** One `$in` query per batch of SKUs, never one query per row (§52). Keyed by exact supplier SKU. */
async function existingSources(supplier: unknown, skus: string[]): Promise<Map<string, any>> {
  const found = new Map<string, any>();
  const unique = [...new Set(skus.filter(Boolean))];
  for (let index = 0; index < unique.length; index += CSV_LIMITS.batchSize) {
    const slice = unique.slice(index, index + CSV_LIMITS.batchSize);
    const items = await SupplierCatalogItem.find({ supplier, supplierSku: { $in: slice } }).lean();
    for (const item of items) found.set(String(item.supplierSku), item);
  }
  return found;
}

type PlannedAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'FAIL';

/**
 * Decides what one row would do, without doing it.
 *
 * `SKIP` is reserved for a row whose mapped values hash identically to the last import
 * of the same supplier line: re-uploading yesterday's file is a no-op rather than a
 * cascade of pointless writes and audit entries.
 */
function planFor(row: MappedRow, existing: any): PlannedAction {
  if (row.errors.length) return 'FAIL';
  if (!existing) return 'CREATE';
  if (existing.sourceRowHash && existing.sourceRowHash === row.hash) return 'SKIP';
  return 'UPDATE';
}

/**
 * Step 3 of 4. A bounded, strictly read-only prediction of what the import would do.
 *
 * Nothing here writes to `Product`, `SupplierCatalogItem` or the job (§12). The price
 * column is a *suggestion* computed from the pricing rules; `priceWillBeApplied` says
 * plainly whether the import would set it, and it is only ever true for a brand-new
 * product, never for one an admin already prices.
 */
export async function previewJob(jobId: string) {
  const job = await loadJob(jobId);
  const entries = mappedEntries(job);
  const document = await loadDocument(job, CSV_LIMITS.previewRows);
  const rows = mapRows(document, entries);
  const sources = await existingSources(
    job.supplier,
    rows.map(row => row.supplierSku)
  );
  const productIds = [...sources.values()].map(item => item.product).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select('_id name price status sellingPriceOverridden costPrice')
        .lean()
    : [];
  const productById = new Map<string, any>(products.map((product: any) => [String(product._id), product]));
  const context = await pricingContext(job);
  const preview = rows.map(row => {
    const existing = sources.get(row.supplierSku) ?? null;
    const action = planFor(row, existing);
    const { rule, computation } = priceFor(context, job, row);
    const product = existing ? (productById.get(String(existing.product)) ?? null) : null;
    return {
      rowNumber: row.rowNumber,
      supplierSku: row.supplierSku,
      productName: row.productName,
      result: row.errors.length ? 'INVALID' : 'VALID',
      action,
      supplierCost: row.cost,
      supplierStock: row.stock,
      supplierAvailability: availabilityFor(row.stock),
      supplierSuggestedRetailPrice: row.msrp,
      pricingRule: rule ? { id: rule._id ? String(rule._id) : null, name: rule.name ?? null } : null,
      suggestedPrice: computation?.suggestedPrice ?? null,
      grossUnitMargin: computation?.grossUnitMargin ?? null,
      grossMarginPercent: computation?.grossMarginPercent ?? null,
      priceWillBeApplied: action === 'CREATE' && Boolean(job.applyPricingToNewProducts) && computation !== null,
      imageCount: row.images.length,
      currentProduct: product
        ? {
            id: String(product._id),
            name: product.name,
            status: product.status,
            sellingPrice: product.price,
            sellingPriceOverridden: Boolean(product.sellingPriceOverridden),
          }
        : null,
      errors: row.errors,
      warnings: row.warnings,
    };
  });
  return { job: job.toObject(), totalRows: job.totalRows, sampledRows: preview.length, hasMoreRows: document.truncated, rows: preview };
}

/**
 * Mapped supplier attributes that are not canonical MansooriKart product fields.
 *
 * They live on the sourcing record, not on `Product`: §51 forbids persisting arbitrary
 * supplier columns, and inventing product fields for a supplier's colour or barcode
 * spelling would put unreviewed feed data into the canonical catalogue.
 */
function sourceMetadata(row: MappedRow): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const key of ['weight', 'color', 'size', 'barcode'] as const) {
    const value = (row.values[key] ?? '').trim();
    if (value) metadata[key] = clip(value, 200);
  }
  return metadata;
}

function sourceDoc(job: any, row: MappedRow, productId: unknown, now: Date): Record<string, unknown> {
  const externalId = clip((row.values.externalId ?? '').trim(), 200);
  return {
    supplier: job.supplier,
    product: productId,
    supplierSku: row.supplierSku,
    supplierProductName: row.productName,
    supplierCost: row.cost ?? 0,
    ...(row.stock === null ? {} : { supplierStock: row.stock }),
    supplierAvailability: availabilityFor(row.stock),
    supplierStockUpdatedAt: now,
    sourceRowHash: row.hash,
    ...(externalId ? { sourceExternalId: externalId } : {}),
    sourceImageUrls: row.images,
    lastImportedAt: now,
    lastImportJob: job._id,
    isActive: true,
    metadata: sourceMetadata(row),
  };
}

/**
 * The product a new supplier line becomes.
 *
 * `status: 'DRAFT'` is unconditional and has no configuration switch (§13): a
 * successful import means "these rows are now reviewable", never "these products are
 * on sale". `price` is a *suggestion* from the pricing rules and is 0 when no rule
 * matched, which publication validation then refuses until an admin sets one.
 */
function productDoc(job: any, row: MappedRow, actor: string, price: number, id: unknown): Record<string, unknown> {
  const name = row.productName;
  const brand = clip((row.values.brand ?? '').trim(), 160);
  return {
    _id: id,
    name,
    slug: uniqueSlug(name),
    sku: serverSku(),
    description: (row.values.description ?? '').trim() || name,
    category: (row.values.category ?? '').trim() || DEFAULT_IMPORT_CATEGORY,
    ...(brand ? { brand } : {}),
    image: row.images[0] ?? PLACEHOLDER_IMAGE_URL,
    ...(row.images.length ? { images: row.images.map((url, position) => ({ url, alt: clip(name, 240), position, isPrimary: position === 0 })) } : {}),
    price,
    costPrice: row.cost ?? 0,
    // Supplier stock is never warehouse stock: an imported product owns no
    // InventoryBalance and starts at zero owned units (§24).
    stock: 0,
    status: 'DRAFT',
    fulfillmentType: job.fulfillmentType,
    sourceType: 'SUPPLIER_CSV',
    sellingPriceOverridden: false,
    ...(row.msrp === null ? {} : { supplierSuggestedRetailPrice: row.msrp }),
    createdBy: actor,
  };
}

/** Inserts a batch, then asks the database which documents actually landed. */
async function insertAndVerify(model: any, docs: Record<string, unknown>[]): Promise<Set<string>> {
  if (!docs.length) return new Set<string>();
  try {
    await model.insertMany(docs, { ordered: false });
  } catch {
    // Per-document failures (a duplicate key, a validation error) are expected here and
    // are resolved authoritatively by the existence check rather than by parsing driver
    // error shapes. A systemic failure surfaces from the query below instead.
  }
  const found = await model
    .find({ _id: { $in: docs.map(doc => doc._id) } })
    .select('_id')
    .lean();
  return new Set<string>(found.map((doc: any) => String(doc._id)));
}

/** Driver write-error indices, when the driver reported them per document. */
function failedIndices(error: any): number[] | null {
  const writeErrors = error?.writeErrors ?? error?.result?.writeErrors ?? null;
  if (!Array.isArray(writeErrors) || !writeErrors.length) return null;
  const indices = writeErrors
    .map((entry: any) => (typeof entry?.index === 'number' ? entry.index : typeof entry?.err?.index === 'number' ? entry.err.index : -1))
    .filter((index: number) => index >= 0);
  return indices.length ? indices : null;
}

interface RowOutcome {
  row: MappedRow;
  result: 'VALID' | 'INVALID' | 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED';
  action: 'NONE' | 'CREATE' | 'UPDATE' | 'SKIP' | 'FAIL';
  product?: unknown;
  source?: unknown;
  changes?: Record<string, unknown>;
}

/**
 * What this row changes about the supplier line, in the terms §27 and §28 ask for.
 *
 * Cost and stock movements are reported as before/after pairs so an operator can see a
 * price rise or a sell-out without diffing two imports by hand. A supplier stock change
 * is emphatically *not* an InventoryMovement: nothing here touches owned inventory.
 */
function describeChanges(existing: any, row: MappedRow): Record<string, any> {
  const changes: Record<string, any> = {};
  const oldCost = typeof existing?.supplierCost === 'number' ? existing.supplierCost : null;
  if (row.cost !== null && oldCost !== null && oldCost !== row.cost) {
    const difference = money(row.cost - oldCost);
    changes.cost = {
      oldCost,
      newCost: row.cost,
      difference,
      percentChange: oldCost > 0 ? Number(((difference / oldCost) * 100).toFixed(2)) : null,
    };
  }
  const oldStock = typeof existing?.supplierStock === 'number' ? existing.supplierStock : null;
  if (row.stock !== null && oldStock !== row.stock) changes.stock = { oldStock, newStock: row.stock };
  const oldAvailability = existing?.supplierAvailability ?? 'UNKNOWN';
  const newAvailability = availabilityFor(row.stock);
  if (oldAvailability !== newAvailability) changes.availability = { oldAvailability, newAvailability };
  return changes;
}

/**
 * The canonical product fields a repeat import is allowed to touch.
 *
 * Everything is opt-in per field (§14): with the defaults, a second upload refreshes
 * supplier cost, stock and availability on the sourcing record and leaves the
 * customer-facing title, description, category, brand and images exactly as the admin
 * curated them. `price`, `status` and the publication fields are absent by
 * construction — a supplier feed can neither reprice (§15) nor publish (§13).
 */
function productUpdate(product: any, row: MappedRow, overwrite: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const name = row.productName;
  if (overwrite?.name && name && name !== product?.name) patch.name = name;
  const description = (row.values.description ?? '').trim();
  if (overwrite?.description && description && description !== product?.description) patch.description = description;
  const category = (row.values.category ?? '').trim();
  if (overwrite?.category && category && category !== product?.category) patch.category = category;
  const brand = clip((row.values.brand ?? '').trim(), 160);
  if (overwrite?.brand && brand && brand !== product?.brand) patch.brand = brand;
  if (overwrite?.images && row.images.length) {
    patch.images = row.images.map((url, position) => ({ url, alt: clip(name, 240), position, isPrimary: position === 0 }));
    patch.image = row.images[0];
  }
  // Supplier cost refreshes `costPrice` for DROPSHIP products only. For OWN_STOCK the
  // purchasing module's goods receipts remain the cost authority, so an import must not
  // overwrite it; that keeps a single COGS basis across both fulfilment types (§57).
  if (row.cost !== null && product?.fulfillmentType === 'DROPSHIP' && product?.costPrice !== row.cost) patch.costPrice = row.cost;
  if (row.msrp !== null && product?.supplierSuggestedRetailPrice !== row.msrp) patch.supplierSuggestedRetailPrice = row.msrp;
  return patch;
}

type PricingContext = { fixed: PricingRuleShape | null; rules: PricingRuleShape[] };

/** Creates new DRAFT products and their sourcing records, in batches, never row by row. */
async function applyCreates(job: any, actor: string, context: PricingContext, rows: MappedRow[], outcomes: Map<number, RowOutcome>): Promise<void> {
  const now = new Date();
  for (let index = 0; index < rows.length; index += CSV_LIMITS.batchSize) {
    const batch = rows.slice(index, index + CSV_LIMITS.batchSize);
    const prepared = batch.map(row => {
      const { computation } = priceFor(context, job, row);
      const suggested = computation?.suggestedPrice ?? null;
      return {
        row,
        productId: new Types.ObjectId(),
        sourceId: new Types.ObjectId(),
        price: job.applyPricingToNewProducts && suggested !== null ? suggested : 0,
        suggested,
      };
    });
    const landedProducts = await insertAndVerify(
      Product,
      prepared.map(item => productDoc(job, item.row, actor, item.price, item.productId))
    );
    const landedSources = await insertAndVerify(
      SupplierCatalogItem,
      prepared
        .filter(item => landedProducts.has(String(item.productId)))
        .map(item => ({ _id: item.sourceId, ...sourceDoc(job, item.row, item.productId, now) }))
    );
    const orphans: unknown[] = [];
    for (const item of prepared) {
      const productLanded = landedProducts.has(String(item.productId));
      if (productLanded && landedSources.has(String(item.sourceId))) {
        outcomes.set(item.row.rowNumber, {
          row: item.row,
          result: 'CREATED',
          action: 'CREATE',
          product: item.productId,
          source: item.sourceId,
          changes: { created: true, status: 'DRAFT', supplierCost: item.row.cost, sellingPrice: item.price, suggestedPrice: item.suggested },
        });
        continue;
      }
      if (productLanded) orphans.push(item.productId);
      item.row.errors.push({ code: 'ROW_WRITE_FAILED', message: 'The row could not be written; this supplier SKU may already exist.' });
      outcomes.set(item.row.rowNumber, { row: item.row, result: 'FAILED', action: 'FAIL' });
    }
    // A product with no sourcing record can never be published as DROPSHIP, so it is
    // removed rather than left behind as an unreviewable draft.
    if (orphans.length) await Product.deleteMany({ _id: { $in: orphans } });
  }
}

interface UpdateTarget {
  row: MappedRow;
  existing: any;
  product: any;
}

/** Refreshes existing supplier lines and, only where opted in, their canonical products. */
async function applyUpdates(job: any, targets: UpdateTarget[], outcomes: Map<number, RowOutcome>, significant: Record<string, unknown>[]): Promise<void> {
  const now = new Date();
  const overwrite = job.mapping?.allowFieldOverwrite ?? {};
  for (let index = 0; index < targets.length; index += CSV_LIMITS.batchSize) {
    const batch = targets.slice(index, index + CSV_LIMITS.batchSize);
    const sourceOps: any[] = [];
    const productOps: any[] = [];
    const sourceRowNumbers: number[] = [];
    for (const target of batch) {
      const { row, existing, product } = target;
      const patch = sourceDoc(job, row, existing.product, now);
      // A supplier line stays bound to the product it was first matched to; only an
      // admin may re-point it, never a feed.
      delete patch.product;
      sourceOps.push({ updateOne: { filter: { _id: existing._id }, update: { $set: patch } } });
      sourceRowNumbers.push(row.rowNumber);
      const changes = describeChanges(existing, row);
      const productPatch = productUpdate(product, row, overwrite);
      if (Object.keys(productPatch).length) productOps.push({ updateOne: { filter: { _id: existing.product }, update: { $set: productPatch } } });
      changes.productFields = Object.keys(productPatch);
      changes.sellingPricePreserved = true;
      outcomes.set(row.rowNumber, { row, result: 'UPDATED', action: 'UPDATE', product: existing.product, source: existing._id, changes });
      if (changes.cost && typeof changes.cost.percentChange === 'number' && Math.abs(changes.cost.percentChange) >= SIGNIFICANT_COST_CHANGE_PERCENT)
        significant.push({ supplierSku: row.supplierSku, product: String(existing.product), ...changes.cost });
    }
    try {
      if (sourceOps.length) await SupplierCatalogItem.bulkWrite(sourceOps, { ordered: false });
    } catch (error: any) {
      const failed = failedIndices(error);
      const affected = failed ?? sourceRowNumbers.map((_, position) => position);
      for (const position of affected) {
        const rowNumber = sourceRowNumbers[position];
        const outcome = rowNumber === undefined ? undefined : outcomes.get(rowNumber);
        if (!outcome) continue;
        outcome.row.errors.push({ code: 'ROW_WRITE_FAILED', message: 'The supplier line could not be updated.' });
        outcome.result = 'FAILED';
        outcome.action = 'FAIL';
      }
      if (!failed) throw error;
    }
    // Canonical product updates are opt-in and non-essential to the sourcing refresh, so a
    // failure here is reported on the row rather than failing the whole import.
    if (productOps.length) await Product.bulkWrite(productOps, { ordered: false }).catch(() => undefined);
  }
}

/** Persists per-row diagnostics in batches so a 5,000-row import writes ten documents, not 5,000. */
async function writeRows(job: any, outcomes: RowOutcome[]): Promise<void> {
  const docs = outcomes.map(outcome => ({
    job: job._id,
    rowNumber: outcome.row.rowNumber,
    supplierSku: clip(outcome.row.supplierSku, 120),
    productName: outcome.row.productName,
    result: outcome.result,
    action: outcome.action,
    ...(outcome.product ? { product: outcome.product } : {}),
    ...(outcome.source ? { supplierCatalogItem: outcome.source } : {}),
    errors: outcome.row.errors,
    warnings: outcome.row.warnings,
    ...(outcome.changes && Object.keys(outcome.changes).length ? { changes: outcome.changes } : {}),
  }));
  for (let index = 0; index < docs.length; index += CSV_LIMITS.batchSize) {
    const batch = docs.slice(index, index + CSV_LIMITS.batchSize);
    await CatalogImportRow.insertMany(batch, { ordered: false }).catch(() => undefined);
  }
}

/**
 * Aggregates row error codes into a bounded summary.
 *
 * Counts by code rather than a list of messages: §50 forbids logging whole CSV bodies,
 * and an operator needs to know "412 rows had COST_INVALID", not 412 near-identical
 * sentences.
 */
function summarizeErrors(outcomes: RowOutcome[]): { code: string; message: string; count: number }[] {
  const tally = new Map<string, { code: string; message: string; count: number }>();
  for (const outcome of outcomes)
    for (const error of outcome.row.errors) {
      const entry = tally.get(error.code);
      if (entry) entry.count += 1;
      else tally.set(error.code, { code: error.code, message: error.message, count: 1 });
    }
  return [...tally.values()].sort((left, right) => right.count - left.count).slice(0, 20);
}

/** Fields `productUpdate` and the preview compare against; nothing else is read. */
const PRODUCT_COMPARE_FIELDS = '_id name description category brand price costPrice status fulfillmentType supplierSuggestedRetailPrice sellingPriceOverridden';

async function executeImport(actor: string, job: any, entries: { column: string; target: MappingTarget }[], requestId?: string) {
  const document = await loadDocument(job);
  if (document.truncated) throw new CatalogImportError('CSV_TOO_MANY_ROWS', `The stored file exceeds the ${CSV_LIMITS.maxRows} row import limit.`);
  const rows = mapRows(document, entries);
  // A previous interrupted attempt may have left diagnostics behind; the atomic claim
  // guarantees no concurrent writer, so clearing them keeps a retry idempotent.
  await CatalogImportRow.deleteMany({ job: job._id });
  const sources = await existingSources(
    job.supplier,
    rows.map(row => row.supplierSku)
  );
  const productIds = [...sources.values()].map(item => item.product).filter(Boolean);
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } })
        .select(PRODUCT_COMPARE_FIELDS)
        .lean()
    : [];
  const productById = new Map<string, any>(products.map((product: any) => [String(product._id), product]));
  const context = await pricingContext(job);

  const outcomes = new Map<number, RowOutcome>();
  const creates: MappedRow[] = [];
  const updates: UpdateTarget[] = [];
  for (const row of rows) {
    if (row.errors.length) {
      outcomes.set(row.rowNumber, { row, result: 'INVALID', action: 'FAIL' });
      continue;
    }
    const existing = sources.get(row.supplierSku);
    if (!existing) {
      creates.push(row);
      continue;
    }
    const product = productById.get(String(existing.product)) ?? null;
    if (!product) {
      // The sourcing record outlived its product. Re-creating one silently would produce a
      // second catalogue entry for the same supplier line, so the row is reported instead.
      row.errors.push({ code: 'PRODUCT_MISSING', message: 'The product this supplier SKU is bound to no longer exists.' });
      outcomes.set(row.rowNumber, { row, result: 'FAILED', action: 'FAIL', source: existing._id });
      continue;
    }
    if (planFor(row, existing) === 'SKIP') {
      outcomes.set(row.rowNumber, { row, result: 'SKIPPED', action: 'SKIP', product: existing.product, source: existing._id, changes: { unchanged: true } });
      continue;
    }
    updates.push({ row, existing, product });
  }

  const significant: Record<string, unknown>[] = [];
  await applyCreates(job, actor, context, creates, outcomes);
  await applyUpdates(job, updates, outcomes, significant);
  const ordered = [...outcomes.values()].sort((left, right) => left.row.rowNumber - right.row.rowNumber);
  await writeRows(job, ordered);
  return { ordered, significant, requestId };
}

/**
 * Honest completion status (§54).
 *
 * COMPLETED means every row landed. One invalid or failed row is enough to make the job
 * PARTIAL, and a job where nothing landed at all is FAILED. There is no threshold below
 * which failures are rounded away to "success".
 */
function statusFor(counters: { invalidRows: number; failedRows: number; createdRows: number; updatedRows: number; skippedRows: number }): string {
  const problems = counters.invalidRows + counters.failedRows;
  const landed = counters.createdRows + counters.updatedRows + counters.skippedRows;
  if (problems === 0) return 'COMPLETED';
  if (landed === 0) return 'FAILED';
  return 'PARTIAL';
}

/**
 * Step 4 of 4. Applies the mapped file exactly once.
 *
 * Concurrency and retries are settled by one atomic claim of the READY job: the winner
 * imports, a concurrent caller is told the import is already running, and a caller who
 * retries after completion receives the finished job rather than a second set of
 * products (§44/§45). Every product created here is DRAFT (§13).
 */
export async function runImport(actor: string, jobId: string, requestId?: string) {
  const job = await loadJob(jobId);
  if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(job.status)) return { job: job.toObject(), replayed: true };
  if (job.status === 'IMPORTING') throw new CatalogImportError('IMPORT_IN_PROGRESS', 'This import is already running.', 409);
  if (job.status !== 'READY') throw new CatalogImportError('IMPORT_JOB_NOT_READY', `A ${job.status} import job cannot be imported.`, 409);
  const entries = mappedEntries(job);
  const claimed = await CatalogImportJob.findOneAndUpdate(
    { _id: job._id, status: 'READY' },
    { $set: { status: 'IMPORTING', startedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const current = await CatalogImportJob.findById(job._id).lean();
    if (current && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(current.status)) return { job: current, replayed: true };
    throw new CatalogImportError('IMPORT_IN_PROGRESS', 'This import is already running.', 409);
  }
  try {
    return await finishImport(actor, claimed, entries, requestId);
  } catch (error: any) {
    await CatalogImportJob.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          errorSummary: [{ code: error?.code || 'IMPORT_FAILED', message: 'The import stopped before any rows could be processed.', count: 1 }],
        },
      }
    );
    throw error;
  }
}

async function finishImport(actor: string, job: any, entries: { column: string; target: MappingTarget }[], requestId?: string) {
  const { ordered, significant } = await executeImport(actor, job, entries, requestId);
  const count = (result: string) => ordered.filter(outcome => outcome.result === result).length;
  const counters = {
    totalRows: ordered.length,
    invalidRows: count('INVALID'),
    createdRows: count('CREATED'),
    updatedRows: count('UPDATED'),
    skippedRows: count('SKIPPED'),
    failedRows: count('FAILED'),
  };
  const validRows = counters.totalRows - counters.invalidRows;
  const status = statusFor(counters);
  const updated = await CatalogImportJob.findOneAndUpdate(
    { _id: job._id },
    { $set: { ...counters, validRows, status, completedAt: new Date(), errorSummary: summarizeErrors(ordered) } },
    { new: true }
  ).lean();
  await AuditLog.create({
    actor,
    action: 'CATALOG_IMPORT_COMPLETED',
    resourceType: 'CatalogImportJob',
    resourceId: String(job._id),
    requestId,
    metadata: { jobNumber: job.jobNumber, status, ...counters, validRows },
  });
  // One bounded entry for the whole import rather than one per row (§50).
  if (significant.length)
    await AuditLog.create({
      actor,
      action: 'CATALOG_IMPORT_COST_CHANGES',
      resourceType: 'CatalogImportJob',
      resourceId: String(job._id),
      requestId,
      metadata: {
        jobNumber: job.jobNumber,
        thresholdPercent: SIGNIFICANT_COST_CHANGE_PERCENT,
        count: significant.length,
        changes: significant.slice(0, 20),
      },
    });
  return { job: updated, replayed: false };
}

/**
 * Abandons a job that has not started importing.
 *
 * Deliberately not available once the import is running or finished: a CANCELLED job
 * must never be a way to disown products that were already created.
 */
export async function cancelJob(actor: string, jobId: string, requestId?: string) {
  const cancelled = await CatalogImportJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['UPLOADED', 'VALIDATING', 'READY'] } },
    { $set: { status: 'CANCELLED', completedAt: new Date() } },
    { new: true }
  ).lean();
  if (!cancelled) {
    const exists = await CatalogImportJob.findById(jobId).select('_id status').lean();
    if (!exists) throw new CatalogImportError('IMPORT_JOB_NOT_FOUND', 'Import job not found.', 404);
    throw new CatalogImportError('IMPORT_JOB_NOT_CANCELLABLE', `A ${exists.status} import job can no longer be cancelled.`, 409);
  }
  await AuditLog.create({
    actor,
    action: 'CATALOG_IMPORT_CANCELLED',
    resourceType: 'CatalogImportJob',
    resourceId: String(cancelled._id),
    requestId,
    metadata: { jobNumber: cancelled.jobNumber },
  });
  return cancelled;
}

export async function listJobs(query: { supplierId?: string; status?: string; from?: string; to?: string; page: number; limit: number }) {
  const filter: Record<string, unknown> = {};
  if (query.supplierId) filter.supplier = query.supplierId;
  if (query.status) filter.status = query.status;
  const createdAt: Record<string, Date> = {};
  if (query.from) createdAt.$gte = new Date(query.from);
  if (query.to) createdAt.$lte = new Date(query.to);
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  const [items, total] = await Promise.all([
    CatalogImportJob.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    CatalogImportJob.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getJob(jobId: string) {
  const job = await CatalogImportJob.findById(jobId).lean();
  if (!job) throw new CatalogImportError('IMPORT_JOB_NOT_FOUND', 'Import job not found.', 404);
  return job;
}

/** Paginated row diagnostics. A 5,000-row job is never returned in one response (§52). */
export async function listRows(jobId: string, query: { result?: string; page: number; limit: number }) {
  await getJob(jobId);
  const filter: Record<string, unknown> = { job: jobId };
  if (query.result) filter.result = query.result;
  const [items, total] = await Promise.all([
    CatalogImportRow.find(filter)
      .sort({ rowNumber: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    CatalogImportRow.countDocuments(filter),
  ]);
  return { items, total };
}
