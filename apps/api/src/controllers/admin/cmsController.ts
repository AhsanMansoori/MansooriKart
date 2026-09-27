import type { NextFunction, Request, Response } from 'express';
import { NAV_MENUS } from '../../config/storefront.js';
import { AuditLog } from '../../models/auditLog.js';
import { CmsPage, Faq } from '../../models/cmsPage.js';
import { adminCmsPage, adminFaq, adminNavigationMenu } from '../../serializers/marketingAdmin.js';
import { ensureNavigationMenu, missingReferences, orderedNavigation, publishFields } from '../../services/cmsService.js';
import { sendFailure, sendSuccess } from '../../utils/api-response.js';
import { escapeRegex, isObjectId, slugify } from '../../utils/sanitize.js';

const audit = (request: Request, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}) =>
  AuditLog.create({ actor: request.auth!.userId, action, resourceType, resourceId, requestId: request.requestId, metadata });

const meta = (page: number, limit: number, total: number) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
};

const missing = (request: Request, response: Response, code: string, message: string) => sendFailure(response, 404, code, message, request.requestId);
const badReferences = (request: Request, response: Response, refs: string[]) =>
  sendFailure(response, 400, 'REFERENCE_NOT_FOUND', `Unknown reference: ${refs.join(', ')}`, request.requestId);

const searchFilter = (search: string | undefined, fields: string[]) =>
  search ? { $or: fields.map(field => ({ [field]: { $regex: escapeRegex(search), $options: 'i' } })) } : {};

const sorts: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  title: { title: 1 },
  slug: { slug: 1 },
  position: { position: 1, createdAt: 1 },
};

const pageNotFound = (request: Request, response: Response) => missing(request, response, 'PAGE_NOT_FOUND', 'Page not found.');
const faqNotFound = (request: Request, response: Response) => missing(request, response, 'FAQ_NOT_FOUND', 'FAQ not found.');

function navReferences(items: any[]) {
  const categories: string[] = [];
  const products: string[] = [];
  const pages: string[] = [];
  for (const item of items)
    for (const entry of [item, ...(item.children ?? [])]) {
      if (entry.category) categories.push(String(entry.category));
      if (entry.product) products.push(String(entry.product));
      if (entry.page) pages.push(String(entry.page));
    }
  return { categories, products, pages };
}

const menuName = (value: unknown): string | null => {
  const menu = String(value ?? '').toUpperCase();
  return NAV_MENUS.includes(menu) ? menu : null;
};

export const listPages = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = { ...(query.status ? { status: query.status } : {}), ...searchFilter(query.search, ['title', 'slug']) };
    const [data, total] = await Promise.all([
      CmsPage.find(filter)
        .sort(sorts[query.sort] ?? sorts.newest)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CmsPage.countDocuments(filter),
    ]);
    return sendSuccess(response, data.map(adminCmsPage), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const createPage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    await CmsPage.init();
    const slug = request.body.slug ?? slugify(request.body.title);
    if (!slug)
      return sendFailure(response, 400, 'PAGE_INVALID', 'A page slug could not be derived from the title. Supply `slug` explicitly.', request.requestId);
    const page = await CmsPage.create({
      ...request.body,
      slug,
      ...publishFields(request.body.status, null),
      createdBy: request.auth!.userId,
      updatedBy: request.auth!.userId,
    });
    await audit(request, 'CMS_PAGE_CREATED', 'CmsPage', String(page._id), { slug: page.slug, status: page.status });
    return sendSuccess(response, adminCmsPage(page.toObject()), 201);
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'PAGE_SLUG_EXISTS', 'A page with that slug already exists.', request.requestId);
    return next(error);
  }
};

export const getPageById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return pageNotFound(request, response);
    const page = await CmsPage.findById(request.params.id).lean();
    return page ? sendSuccess(response, adminCmsPage(page)) : pageNotFound(request, response);
  } catch (error) {
    return next(error);
  }
};

export const patchPage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return pageNotFound(request, response);
    const page = await CmsPage.findById(request.params.id);
    if (!page) return pageNotFound(request, response);
    const patch: Record<string, unknown> = { ...request.body, ...publishFields(request.body.status, page) };
    const fields = Object.keys(request.body).filter(key => JSON.stringify((page as any)[key] ?? null) !== JSON.stringify((patch as any)[key] ?? null));
    Object.assign(page, patch, { updatedBy: request.auth!.userId });
    await page.save();
    if (fields.length) await audit(request, 'CMS_PAGE_UPDATED', 'CmsPage', String(page._id), { slug: page.slug, fields });
    return sendSuccess(response, adminCmsPage(page.toObject()));
  } catch (error: any) {
    if (error?.code === 11000) return sendFailure(response, 409, 'PAGE_SLUG_EXISTS', 'A page with that slug already exists.', request.requestId);
    return next(error);
  }
};

export const publishPage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return pageNotFound(request, response);
    const page = await CmsPage.findById(request.params.id);
    if (!page) return pageNotFound(request, response);
    if (page.status !== 'PUBLISHED') {
      Object.assign(page, publishFields('PUBLISHED', page), { status: 'PUBLISHED', updatedBy: request.auth!.userId });
      await page.save();
      await audit(request, 'CMS_PAGE_PUBLISHED', 'CmsPage', String(page._id), { slug: page.slug });
    }
    return sendSuccess(response, adminCmsPage(page.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const archivePage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return pageNotFound(request, response);
    const page = await CmsPage.findById(request.params.id);
    if (!page) return pageNotFound(request, response);
    if (page.status !== 'ARCHIVED') {
      Object.assign(page, publishFields('ARCHIVED', page), { status: 'ARCHIVED', updatedBy: request.auth!.userId });
      await page.save();
      await audit(request, 'CMS_PAGE_ARCHIVED', 'CmsPage', String(page._id), { slug: page.slug });
    }
    return sendSuccess(response, adminCmsPage(page.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const deletePage = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return pageNotFound(request, response);
    const page = await CmsPage.findById(request.params.id);
    if (!page) return pageNotFound(request, response);
    page.status = 'ARCHIVED';
    page.updatedBy = request.auth!.userId;
    await page.save();
    await audit(request, 'CMS_PAGE_ARCHIVED', 'CmsPage', String(page._id), { slug: page.slug });
    return sendSuccess(response, { id: String(page._id), archived: true });
  } catch (error) {
    return next(error);
  }
};

export const listFaqs = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const query = request.query as any;
    const filter: Record<string, unknown> = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: { $regex: new RegExp(`^${escapeRegex(query.category)}$`, 'i') } } : {}),
      ...searchFilter(query.search, ['question', 'answer', 'category']),
    };
    const [data, total] = await Promise.all([
      Faq.find(filter)
        .sort(sorts[query.sort] ?? sorts.position)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Faq.countDocuments(filter),
    ]);
    return sendSuccess(response, data.map(adminFaq), 200, meta(query.page, query.limit, total));
  } catch (error) {
    return next(error);
  }
};

export const createFaq = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const faq = await Faq.create({ ...request.body, createdBy: request.auth!.userId, updatedBy: request.auth!.userId });
    await audit(request, 'FAQ_CREATED', 'Faq', String(faq._id), { category: faq.category, status: faq.status });
    return sendSuccess(response, adminFaq(faq.toObject()), 201);
  } catch (error) {
    return next(error);
  }
};

export const reorderFaqs = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const ids: string[] = request.body.ids;
    const found = await Faq.find({ _id: { $in: ids } })
      .select('_id')
      .lean();
    if (found.length !== new Set(ids).size) return faqNotFound(request, response);
    await Faq.bulkWrite(
      ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { position: index, updatedBy: request.auth!.userId } } } }))
    );
    await audit(request, 'FAQ_REORDERED', 'Faq', 'collection', { count: ids.length });
    return sendSuccess(response, { reordered: ids.length });
  } catch (error) {
    return next(error);
  }
};

export const getFaqById = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return faqNotFound(request, response);
    const faq = await Faq.findById(request.params.id).lean();
    return faq ? sendSuccess(response, adminFaq(faq)) : faqNotFound(request, response);
  } catch (error) {
    return next(error);
  }
};

export const patchFaq = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return faqNotFound(request, response);
    const faq = await Faq.findById(request.params.id);
    if (!faq) return faqNotFound(request, response);
    const fields = Object.keys(request.body).filter(key => String((faq as any)[key] ?? '') !== String((request.body as any)[key] ?? ''));
    Object.assign(faq, request.body, { updatedBy: request.auth!.userId });
    await faq.save();
    if (fields.length) await audit(request, 'FAQ_UPDATED', 'Faq', String(faq._id), { fields });
    return sendSuccess(response, adminFaq(faq.toObject()));
  } catch (error) {
    return next(error);
  }
};

export const deleteFaq = async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (!isObjectId(request.params.id)) return faqNotFound(request, response);
    const faq = await Faq.findById(request.params.id);
    if (!faq) return faqNotFound(request, response);
    faq.status = 'ARCHIVED';
    faq.updatedBy = request.auth!.userId;
    await faq.save();
    await audit(request, 'FAQ_ARCHIVED', 'Faq', String(faq._id), {});
    return sendSuccess(response, { id: String(faq._id), archived: true });
  } catch (error) {
    return next(error);
  }
};

export const listNavigationMenus = async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const menus = await Promise.all(NAV_MENUS.map(menu => ensureNavigationMenu(menu)));
    return sendSuccess(
      response,
      menus.map(menu => adminNavigationMenu({ ...menu.toObject(), items: orderedNavigation(menu) }))
    );
  } catch (error) {
    return next(error);
  }
};

export const getNavigationMenu = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const menu = menuName(request.params.menu);
    if (!menu) return missing(request, response, 'MENU_NOT_FOUND', 'Menu not found.');
    const record = await ensureNavigationMenu(menu);
    return sendSuccess(response, adminNavigationMenu({ ...record.toObject(), items: orderedNavigation(record) }));
  } catch (error) {
    return next(error);
  }
};

export const updateNavigationMenu = async (request: Request, response: Response, next: NextFunction) => {
  try {
    const menu = menuName(request.params.menu);
    if (!menu) return missing(request, response, 'MENU_NOT_FOUND', 'Menu not found.');
    const items: any[] = request.body.items;
    const unknown = await missingReferences(navReferences(items));
    if (unknown.length) return badReferences(request, response, unknown);
    const record = await ensureNavigationMenu(menu);
    record.items = items;
    record.updatedBy = request.auth!.userId;
    await record.save();
    await audit(request, 'NAVIGATION_UPDATED', 'NavigationMenu', String(record._id), { menu, items: items.length });
    return sendSuccess(response, adminNavigationMenu({ ...record.toObject(), items: orderedNavigation(record) }));
  } catch (error) {
    return next(error);
  }
};
