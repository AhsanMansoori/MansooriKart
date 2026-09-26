import { Schema, model, models, type Model } from 'mongoose';

/**
 * The uploaded CSV text, retained between upload, mapping confirmation, preview and
 * import because those are four separate requests and the server must not trust the
 * client to resend the same bytes at each step.
 *
 * It lives in its own collection rather than on `CatalogImportJob` so that listing
 * job history never drags megabytes of file content through the driver. Content is
 * bounded by `CSV_LIMITS.maxFileBytes`, which is far below the BSON document limit.
 *
 * Only explicitly mapped columns are ever promoted out of here into the catalog, so
 * an unmapped column containing a credential is ignored rather than stored on a
 * product.
 */
const catalogImportFileSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'CatalogImportJob', required: true, unique: true, index: true },
    contentType: { type: String, default: 'text/csv' },
    byteLength: { type: Number, required: true, min: 0 },
    content: { type: String, required: true },
  },
  { timestamps: true, collection: 'catalogimportfiles' }
);
export const CatalogImportFile: any = (models.CatalogImportFile as Model<any>) || model('CatalogImportFile', catalogImportFileSchema);
