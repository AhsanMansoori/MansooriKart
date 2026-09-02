export const asId = (value: { _id?: { toString(): string } } | null | undefined): string | undefined => value?._id?.toString();
export const user = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  id: asId(value),
  name: value.name,
  email: value.email,
  phone: value.phone,
  avatar: value.avatar,
  role: value.role,
  status: value.status,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
export const address = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  id: asId(value),
  label: value.label,
  fullName: value.fullName,
  phone: value.phone,
  addressLine1: value.addressLine1,
  addressLine2: value.addressLine2,
  city: value.city,
  stateProvince: value.stateProvince,
  postalCode: value.postalCode,
  country: value.country,
  isDefault: value.isDefault,
});
export const category = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  id: asId(value),
  name: value.name,
  slug: value.slug,
  description: value.description,
  image: value.image,
  parent: value.parent,
  sortOrder: value.sortOrder,
});
export const brand = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  id: asId(value),
  name: value.name,
  slug: value.slug,
  description: value.description,
  logo: value.logo,
});
export const adminCategory = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  ...category(value),
  status: value.status,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
export const adminBrand = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  ...brand(value),
  status: value.status,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
export const product = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  id: asId(value),
  name: value.name,
  slug: value.slug,
  sku: value.sku,
  description: value.description,
  shortDescription: value.shortDescription,
  category: value.category,
  brand: value.brand,
  images: value.images || (value.image ? [{ url: value.image, alt: value.name, position: 0 }] : []),
  price: value.price,
  compareAtPrice: value.compareAtPrice,
  currency: value.currency || 'PKR',
  availableStock: value.stock,
  featured: Boolean(value.featured),
  ratingAverage: value.ratingAverage ?? value.rating ?? 0,
  ratingCount: value.ratingCount ?? value.numReviews ?? 0,
});
export const adminProduct = (value: Record<string, unknown> & { _id?: { toString(): string } }) => ({
  ...product(value),
  costPrice: value.costPrice,
  stock: value.stock,
  lowStockThreshold: value.lowStockThreshold ?? 5,
  status: value.status ?? 'ACTIVE',
  tags: value.tags || [],
  productType: value.productType ? String(value.productType) : null,
  badges: (value.badges as unknown[] | undefined)?.map(String) || [],
  seo: value.seo,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
