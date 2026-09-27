import express from 'express';
import * as controller from '../../../controllers/admin/settingsController.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import {
  contactSchema,
  emailSchema,
  invoiceSchema,
  maintenanceSchema,
  seoSchema,
  shippingSchema,
  socialSchema,
  storeSchema,
  taxSchema,
} from './settingsSchemas.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

router.get('/settings', controller.getSettings);
router.patch('/settings/store', validate(storeSchema), controller.patchStoreSettings);
router.patch('/settings/contact', validate(contactSchema), controller.patchContactSettings);
router.patch('/settings/social', validate(socialSchema), controller.patchSocialSettings);
router.patch('/settings/seo', validate(seoSchema), controller.patchSeoSettings);
router.patch('/settings/shipping', validate(shippingSchema), controller.patchShippingSettings);
router.patch('/settings/tax', validate(taxSchema), controller.patchTaxSettings);
router.patch('/settings/invoice', validate(invoiceSchema), controller.patchInvoiceSettings);
router.patch('/settings/email', validate(emailSchema), controller.patchEmailSettings);
router.patch('/settings/maintenance', validate(maintenanceSchema), controller.patchMaintenanceSettings);

export default router;
