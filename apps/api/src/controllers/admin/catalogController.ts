import express from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { AuditLog } from '../../models/auditLog.js';
import { Brand } from '../../models/brand.js';
import { CatalogAttribute } from '../../models/catalogAttribute.js';
import { Category } from '../../models/category.js';
import { ProductBadge } from '../../models/productBadge.js';
import { Product } from '../../models/product.js';
import { ProductType } from '../../models/productType.js';
import * as serialize from '../../serializers/index.js';
import {
  archiveProducts,
  evaluatePublication,
  publicationIssuesFor,
  publishProducts,
  PublicationError,
  type PublicationIssue,
} from '../../services/publicationService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';

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

const publicationFailure = (error: unknown, request: express.Request, response: express.Response, next: express.NextFunction) =>
  error instanceof PublicationError ? sendFailure(response, error.status, error.code, error.message, request.requestId) : next(error);

const notPublishable = (issues: PublicationIssue[]) => `The product cannot be published: ${issues.map(item => item.code).join(', ')}.`;

export async function getProducts(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const query = request.query as any;
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
}

export async function getProductById(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const item = await Product.findById(request.params.id).lean();
    return item
      ? sendSuccess(response, serialize.adminProduct(item))
      : sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
  } catch (error) {
    return next(error);
  }
}

export async function createProduct(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const data = request.body;
    await Product.init();
    await ensureReferences(data);
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
}

export async function updateProduct(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const data = request.body;
    const current = await Product.findById(request.params.id).lean();
    if (!current) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    const effectivePrice = data.price ?? current.price;
    const effectiveCompareAtPrice = data.compareAtPrice ?? current.compareAtPrice;
    if (effectiveCompareAtPrice !== undefined && effectiveCompareAtPrice < effectivePrice)
      return sendFailure(response, 400, 'VALIDATION_ERROR', 'Compare-at price cannot be less than price.', request.requestId);
    await ensureReferences(data);
    const publishing = data.status === 'ACTIVE' && current.status !== 'ACTIVE';
    if (publishing) {
      const issues = await publicationIssuesFor({ ...current, ...data });
      if (issues.length) return sendFailure(response, 400, 'PRODUCT_NOT_PUBLISHABLE', notPublishable(issues), request.requestId);
    }
    const update: Record<string, unknown> = { ...data };
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
}

export async function archiveProduct(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const item = await Product.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED', featured: false } }, { new: true }).lean();
    if (!item) return sendFailure(response, 404, 'PRODUCT_NOT_FOUND', 'Product not found.', request.requestId);
    await audit(request, 'PRODUCT_ARCHIVED', 'Product', String(item._id), {});
    return sendSuccess(response, serialize.adminProduct(item));
  } catch (error) {
    return next(error);
  }
}

export async function previewPublishProducts(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const candidates = await evaluatePublication(request.body.productIds);
    return sendSuccess(response, {
      candidates,
      summary: { requested: candidates.length, publishable: candidates.filter(item => item.publishable).length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
}

export async function publishProductsBulk(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const result = await publishProducts(request.auth!.userId, request.body.productIds, request.requestId);
    return sendSuccess(response, {
      ...result,
      summary: { requested: request.body.productIds.length, publishedCount: result.published.length, rejectedCount: result.rejected.length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
}

export async function archiveProductsBulk(request: express.Request, response: express.Response, next: express.NextFunction) {
  try {
    const result = await archiveProducts(request.auth!.userId, request.body.productIds, request.requestId);
    return sendSuccess(response, {
      ...result,
      summary: { requested: request.body.productIds.length, archivedCount: result.archived.length, missingCount: result.missing.length },
    });
  } catch (error) {
    return publicationFailure(error, request, response, next);
  }
}

export async function publishSingleProduct(request: express.Request, response: express.Response, next: express.NextFunction) {
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
}

export function createEntityHandlers(resourceType: string, Model: any, transform?: (item: any) => any) {
  return {
    list: async (request: express.Request, response: express.Response, next: express.NextFunction) => {
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
    },
    get: async (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try {
        const item = await Model.findById(request.params.id).lean();
        return item
          ? sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item })
          : sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
      } catch (error) {
        return next(error);
      }
    },
    create: async (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try {
        const item = await Model.create(request.body);
        await audit(request, `${resourceType.toUpperCase()}_CREATED`, resourceType, String(item._id), { slug: item.slug });
        return sendSuccess(response, transform ? transform(item.toObject()) : { id: String(item._id), ...item.toObject() }, 201);
      } catch (error) {
        return routeError(error, request, next);
      }
    },
    update: async (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try {
        const item = await Model.findByIdAndUpdate(request.params.id, { $set: request.body }, { new: true, runValidators: true }).lean();
        if (!item) return sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
        await audit(request, `${resourceType.toUpperCase()}_UPDATED`, resourceType, String(item._id), { fields: Object.keys(request.body).sort() });
        return sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item });
      } catch (error) {
        return routeError(error, request, next);
      }
    },
    archive: async (request: express.Request, response: express.Response, next: express.NextFunction) => {
      try {
        const item = await Model.findByIdAndUpdate(request.params.id, { $set: { status: 'ARCHIVED' } }, { new: true }).lean();
        if (!item) return sendFailure(response, 404, 'RESOURCE_NOT_FOUND', 'Resource not found.', request.requestId);
        await audit(request, `${resourceType.toUpperCase()}_ARCHIVED`, resourceType, String(item._id), {});
        return sendSuccess(response, transform ? transform(item) : { id: String(item._id), ...item });
      } catch (error) {
        return next(error);
      }
    },
  };
}
