import express from 'express';
import { z } from 'zod';
import { AuditLog } from '../../models/auditLog.js';
import { Banner } from '../../models/banner.js';
import { Promotion } from '../../models/promotion.js';
import { adminBanner, adminHomepage, adminPromotion } from '../../serializers/marketingAdmin.js';
import { ensureHomepageConfiguration, missingReferences, orderedSections } from '../../services/cmsService.js';
import { defaultHomepageSections } from '../../services/storefrontService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId, slugify } from '../../utils/sanitize.js';

const audit = (r: any, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) =>
  AuditLog.create({ actor: r.auth!.userId, action, resourceType, resourceId, requestId: r.requestId, metadata });

const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

const missing = (r: any, s: any, code: string, message: string) => sendFailure(s, 404, code, message, r.requestId);
const badReferences = (r: any, s: any, refs: string[]) => sendFailure(s, 400, 'REFERENCE_NOT_FOUND', `Unknown reference: ${refs.join(', ')}`, r.requestId);

const sorts: Record<string, Record<string, 1 | -1>> = {
  priority: { priority: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  title: { title: 1 },
};

const REQUIRED_LINK: Record<string, string> = {
  INTERNAL_PATH: 'linkPath',
  PRODUCT: 'linkProduct',
  CATEGORY: 'linkCategory',
  PROMOTION: 'linkPromotion',
  EXTERNAL_URL: 'linkUrl',
};

function coherenceError(merged: any): string | null {
  if (merged.startAt && merged.endAt && new Date(merged.startAt).getTime() >= new Date(merged.endAt).getTime()) return '`endAt` must be after `startAt`.';
  const field = REQUIRED_LINK[String(merged.linkType ?? 'NONE')];
  if (field && (merged[field] === undefined || merged[field] === null)) return `${field} is required when linkType is ${merged.linkType}.`;
  return null;
}

const searchFilter = (search: string | undefined, fields: string[]) =>
  search ? { $or: fields.map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } })) } : {};

const bannerRefs = (body: Record<string, any>) => ({
  products: body.linkProduct ? [body.linkProduct] : [],
  categories: [body.linkCategory, body.category].filter(Boolean),
  promotions: body.linkPromotion ? [body.linkPromotion] : [],
});

function homepageReferences(sections: any[]) {
  const products: string[] = [];
  const categories: string[] = [];
  const promotions: string[] = [];
  for (const section of sections) {
    const settings = section.settings ?? {};
    if (Array.isArray(settings.products)) products.push(...settings.products);
    if (Array.isArray(settings.categories)) categories.push(...settings.categories);
    if (settings.promotion) promotions.push(String(settings.promotion));
  }
  return { products, categories, promotions };
}

export async function getPromotions(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const query: any = r.query;
    const now = new Date();
    const filter: Record<string, unknown> = { ...searchFilter(query.search, ['name', 'slug', 'headline']) };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      Promotion.find(filter)
        .sort(sorts[query.sort] ?? sorts.priority)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Promotion.countDocuments(filter),
    ]);
    return sendSuccess(
      s,
      data.map((record: any) => adminPromotion(record, now)),
      200,
      meta(query.page, query.limit, total)
    );
  } catch (e) {
    return n(e);
  }
}

export async function createPromotion(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    await Promotion.init();
    const body = r.body as Record<string, any>;
    const slug = body.slug ?? slugify(String(body.name));
    if (!slug) return sendFailure(s, 400, 'PROMOTION_INVALID', 'A URL slug could not be derived from the name; supply `slug`.', r.requestId);
    const refs = await missingReferences({ products: body.linkProduct ? [body.linkProduct] : [], categories: body.linkCategory ? [body.linkCategory] : [] });
    if (refs.length) return badReferences(r, s, refs);
    const record = await Promotion.create({ ...body, slug, createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'PROMOTION_CREATED', 'Promotion', String(record._id), { slug, status: record.status });
    return sendSuccess(s, adminPromotion(record.toObject()), 201);
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PROMOTION_SLUG_EXISTS', 'A promotion with that slug already exists.', r.requestId);
    return n(e);
  }
}

export async function getPromotionById(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const record = await Promotion.findById(r.params.id).lean();
    return record ? sendSuccess(s, adminPromotion(record)) : missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
  } catch (e) {
    return n(e);
  }
}

export async function updatePromotion(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const existing = await Promotion.findById(r.params.id);
    if (!existing) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const patch = r.body as Record<string, any>;
    const error = coherenceError({ ...existing.toObject(), ...patch });
    if (error) return sendFailure(s, 400, 'PROMOTION_INVALID', error, r.requestId);
    const refs = await missingReferences({
      products: patch.linkProduct ? [patch.linkProduct] : [],
      categories: patch.linkCategory ? [patch.linkCategory] : [],
    });
    if (refs.length) return badReferences(r, s, refs);
    const changed = Object.keys(patch).filter(key => String((existing as any)[key] ?? '') !== String(patch[key] ?? ''));
    Object.assign(existing, patch, { updatedBy: r.auth!.userId });
    await existing.save();
    if (changed.length) await audit(r, 'PROMOTION_UPDATED', 'Promotion', String(existing._id), { slug: existing.slug, fields: changed });
    return sendSuccess(s, adminPromotion(existing.toObject()));
  } catch (e: any) {
    if (e?.code === 11000) return sendFailure(s, 409, 'PROMOTION_SLUG_EXISTS', 'A promotion with that slug already exists.', r.requestId);
    return n(e);
  }
}

export async function setPromotionStatus(r: express.Request, s: express.Response, n: express.NextFunction, status: 'ACTIVE' | 'ARCHIVED', action: string) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const record = await Promotion.findById(r.params.id);
    if (!record) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    if (record.status !== status) {
      record.status = status;
      record.updatedBy = r.auth!.userId;
      await record.save();
      await audit(r, action, 'Promotion', String(record._id), { slug: record.slug, status });
    }
    return sendSuccess(s, adminPromotion(record.toObject()));
  } catch (e) {
    return n(e);
  }
}

export async function deletePromotion(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    const record = await Promotion.findById(r.params.id);
    if (!record) return missing(r, s, 'PROMOTION_NOT_FOUND', 'Promotion not found.');
    record.status = 'ARCHIVED';
    record.updatedBy = r.auth!.userId;
    await record.save();
    await audit(r, 'PROMOTION_ARCHIVED', 'Promotion', String(record._id), { slug: record.slug });
    return sendSuccess(s, { id: String(record._id), archived: true });
  } catch (e) {
    return n(e);
  }
}

export async function getBanners(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const query: any = r.query;
    const now = new Date();
    const filter: Record<string, unknown> = { ...searchFilter(query.search, ['title', 'subtitle']) };
    if (query.status) filter.status = query.status;
    if (query.placement) filter.placement = query.placement;
    if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    const [data, total] = await Promise.all([
      Banner.find(filter)
        .sort(sorts[query.sort] ?? sorts.priority)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Banner.countDocuments(filter),
    ]);
    return sendSuccess(
      s,
      data.map((record: any) => adminBanner(record, now)),
      200,
      meta(query.page, query.limit, total)
    );
  } catch (e) {
    return n(e);
  }
}

export async function createBanner(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const refs = await missingReferences(bannerRefs(r.body));
    if (refs.length) return badReferences(r, s, refs);
    const record = await Banner.create({ ...r.body, createdBy: r.auth!.userId, updatedBy: r.auth!.userId });
    await audit(r, 'BANNER_CREATED', 'Banner', String(record._id), { placement: record.placement, status: record.status });
    return sendSuccess(s, adminBanner(record.toObject()), 201);
  } catch (e) {
    return n(e);
  }
}

export async function getBannerById(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const record = await Banner.findById(r.params.id).lean();
    return record ? sendSuccess(s, adminBanner(record)) : missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
  } catch (e) {
    return n(e);
  }
}

export async function updateBanner(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const existing = await Banner.findById(r.params.id);
    if (!existing) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const patch = r.body as Record<string, any>;
    const merged = { ...existing.toObject(), ...patch };
    const error =
      coherenceError(merged) ?? (merged.placement === 'CATEGORY_HERO' && !merged.category ? 'category is required for a CATEGORY_HERO banner.' : null);
    if (error) return sendFailure(s, 400, 'BANNER_INVALID', error, r.requestId);
    const refs = await missingReferences(bannerRefs(patch));
    if (refs.length) return badReferences(r, s, refs);
    const changed = Object.keys(patch).filter(key => String((existing as any)[key] ?? '') !== String(patch[key] ?? ''));
    Object.assign(existing, patch, { updatedBy: r.auth!.userId });
    await existing.save();
    if (changed.length) await audit(r, 'BANNER_UPDATED', 'Banner', String(existing._id), { placement: existing.placement, fields: changed });
    return sendSuccess(s, adminBanner(existing.toObject()));
  } catch (e) {
    return n(e);
  }
}

export async function setBannerStatus(r: express.Request, s: express.Response, n: express.NextFunction, status: 'ACTIVE' | 'ARCHIVED', action: string) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const record = await Banner.findById(r.params.id);
    if (!record) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    if (record.status !== status) {
      record.status = status;
      record.updatedBy = r.auth!.userId;
      await record.save();
      await audit(r, action, 'Banner', String(record._id), { placement: record.placement, status });
    }
    return sendSuccess(s, adminBanner(record.toObject()));
  } catch (e) {
    return n(e);
  }
}

export async function deleteBanner(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    if (!isObjectId(r.params.id)) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    const record = await Banner.findById(r.params.id);
    if (!record) return missing(r, s, 'BANNER_NOT_FOUND', 'Banner not found.');
    record.status = 'ARCHIVED';
    record.updatedBy = r.auth!.userId;
    await record.save();
    await audit(r, 'BANNER_ARCHIVED', 'Banner', String(record._id), { placement: record.placement });
    return sendSuccess(s, { id: String(record._id), archived: true });
  } catch (e) {
    return n(e);
  }
}

export async function reorderBanners(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const ids: string[] = r.body.ids;
    const found = await Banner.find({ _id: { $in: ids } })
      .select('_id')
      .lean();
    if (found.length !== new Set(ids).size) return missing(r, s, 'BANNER_NOT_FOUND', 'One or more banners were not found.');
    await Banner.bulkWrite(
      ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { priority: ids.length - index, updatedBy: r.auth!.userId } } } }))
    );
    await audit(r, 'BANNER_REORDERED', 'Banner', 'collection', { count: ids.length });
    return sendSuccess(s, { reordered: ids.length });
  } catch (e) {
    return n(e);
  }
}

export async function getHomepage(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const config = await ensureHomepageConfiguration();
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
}

export async function updateHomepage(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const submitted: any[] = r.body.sections;
    const sections = submitted.length ? submitted : defaultHomepageSections();
    const unknown = await missingReferences(homepageReferences(sections));
    if (unknown.length) return badReferences(r, s, unknown);
    const config = await ensureHomepageConfiguration();
    config.sections = sections;
    config.updatedBy = r.auth!.userId;
    await config.save();
    await audit(r, 'HOMEPAGE_UPDATED', 'HomepageConfiguration', String(config._id), {
      sections: sections.length,
      keys: sections.map((section: any) => section.key),
    });
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
}

export async function reorderHomepage(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const keys: string[] = r.body.keys;
    const config = await ensureHomepageConfiguration();
    const sections = orderedSections(config);
    const known = new Set(sections.map((section: any) => String(section.key)));
    const unknown = keys.filter(key => !known.has(key));
    if (unknown.length || new Set(keys).size !== keys.length) return missing(r, s, 'HOMEPAGE_SECTION_NOT_FOUND', 'One or more sections were not found.');
    const rank = new Map(keys.map((key, index) => [key, index]));
    config.sections = sections
      .slice()
      .sort((a: any, b: any) => (rank.get(String(a.key)) ?? keys.length + (a.position ?? 0)) - (rank.get(String(b.key)) ?? keys.length + (b.position ?? 0)))
      .map((section: any, index: number) => ({ ...(typeof section?.toObject === 'function' ? section.toObject() : section), position: index * 10 }));
    config.updatedBy = r.auth!.userId;
    await config.save();
    await audit(r, 'HOMEPAGE_REORDERED', 'HomepageConfiguration', String(config._id), { keys });
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
}

export async function updateHomepageSection(r: express.Request, s: express.Response, n: express.NextFunction) {
  try {
    const key = String(r.params.key).trim().toLowerCase();
    const config = await ensureHomepageConfiguration();
    const section = (config.sections ?? []).find((entry: any) => String(entry.key) === key);
    if (!section) return missing(r, s, 'HOMEPAGE_SECTION_NOT_FOUND', 'Section not found.');
    const changed = Boolean(section.enabled) !== r.body.enabled;
    if (changed) {
      section.enabled = r.body.enabled;
      config.updatedBy = r.auth!.userId;
      await config.save();
      await audit(r, 'HOMEPAGE_UPDATED', 'HomepageConfiguration', String(config._id), { section: key, enabled: r.body.enabled });
    }
    return sendSuccess(s, adminHomepage(config));
  } catch (e) {
    return n(e);
  }
}
