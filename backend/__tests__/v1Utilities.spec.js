const { parsePagination, paginationMeta } = require('../utils/pagination');
const { slugify } = require('../utils/slug');
const { serializeProduct, serializeUser } = require('../utils/serializers');

describe('v1 API foundations', () => {
  it('bounds pagination and returns stable navigation metadata', () => {
    expect(parsePagination({ page: '-1', limit: '1000' })).toEqual({ page: 1, limit: 100, skip: 0 });
    expect(paginationMeta({ page: 2, limit: 20, total: 41 })).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('normalizes route-safe slugs', () => {
    expect(slugify('  MansooriKart: Áudio & Video!  ')).toBe('mansoorikart-audio-video');
  });

  it('does not expose user secrets in a public serializer', () => {
    const user = serializeUser({ _id: 'user-1', name: 'A', email: 'a@example.com', password: 'secret', passwordResetTokenHash: 'token', role: 'CUSTOMER' });
    expect(user).toMatchObject({ id: 'user-1', email: 'a@example.com', role: 'CUSTOMER' });
    expect(user.password).toBeUndefined();
    expect(user.passwordResetTokenHash).toBeUndefined();
  });

  it('adapts legacy single-image products without leaking cost price', () => {
    const product = serializeProduct({ _id: 'product-1', name: 'Product', image: 'https://example.test/image.jpg', price: 100, stock: 3, costPrice: 10 });
    expect(product.images).toEqual([{ url: 'https://example.test/image.jpg', alt: 'Product', position: 0 }]);
    expect(product.availableStock).toBe(3);
    expect(product.costPrice).toBeUndefined();
  });
});
