import { Schema, model, models, type Model } from 'mongoose';

/**
 * The link between one supplier's catalog line and one MansooriKart `Product`.
 *
 * This is a *sourcing* record, not a sellable product. The customer-facing product
 * remains the single canonical `Product` document; this row records what a supplier
 * says about it — their SKU, their cost, their reported stock — so repeated imports
 * update one source instead of creating duplicate products.
 *
 * Supplier stock lives here and nowhere else. It is deliberately NOT written into
 * `InventoryBalance`: that collection is the authority for MansooriKart-owned
 * physical inventory only, and a number copied from a CSV is neither owned nor
 * transactionally guaranteed. See DROPSHIPPING_ARCHITECTURE.md.
 */
const supplierCatalogItemSchema = new Schema(
  {
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    /** The supplier's own identifier. Unique per supplier, never used as MansooriKart identity. */
    supplierSku: { type: String, required: true, trim: true, maxlength: 120 },
    supplierProductName: { type: String, trim: true, maxlength: 300 },
    supplierCost: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'PKR', uppercase: true, maxlength: 3 },
    /** Supplier-reported quantity. Advisory only — see `supplierStockUpdatedAt`. */
    supplierStock: { type: Number, min: 0 },
    supplierAvailability: { type: String, enum: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'], default: 'UNKNOWN', index: true },
    supplierStockUpdatedAt: { type: Date },
    /** Digest of the mapped source row, used to skip rows that did not change. Internal. */
    sourceRowHash: { type: String, maxlength: 64 },
    sourceExternalId: { type: String, trim: true, maxlength: 200 },
    sourceImageUrls: { type: [String], default: [] },
    lastImportedAt: { type: Date },
    lastImportJob: { type: Schema.Types.ObjectId, ref: 'CatalogImportJob' },
    isActive: { type: Boolean, default: true, index: true },
    /** Bounded, explicitly mapped extras only. Unmapped CSV columns are never stored here. */
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'suppliercatalogitems' }
);
// Deterministic import matching: one supplier SKU resolves to exactly one source row.
supplierCatalogItemSchema.index({ supplier: 1, supplierSku: 1 }, { unique: true });
supplierCatalogItemSchema.index({ product: 1, supplier: 1 });
supplierCatalogItemSchema.index({ supplier: 1, supplierAvailability: 1 });
supplierCatalogItemSchema.index({ supplierStockUpdatedAt: -1 });
export const SupplierCatalogItem: any = (models.SupplierCatalogItem as Model<any>) || model('SupplierCatalogItem', supplierCatalogItemSchema);
