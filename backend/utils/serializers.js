function idOf(value) {
  return value?._id?.toString?.() || value?.id?.toString?.() || value?.toString?.() || undefined;
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: idOf(user),
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt || user.date,
    updatedAt: user.updatedAt,
  };
}

function serializeProduct(product) {
  if (!product) return null;
  return {
    id: idOf(product),
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription,
    category: product.category,
    brand: product.brand,
    images: product.images?.length ? product.images : product.image ? [{ url: product.image, alt: product.name, position: 0 }] : [],
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency || 'PKR',
    availableStock: product.stock,
    ratingAverage: product.ratingAverage ?? product.rating ?? 0,
    ratingCount: product.ratingCount ?? product.numReviews ?? 0,
    featured: Boolean(product.featured),
    tags: product.tags || [],
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

module.exports = { serializeProduct, serializeUser };
