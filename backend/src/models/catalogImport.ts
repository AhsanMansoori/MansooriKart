import { Schema, model, models, type Model } from 'mongoose';

/**
 * One column mapping entry: a header as it appears in the supplier's file, bound to
 * a MansooriKart target field. Unmapped columns are ignored, never persisted, so a
 * supplier cannot smuggle arbitrary fields into the catalog by adding columns.
 */
const mappingEntrySchema = new Schema(
  {
    column: { type: String, required: true, trim: true, maxlength: 120 },
    target: {
      type: String,
      required: true,
      enum: [
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
      ],
    },
  },
  { _id: false }
);

/**
 * The mapping decisions plus the field-level update policy for one job.
 *
 * `allowFieldOverwrite` defaults to nothing: on a repeat import the supplier feed
 * updates cost, stock and availability, while admin-curated canonical fields —
 * title, description, category, brand, images — are preserved unless the operator
 * explicitly opts each one in. That default is the whole point; a supplier feed
 * must not silently undo an admin's merchandising work.
 */
const mappingSchema = new Schema(
  {
    entries: { type: [mappingEntrySchema], default: [] },
    allowFieldOverwrite: {
      name: { type: Boolean, default: false },
      description: { type: Boolean, default: false },
      category: { type: Boolean, default: false },
      brand: { type: Boolean, default: false },
      images: { type: Boolean, default: false },
    },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

/**
 * A CSV catalog import run.
 *
 * Statuses are honest by design: `COMPLETED` is reported only when no row failed,
 * and any failure downgrades the job to `PARTIAL` (or `FAILED` when nothing landed).
 * `jobNumber` and every counter are server-owned and rejected by the route
 * allowlists. See CSV_CATALOG_IMPORT_ARCHITECTURE.md.
 */
const catalogImportJobSchema = new Schema(
  {
    jobNumber: { type: String, required: true, unique: true, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    fileName: { type: String, required: true, trim: true, maxlength: 260 },
    fileSize: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['UPLOADED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'],
      default: 'UPLOADED',
      index: true,
    },
    headers: { type: [String], default: [] },
    mapping: { type: mappingSchema, default: () => ({}) },
    pricingRule: { type: Schema.Types.ObjectId, ref: 'PricingRule', default: null },
    /** When true, newly created DRAFT products receive a rule-derived suggested price. */
    applyPricingToNewProducts: { type: Boolean, default: true },
    fulfillmentType: { type: String, enum: ['OWN_STOCK', 'DROPSHIP'], default: 'DROPSHIP' },
    totalRows: { type: Number, default: 0, min: 0 },
    validRows: { type: Number, default: 0, min: 0 },
    invalidRows: { type: Number, default: 0, min: 0 },
    createdRows: { type: Number, default: 0, min: 0 },
    updatedRows: { type: Number, default: 0, min: 0 },
    skippedRows: { type: Number, default: 0, min: 0 },
    failedRows: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Bounded, human-readable summary. Never raw file content and never a stack trace. */
    errorSummary: { type: [{ code: String, message: String, count: Number, _id: false }], default: [] },
  },
  { timestamps: true, collection: 'catalogimportjobs' }
);
catalogImportJobSchema.index({ status: 1, createdAt: -1 });
catalogImportJobSchema.index({ supplier: 1, createdAt: -1 });
export const CatalogImportJob: any = (models.CatalogImportJob as Model<any>) || model('CatalogImportJob', catalogImportJobSchema);

/**
 * Per-row diagnostics: what the row contained, what happened to it, and why.
 *
 * `errors` and `warnings` carry stable domain codes and operator-readable messages.
 * Parser internals, driver text and stack traces are translated before they get
 * here, so a diagnostics response can be shown to an admin safely.
 */
const catalogImportRowSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'CatalogImportJob', required: true, index: true },
    rowNumber: { type: Number, required: true, min: 1 },
    supplierSku: { type: String, trim: true, maxlength: 120 },
    productName: { type: String, trim: true, maxlength: 300 },
    result: { type: String, enum: ['VALID', 'INVALID', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED'], required: true, index: true },
    /** What the import did, once it acted. `NONE` while the row is only validated. */
    action: { type: String, enum: ['NONE', 'CREATE', 'UPDATE', 'SKIP', 'FAIL'], default: 'NONE' },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    supplierCatalogItem: { type: Schema.Types.ObjectId, ref: 'SupplierCatalogItem' },
    errors: { type: [{ code: String, field: String, message: String, _id: false }], default: [] },
    warnings: { type: [{ code: String, field: String, message: String, _id: false }], default: [] },
    /** Cost/stock movement observed on a repeat import, for operator review. */
    changes: { type: Schema.Types.Mixed, default: undefined },
  },
  // `errors` is a Mongoose-reserved pathname. It is kept because §7 names it as the row
  // diagnostics field and only document-level `doc.errors` introspection is affected,
  // which this model never uses.
  { timestamps: true, collection: 'catalogimportrows', suppressReservedKeysWarning: true }
);
// Row diagnostics are always read scoped to a job, ordered by row, and often filtered by result.
catalogImportRowSchema.index({ job: 1, rowNumber: 1 }, { unique: true });
catalogImportRowSchema.index({ job: 1, result: 1, rowNumber: 1 });
export const CatalogImportRow: any = (models.CatalogImportRow as Model<any>) || model('CatalogImportRow', catalogImportRowSchema);

/**
 * An optional saved mapping per supplier so a recurring feed need not be re-mapped
 * by hand. Deliberately unversioned: the latest mapping for a supplier is the
 * mapping. Historical mappings remain available on the jobs that used them.
 */
const catalogMappingTemplateSchema = new Schema(
  {
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    mapping: { type: mappingSchema, default: () => ({}) },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'catalogmappingtemplates' }
);
export const CatalogMappingTemplate: any = (models.CatalogMappingTemplate as Model<any>) || model('CatalogMappingTemplate', catalogMappingTemplateSchema);
