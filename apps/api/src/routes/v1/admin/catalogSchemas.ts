import { z } from 'zod';

export const objectId = /^[a-f\d]{24}$/i;
export const idParams = z.object({ id: z.string().regex(objectId) }).strict();
export const status = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const catalogStatus = z.enum(['ACTIVE', 'ARCHIVED']);
export const safeText = (max: number) => z.string().trim().min(1).max(max);
export const optionalText = (max: number) => z.string().trim().max(max).optional();
export const optionalUrl = z.string().trim().url().max(2048).optional();

export const productImage = z
  .object({
    url: z.string().trim().url().max(2048),
    alt: z.string().trim().max(240).optional(),
    position: z.number().int().min(0).max(1000).default(0),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const productFields = {
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

export const productRules = (value: any, context: z.RefinementCtx) => {
  if (value.compareAtPrice !== undefined && value.price !== undefined && value.compareAtPrice < value.price)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['compareAtPrice'], message: 'Compare-at price cannot be less than price.' });
  if (value.images?.filter((image: any) => image.isPrimary).length && value.images.filter((image: any) => image.isPrimary).length !== 1)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['images'], message: 'At most one primary image is allowed.' });
};

export const productBody = z.object(productFields).strict().superRefine(productRules);

export const productPatch = z
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

export const productQuery = z
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

export const entityBody = (fields: Record<string, z.ZodTypeAny>) => z.object(fields).strict();

export const categoryCreate = entityBody({
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

export const brandCreate = entityBody({
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

export const typeCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(2000),
  status: catalogStatus.default('ACTIVE'),
});

export const attributeValue = entityBody({
  value: safeText(120),
  label: optionalText(120),
  sortOrder: z.number().int().min(0).max(100000).default(0),
  status: catalogStatus.default('ACTIVE'),
});

export const attributeCreate = entityBody({
  name: safeText(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(['TEXT', 'SELECT', 'COLOR', 'SIZE', 'STORAGE']).default('SELECT'),
  values: z.array(attributeValue).max(100).default([]),
  status: catalogStatus.default('ACTIVE'),
});

export const badgeCreate = entityBody({
  name: safeText(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: optionalText(500),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  status: catalogStatus.default('ACTIVE'),
});

export const publishBody = z.object({ productIds: z.array(z.string().regex(objectId)).min(1).max(500) }).strict();
export const noBody = z.object({}).strict();
