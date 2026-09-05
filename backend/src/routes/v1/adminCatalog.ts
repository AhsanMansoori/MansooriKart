import express from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { validate } from '../../middleware/validate.js';
import { AuditLog } from '../../models/auditLog.js';
import { Brand } from '../../models/brand.js';
import { CatalogAttribute } from '../../models/catalogAttribute.js';
import { Category } from '../../models/category.js';
import { ProductBadge } from '../../models/productBadge.js';
import { Product } from '../../models/product.js';
import { ProductType } from '../../models/productType.js';
import {
  archiveProducts,
  evaluatePublication,
  publicationIssuesFor,
  publishProducts,
  PublicationError,
  type PublicationIssue,
} from '../../services/publicationService.js';
import * as serialize from '../../serializers/index.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

const router = express.Router();
const objectId = /^[a-f\d]{24}$/i;
const idParams = z.object({ id: z.string().regex(objectId) }).strict();
const status = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const catalogStatus = z.enum(['ACTIVE', 'ARCHIVED']);
const safeText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalUrl = z.string().trim().url().max(2048).optional();
const productImage = z
  .object({
    url: z.string().trim().url().max(2048),
    alt: z.string().trim().max(240).optional(),
    position: z.number().int().min(0).max(1000).default(0),
    isPrimary: z.boolean().optional(),
  })
  .strict();
const productFields = {
  name: safeText(240),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(180),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/)
    .max(80),
  description: safeText(5000),
  shortDescription: optionalText(500),
  category: safeText(120),
  brand: optionalText(120),
  image: z.string().trim().url().max(2048),
  images: z.array(productImage).max(20).optional(),
  price: z.number().finite().min(0),
  compareAtPrice: z.number().finite().min(0).optional(),
  costPrice: z.number().finite().min(0).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('PKR'),
  stock: z.number().int().min(0).max(10_000_000).default(0),
  lowStockThreshold: z.number().int().min(0).max(10_000_000).default(5),
  status: status.default('DRAFT'),
  // Which shelf the goods ship from. Everything else about a dropship product — its
  // supplier, cost and stock — arrives through the CSV import and is never client input.
  fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).default('OWN_STOCK'),
  featured: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  productType: z.string().regex(objectId).nullable().optional(),
  badges: z.array(z.string().regex(objectId)).max(20).default([]),
  seo: z
    .object({ title: optionalText(160), description: optionalText(320) })
    .strict()
    .optional(),
};
const productRules = (value: any, context: z.RefinementCtx) => {
  if (value.compareAtPrice !== undefined && value.price !== undefined && value.compareAtPrice < value.price)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['compareAtPrice'], message: 'Compare-at price cannot be less than price.' });
  if (value.images?.filter((image: any) => image.isPrimary).length && value.images.filter((image: any) => image.isPrimary).length !== 1)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['images'], message: 'At most one primary image is allowed.' });
};
const productBody = z.object(productFields).strict().superRefine(productRules);
const productPatch = z
  .object({
    name: safeText(240).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .optional(),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/)
      .max(80)
      .optional(),
    description: safeText(5000).optional(),
    shortDescription: optionalText(500),
    category: safeText(120).optional(),
    brand: optionalText(120),
    image: z.string().trim().url().max(2048).optional(),
    images: z.array(productImage).max(20).optional(),
    price: z.number().finite().min(0).optional(),
    compareAtPrice: z.number().finite().min(0).optional(),
    costPrice: z.number().finite().min(0).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    stock: z.number().int().min(0).max(10_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000_000).optional(),
    status: status.optional(),
    fulfillmentType: z.enum(['OWN_STOCK', 'DROPSHIP']).optional(),
    featured: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    productType: z.string().regex(objectId).nullable().optional(),
    badges: z.array(z.string().regex(objectId)).max(20).optional(),
    seo: z
      .object({ title: optionalText(160), description: optionalText(320) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine(productRules);
const productQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: status.optional(),
    category: z.string().trim().max(120).optional(),
    brand: z.string().trim().max(120).optional(),
    featured: z.enum(['true', 'false']).optional(),
    stockState: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
    search: z.string().trim().min(1).max(80).optional(),
    sort: z.enum(['newest', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc']).default('newest'),
  })
  .strict();
const entityBody = (fields: Record<string, z.ZodTypeAny>) => z.object(fields).strict();
const categoryCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(2000),
  image: optionalUrl,
  parent: z.string().regex(objectId).nullable().optional(),
  status: catalogStatus.default('ACTIVE'),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
const brandCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(2000),
  logo: optionalUrl,
  status: catalogStatus.default('ACTIVE'),
});
const typeCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(2000),
  status: catalogStatus.default('ACTIVE'),
});
const badgeCreate = entityBody({
  name: safeText(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(400),
  status: catalogStatus.default('ACTIVE'),
});
const value = entityBody({
  value: safeText(120),
  label: optionalText(120),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  status: catalogStatus.default('ACTIVE'),
});
const attributeCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(['TEXT', 'SELECT', 'COLOR', 'SIZE', 'STORAGE']).default('SELECT'),
  values: z.array(value).max(100).default([]),
  status: catalogStatus.default('ACTIVE'),
});
const escapeRegex = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pageMeta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};
const audit = async (request: express.Request, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>) =>
  AuditLog.create({ actor: request.auth!.userId, action, resourceType, resourceId, requestId: request.requestId, metadata });
const isDuplicate = (error: unknown) => (error as { code?: number })?.code === 11000;
const duplicateCode = (error: any) => (error?.keyPattern?.sku ? 'PRODUCT_SKU_EXISTS' : error?.keyPattern?.slug ? 'SLUG_EXISTS' : 'RESOURCE_EXISTS');
const routeError = (error: unknown, request: express.Request, next: express.NextFunction) => {
  if (isDuplicate(error)) return next(new ApiError(409, duplicateCode(error), 'A resource with that unique value already exists.'));
  return next(error);
};
const ensureReferences = async (data: Record<string, any>) => {
  if (data.productType && !(await ProductType.exists({ _id: data.productType, status: 'ACTIVE' })))
    throw new ApiError(400, 'PRODUCT_TYPE_INVALID', 'Product type is not available.');
  if (data.badges?.length && (await ProductBadge.countDocuments({ _id: { $in: data.badges }, status: 'ACTIVE' })) !== data.badges.length)
    throw new ApiError(400, 'BADGE_INVALID', 'One or more badges are not available.');
};
/**
 * A bulk publication target list. The outer bound is generous on purpose so the domain
 * limit in `publicationService` reports its own `PRODUCT_IDS_TOO_MANY` rather than being
 * masked by a validation error.
 */
const publishBody = z.object({ productIds: z.array(z.string().regex(objectId)).min(1).max(500) }).strict();
const noBody = z.object({}).strict();
const publicationFailure = (error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) =>
  error instanceof PublicationError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);
/** Issue codes travel in the message because the error envelope carries no detail field. */
const notPublishable = (issues: PublicationIssue[]) => `The product cannot be published: ${issues.map(item => item.code).join(', ')}.`;

router.use(requireAuth, requireSuperAdmin);

router.get('/products', validate(productQuery, 'query'), async (request, response, next) => {
  try {
    const query = request.query as unknown as z.infer<typeof productQuery>;
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.brand) filter.brand = query.brand;
    if (query.featured) filter.featured = query.featured === 'true';
    if (query.stockState === 'OUT_OF_STOCK') filter.stock = 0;
    if (query.stockState === 'IN_STOCK') filter.stock = { $gt: 0 };
    if (query.stockState === 'LOW_STOCK') filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', { $ifNull: ['$lowStockThreshold', 5] }] }] };
    if (query.search)
      filter.$or = [
        { name: { $regex: escapeRegex(query.search), $options: 'i' } },
        { sku: { $regex: escapeRegex(query.search), $options: 'i' } },
        { slug: { $regex: escapeRegex(query.search), $options: 'i' } },
      ];
    const sorts: Record<string, Record<string, 1 | -1>> = {
      newest: { createdAt: -1 },
      name_asc: { name: 1 },
      name_desc: { name: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      stock_asc: { stock: 1 },
      stock_desc: { stock: -1 },
    };
    const [data, total] = await Promise.all([
      Product.find(filter)
        .sort(sorts[query.sort])
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    return sendSuccess(response, data.map(serialize.adminProduct), 200, pageMeta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
});
router.get('/products/:id', validate(idParams, 'params'), async (request, response, next) => {
  try {
    const item = await Product.findById(request.params.id).lean();
    return item
      ? sendSuccess(response, serialize.adminProduct(item))
      : sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
});
router.post('/products', validate(productBody), async (request, response, next) => {
  try {
    const data = request.body as z.infer<typeof productBody>;
    await ensureReferences(data);
    // Creating straight into ACTIVE is publishing, so it passes the same gate as the
    // publish route. Without this the create endpoint would be a second door onto the
    // storefront that skips every launch-critical check (§22).
    const publishing = data.status === 'ACTIVE';
    if (publishing) {
      const issues = await publicationIssuesFor(data);
      if (issues.length) return sendFailure(response, 400, 'PRODUCT_NOT_PUBLISHABLE', notPublishable(issues), request.requestId);
    }
    const item = await Product.create({
      ...data,
      createdBy: request.auth!.userId,
      ...(publishing ? { publishedAt: new Date(), publishedBy: request.auth!.userId } : {}),
    });
    await audit(request, 'PRODUCT_CREATED', 'Product', String(item._id), { sku: item.sku, slug: item.slug, status: item.status });
    return sendSuccess(response, serialize.adminProduct(item.toObject()), 201);
  } catch (error) {
    return routeError(error, request, next);
  }
});
router.patch('/products/:id', validate(idParams, 'params'), validate(productPatch), async (request, response, next) => {
  try {
    const data = request.body as z.infer<typeof productPatch>;
    const current = await Product.findById(request.params.id).lean();
    if (!current) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    const effectivePrice = data.price ?? current.price;
    const effectiveCompareAtPrice = data.compareAtPrice ?? current.compareAtPrice;
    if (effectiveCompareAtPrice !== undefined && effectiveCompareAtPrice < effectivePrice)
      return sendFailure(response, 400, 'VALIDATION_ERROR', 'Compare-at price cannot be less than price.', request.requestId);
    await ensureReferences(data);
    // Same gate as create, judged on the product as it would be after the patch. Patching
    // an already-ACTIVE product is left alone: that is an edit, not a publication.
    const publishing = data.status === 'ACTIVE' && current.status !== 'ACTIVE';
    if (publishing) {
      const issues = await publicationIssuesFor({ ...current, ...data });
      if (issues.length) return sendFailure(response, 400, 'PRODUCT_NOT_PUBLISHABLE', notPublishable(issues), request.requestId);
    }
    const update: Record<string, unknown> = { ...data };
    // §19: a price an admin typed by hand is a decision, so it is marked as such and a
    // later automatic pricing pass preserves it unless explicitly told otherwise.
    if (data.price !== undefined) update.sellingPriceOverridden = true;
    if (publishing) {
      update.publishedAt = new Date();
      update.publishedBy = request.auth!.userId;
    }
    const item = await Product.findByIdAndUpdate(request.params.id, { $set: update }, { new: true, runValidators: true }).lean();
    if (!item) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    await audit(request, 'PRODUCT_UPDATED', 'Product', String(item._id), { fields: Object.keys(data).sort() });
    return sendSuccess(response, serialize.adminProduct(item));
  } catch (error) {
    return routeError(error, request, next);
  }
});
router.delete('/products/:id', validate(idParams, 'params'), async (request, response, next) => {
  try {
    const item = await Product.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED', featured: false } }, { new: true }).lean();
    if (!item) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    await audit(request, 'PRODUCT_ARCHIVED', 'Product', String(item._id), {});
    return sendSuccess(response, serialize.adminProduct(item));
  } catch (error) {
    return next(error);
  }
});

/**
 * Publication (§22, §23).
 *
 * Three shapes: a dry run that reports every reason each product may not go live, a bulk
 * publish that publishes what passes and reports the rest untouched, and a single publish
 * that refuses rather than silently no-op. Archiving needs no field checks — pulling an
 * incomplete product is exactly what an operator wants — so it only reports what existed.
 */
router.post('/products/publish-preview', validate(publishBody), async (request, response, next) => {
  try {
    const candidates = await evaluatePublication(request.body.productIds);
    return sendSuccess(response, {
      candidates,
      summary: { requested: candidates.length, publishable: candidates.filter(item => item.publishable).length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
});
router.post('/products/publish', validate(publishBody), async (request, response, next) => {
  try {
    const result = await publishProducts(request.auth!.userId, request.body.productIds, request.requestId);
    return sendSuccess(response, {
      ...result,
      summary: { requested: request.body.productIds.length, publishedCount: result.published.length, rejectedCount: result.rejected.length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
});
router.post('/products/archive', validate(publishBody), async (request, response, next) => {
  try {
    const result = await archiveProducts(request.auth!.userId, request.body.productIds, request.requestId);
    return sendSuccess(response, {
      ...result,
      summary: { requested: request.body.productIds.length, archivedCount: result.archived.length, missingCount: result.missing.length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
});
router.post('/products/:id/publish', validate(idParams, 'params'), validate(noBody), async (request, response, next) => {
  try {
    const { published, rejected } = await publishProducts(request.auth!.userId, [String(request.params.id)], request.requestId);
    if (!published.length) {
      const issues = rejected[0]?.issues ?? [];
      return issues.some(item => item.code === 'PRODUCT_NOT_FOUND')
        ? sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId)
        : sendFailure(response, 400, 'PRODUCT_NOT_PUBLISHABLE', notPublishable(issues), request.requestId);
    }
    const item = await Product.findById(request.params.id).lean();
    return item
      ? sendSuccess(response, serialize.adminProduct(item))
      : sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
});

function registerSimpleEntity(path: string, resourceType: string, Model: any, createSchema: any, transform?: (item: any) => any) {
  const patch = createSchema.partial().strict();
  const list = z
    .object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: catalogStatus.optional() })
    .strict();
  router.get(path, validate(list, 'query'), async (request, response, next) => {
    try {
      const query: any = request.query;
      const filter = query.status ? { status: query.status } : {};
      const [data, total] = await Promise.all([
        Model.find(filter)
          .sort({ name: 1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        Model.countDocuments(filter),
      ]);
      return sendSuccess(
        response,
        data.map((item: any) => (transform ? transform(item) : { id: String(item._id), ...item })),
        200,
        pageMeta(query.page, query.limit, total)
      );
    } catch (error) {
      return next(error);
    }
  });
  router.get(`${path}/:id`, validate(idParams, 'params'), async (request, response, next) => {
    try {
      const item = await Model.findById(request.params.id).lean();
      return item
        ? sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item })
        : sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
    } catch (error) {
      return next(error);
    }
  });
  router.post(path, validate(createSchema), async (request, response, next) => {
    try {
      const item = await Model.create(request.body);
      await audit(request, `${resourceType.toUpperCase()}_CREATED`, resourceType, String(item._id), { slug: item.slug });
      return sendSuccess(response, transform ? transform(item.toObject()) : { id: String(item._id), ...item.toObject() }, 201);
    } catch (error) {
      return routeError(error, request, next);
    }
  });
  router.patch(`${path}/:id`, validate(idParams, 'params'), validate(patch), async (request, response, next) => {
    try {
      const item = await Model.findByIdAndUpdate(request.params.id, { $set: request.body }, { new: true, runValidators: true }).lean();
      if (!item) return sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
      await audit(request, `${resourceType.toUpperCase()}_UPDATED`, resourceType, String(item._id), { fields: Object.keys(request.body).sort() });
      return sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item });
    } catch (error) {
      return routeError(error, request, next);
    }
  });
  router.delete(`${path}/:id`, validate(idParams, 'params'), async (request, response, next) => {
    try {
      const item = await Model.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED' } }, { new: true }).lean();
      if (!item) return sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
      await audit(request, `${resourceType.toUpperCase()}_ARCHIVED`, resourceType, String(item._id), {});
      return sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item });
    } catch (error) {
      return next(error);
    }
  });
}

registerSimpleEntity('/categories', 'Category', Category, categoryCreate, serialize.adminCategory);
registerSimpleEntity('/brands', 'Brand', Brand, brandCreate, serialize.adminBrand);
registerSimpleEntity('/product-types', 'ProductType', ProductType, typeCreate);
registerSimpleEntity('/attributes', 'CatalogAttribute', CatalogAttribute, attributeCreate);
registerSimpleEntity('/badges', 'ProductBadge', ProductBadge, badgeCreate);

export default router;
