/**
 * The boundary between the v1 catalog contract and the storefront view model.
 *
 * The API publishes `availableStock`, an `images[]` array and `ratingAverage`/`ratingCount`;
 * the components in this application render `stock`, a single `image` and `rating`/`numReviews`.
 * Adapting once here keeps that difference in one file instead of spreading contract knowledge
 * through every page, and it keeps the components unchanged.
 */
const firstImage = product => {
  if (typeof product.image === 'string' && product.image) return product.image;
  const images = Array.isArray(product.images) ? product.images : [];
  const primary = images.find(entry => entry && (typeof entry === 'string' || entry.url));
  if (!primary) return undefined;
  return typeof primary === 'string' ? primary : primary.url;
};

export const normalizeProduct = product => {
  if (!product) {
    return product;
  }

  const canonicalId = product._id || product.id;
  return { ...product, _id: canonicalId, id: canonicalId };
};

export const normalizeProductList = items => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(normalizeProduct);
};

/** One v1 product, as the storefront components expect to receive it. */
export const adaptProduct = product => {
  if (!product) return product;
  const canonicalId = product._id || product.id;
  const image = firstImage(product);
  return {
    ...product,
    _id: canonicalId,
    id: canonicalId,
    ...(image ? { image } : {}),
    stock: 'availableStock' in product ? product.availableStock : (product.stock ?? 0),
    availability: product.availability ?? {
      status: (product.availableStock ?? product.stock ?? 0) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
      canPurchase: (product.availableStock ?? product.stock ?? 0) > 0,
      availableStock: product.availableStock ?? product.stock ?? 0,
    },
    rating: product.ratingAverage ?? product.rating ?? 0,
    numReviews: product.ratingCount ?? product.numReviews ?? 0,
  };
};

export const adaptProductList = items => (Array.isArray(items) ? items.map(adaptProduct) : []);
