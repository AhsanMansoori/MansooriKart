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
/**
 * Customer-facing order projection.
 *
 * An order line carries snapshots that exist for finance and fulfillment — `unitCost`,
 * `lineCost`, `supplier`, `supplierSku`, `supplierCost` — and none of them belong in a
 * customer payload (§30, §56). This is an allowlist rather than a delete list, so a field
 * added to the order schema later cannot leak by default. `fulfillmentType` is also
 * withheld: which shelf the goods ship from is internal routing, not customer-facing
 * terminology (§33).
 *
 * `_id` is preserved alongside the rest because the customer order contract already
 * exposes it and clients key off it.
 */
export const customerOrderItem = (value: Record<string, unknown>) => ({
  productId: value.productId,
  name: value.name,
  sku: value.sku,
  image: value.image,
  unitPrice: value.unitPrice,
  quantity: value.quantity,
  lineSubtotal: value.lineSubtotal,
});
export const customerOrder = (value: Record<string, any>) => ({
  _id: value._id,
  orderNumber: value.orderNumber,
  invoiceNumber: value.invoiceNumber,
  items: (value.items ?? []).map((item: Record<string, unknown>) => customerOrderItem(item)),
  shippingAddress: value.shippingAddress ?? null,
  subtotal: value.subtotal,
  discount: value.discount,
  shipping: value.shipping,
  tax: value.tax,
  total: value.total,
  currency: value.currency ?? 'PKR',
  coupon: value.coupon ? { code: value.coupon.code, type: value.coupon.type, value: value.coupon.value, actualDiscount: value.coupon.actualDiscount } : null,
  paymentMethod: value.paymentMethod,
  paymentStatus: value.paymentStatus,
  orderStatus: value.orderStatus,
  // Only the customer-meaningful part of the trail: no actor id, no request id.
  statusHistory: (value.statusHistory ?? []).map((entry: Record<string, unknown>) => ({
    status: entry.status,
    from: entry.from ?? null,
    to: entry.to,
    reason: entry.reason ?? null,
    at: entry.at ?? null,
  })),
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
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
  // Dropshipping additions. All admin-only: `product()` above deliberately omits
  // every one of them, so no supplier or sourcing detail reaches the storefront.
  fulfillmentType: value.fulfillmentType ?? 'OWN_STOCK',
  sourceType: value.sourceType ?? 'MANUAL',
  sellingPriceOverridden: Boolean(value.sellingPriceOverridden),
  supplierSuggestedRetailPrice: value.supplierSuggestedRetailPrice ?? null,
  publishedAt: value.publishedAt ?? null,
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
