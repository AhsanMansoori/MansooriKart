import express from 'express';
import { z } from 'zod';
import { CONTENT_LIMITS, CONTENT_STATUSES, FAQ_STATUSES, NAV_TARGET_TYPES, ROBOTS_DIRECTIVES } from '../../../config/storefront.js';
import { requireAuth, requireSuperAdmin } from '../../../middleware/auth.js';
import { validate } from '../../../middleware/validate.js';
import { blocksField, httpUrl, internalPath, objectIdField, optionalPlainText, plainText, slugField } from '../../../utils/contentSchemas.js';
import * as controller from '../../../controllers/admin/cmsController.js';

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(CONTENT_LIMITS.maxPageSize).default(CONTENT_LIMITS.defaultPageSize),
});

const seoFields = z
  .object({
    metaTitle: optionalPlainText(CONTENT_LIMITS.maxTitleLength),
    metaDescription: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    canonicalUrl: httpUrl.optional(),
    robots: z.enum(ROBOTS_DIRECTIVES as [string, ...string[]]).optional(),
  })
  .strict();

const pageFields = z
  .object({
    title: plainText(CONTENT_LIMITS.maxTitleLength).optional(),
    slug: slugField.optional(),
    excerpt: optionalPlainText(CONTENT_LIMITS.maxShortTextLength),
    blocks: blocksField.optional(),
    seo: seoFields.optional(),
    status: z.enum(CONTENT_STATUSES as [string, ...string[]]).optional(),
  })
  .strict();

const pageCreate = pageFields.superRefine((value, context) => {
  if (!value.title) context.addIssue({ code: z.ZodIssueCode.custom, path: ['title'], message: 'title is required.' });
});

const pageQuery = pagination
  .extend({
    status: z.enum(CONTENT_STATUSES as [string, ...string[]]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['newest', 'oldest', 'title', 'slug']).default('newest'),
  })
  .strict();

const faqFields = z
  .object({
    question: plainText(CONTENT_LIMITS.maxShortTextLength).optional(),
    answer: plainText(CONTENT_LIMITS.maxLongTextLength).optional(),
    category: optionalPlainText(120),
    position: z.number().int().min(0).max(10_000).optional(),
    status: z.enum(FAQ_STATUSES as [string, ...string[]]).optional(),
  })
  .strict();

const faqCreate = faqFields.superRefine((value, context) => {
  if (!value.question) context.addIssue({ code: z.ZodIssueCode.custom, path: ['question'], message: 'question is required.' });
  if (!value.answer) context.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: 'answer is required.' });
});

const faqQuery = pagination
  .extend({
    status: z.enum(FAQ_STATUSES as [string, ...string[]]).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sort: z.enum(['position', 'newest', 'oldest']).default('position'),
  })
  .strict();

const navTargetFields = {
  label: plainText(120),
  type: z.enum(NAV_TARGET_TYPES as [string, ...string[]]),
  path: internalPath.optional(),
  category: objectIdField.optional(),
  product: objectIdField.optional(),
  page: objectIdField.optional(),
  url: httpUrl.optional(),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0).max(1_000).default(0),
};

const REQUIRED_NAV_FIELD: Record<string, string> = { INTERNAL_PATH: 'path', CATEGORY: 'category', PRODUCT: 'product', CMS_PAGE: 'page', EXTERNAL_URL: 'url' };

function refineNavTarget(value: any, context: z.RefinementCtx): void {
  const field = REQUIRED_NAV_FIELD[value.type];
  if (field && (value[field] === undefined || value[field] === null))
    context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required when type is ${value.type}.` });
}

const navChild = z.object(navTargetFields).strict().superRefine(refineNavTarget);
const navItem = z
  .object({ ...navTargetFields, children: z.array(navChild).max(CONTENT_LIMITS.maxNavChildren).default([]) })
  .strict()
  .superRefine(refineNavTarget);
const navSchema = z.object({ items: z.array(navItem).max(CONTENT_LIMITS.maxNavItems) }).strict();

router.get('/pages', validate(pageQuery, 'query'), controller.listPages);
router.post('/pages', validate(pageCreate), controller.createPage);
router.get('/pages/:id', controller.getPageById);
router.patch('/pages/:id', validate(pageFields), controller.patchPage);
router.post('/pages/:id/publish', controller.publishPage);
router.post('/pages/:id/archive', controller.archivePage);
router.delete('/pages/:id', controller.deletePage);

router.get('/faqs', validate(faqQuery, 'query'), controller.listFaqs);
router.post('/faqs', validate(faqCreate), controller.createFaq);
router.post('/faqs/reorder', validate(z.object({ ids: z.array(objectIdField).min(1).max(CONTENT_LIMITS.maxReorderItems) }).strict()), controller.reorderFaqs);
router.get('/faqs/:id', controller.getFaqById);
router.patch('/faqs/:id', validate(faqFields), controller.patchFaq);
router.delete('/faqs/:id', controller.deleteFaq);

router.get('/navigation', controller.listNavigationMenus);
router.get('/navigation/:menu', controller.getNavigationMenu);
router.put('/navigation/:menu', validate(navSchema), controller.updateNavigationMenu);

export default router;
