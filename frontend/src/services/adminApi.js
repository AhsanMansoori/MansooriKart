import { apiClient, unwrap, unwrapMeta, withRetry } from './apiClient';

const adminRequest = async (method, path, { params, data } = {}) => {
  const response = await withRetry(() => apiClient.request({ method, url: `admin${path}`, params, data }));
  return { data: unwrap(response), meta: unwrapMeta(response) };
};

export const adminApi = {
  dashboard: () => adminRequest('get', '/dashboard'),
  dashboardSales: range => adminRequest('get', '/dashboard/sales', { params: { range } }),
  dashboardOrders: range => adminRequest('get', '/dashboard/orders', { params: { range } }),
  list: (path, params) => adminRequest('get', path, { params }),
  get: path => adminRequest('get', path),
  create: (path, data) => adminRequest('post', path, { data }),
  update: (path, data) => adminRequest('patch', path, { data }),
  remove: path => adminRequest('delete', path),
  uploadCsv: async ({ supplierId, fileName, file }) => {
    const response = await withRetry(() =>
      apiClient.post('admin/catalog-imports', file, { params: { supplierId, fileName }, headers: { 'Content-Type': 'text/csv' } })
    );
    return { data: unwrap(response), meta: unwrapMeta(response) };
  },
  mapImport: (id, data) => adminRequest('post', `/catalog-imports/${id}/mapping`, { data }),
  previewImport: id => adminRequest('get', `/catalog-imports/${id}/preview`),
  runImport: id => adminRequest('post', `/catalog-imports/${id}/import`, { data: {} }),
};

export const adminResources = {
  products: {
    title: 'Products',
    description: 'Catalog inventory and publication control.',
    path: '/products',
    columns: ['name', 'sku', 'status', 'price', 'stock'],
  },
  categories: { title: 'Categories', description: 'Organize the storefront catalog.', path: '/categories', columns: ['name', 'slug', 'status'] },
  brands: { title: 'Brands', description: 'Maintain the brands represented in the catalog.', path: '/brands', columns: ['name', 'slug', 'status'] },
  attributes: {
    title: 'Attributes',
    description: 'Generic catalog attribute definitions and options.',
    path: '/attributes',
    columns: ['name', 'slug', 'status', 'updatedAt'],
  },
  badges: { title: 'Badges', description: 'Product badges used by the storefront catalog.', path: '/badges', columns: ['name', 'slug', 'status', 'updatedAt'] },
  customers: {
    title: 'Customers',
    description: 'Customer accounts and commerce history.',
    path: '/customers',
    columns: ['name', 'email', 'status', 'createdAt'],
  },
  orders: {
    title: 'Orders',
    description: 'Review order state, payment, and fulfillment.',
    path: '/orders',
    columns: ['orderNumber', 'customer', 'total', 'orderStatus', 'createdAt'],
  },
  returns: { title: 'Returns', description: 'Manage customer return workflows.', path: '/returns', columns: ['orderNumber', 'status', 'reason', 'createdAt'] },
  refunds: {
    title: 'Refunds',
    description: 'Internal refund accounting workflow.',
    path: '/refunds',
    columns: ['orderNumber', 'amount', 'status', 'createdAt'],
  },
  suppliers: { title: 'Suppliers', description: 'Supplier records and purchasing relationships.', path: '/suppliers', columns: ['name', 'code', 'status'] },
  purchaseOrders: {
    title: 'Purchase Orders',
    description: 'Purchase order approval and receiving.',
    path: '/purchase-orders',
    columns: ['number', 'supplier', 'status', 'total', 'createdAt'],
  },
  receipts: {
    title: 'Goods Receipts',
    description: 'Receive stock without exceeding ordered quantities.',
    path: '/goods-receipts',
    columns: ['purchaseOrder', 'status', 'createdAt'],
  },
  pricing: {
    title: 'Pricing Rules',
    description: 'Apply server-authoritative supplier pricing rules.',
    path: '/pricing-rules',
    columns: ['name', 'type', 'priority', 'active'],
  },
  imports: {
    title: 'Import History',
    description: 'Track supplier CSV imports and validation outcomes.',
    path: '/catalog-imports',
    columns: ['source', 'status', 'createdCount', 'updatedCount', 'createdAt'],
  },
  fulfillments: {
    title: 'Dropship Fulfillments',
    description: 'Coordinate supplier fulfillment manually and truthfully.',
    path: '/dropship-fulfillments',
    columns: ['orderNumber', 'supplier', 'status', 'createdAt'],
  },
  stock: {
    title: 'Stock',
    description: 'Authoritative warehouse balances and availability.',
    path: '/inventory/stock',
    columns: ['product', 'warehouse', 'onHand', 'available', 'status'],
  },
  warehouses: { title: 'Warehouses', description: 'Warehouse and location configuration.', path: '/inventory/warehouses', columns: ['code', 'name', 'status'] },
  locations: {
    title: 'Locations',
    description: 'Warehouse locations and stock placement.',
    path: '/inventory/locations',
    columns: ['warehouse', 'code', 'name', 'status'],
  },
  movements: {
    title: 'Inventory Movements',
    description: 'Immutable inventory movement ledger.',
    path: '/inventory/movements',
    columns: ['product', 'type', 'quantity', 'reference', 'createdAt'],
  },
  expenses: {
    title: 'Expenses',
    description: 'Operating expense approval and void workflow.',
    path: '/expenses',
    columns: ['description', 'category', 'amount', 'status', 'date'],
  },
  coupons: { title: 'Coupons', description: 'Commerce discount rules and usage.', path: '/coupons', columns: ['code', 'type', 'value', 'status', 'expiresAt'] },
  promotions: {
    title: 'Promotions',
    description: 'Scheduled merchandising campaigns.',
    path: '/promotions',
    columns: ['title', 'status', 'priority', 'startsAt'],
  },
  banners: {
    title: 'Banners',
    description: 'Manage scheduled storefront placements.',
    path: '/banners',
    columns: ['title', 'placement', 'status', 'priority'],
  },
  pages: {
    title: 'CMS Pages',
    description: 'Safe, structured content for storefront pages.',
    path: '/pages',
    columns: ['title', 'slug', 'status', 'updatedAt'],
  },
  faqs: {
    title: 'FAQ',
    description: 'Maintain customer-facing answers and ordering.',
    path: '/faqs',
    columns: ['question', 'status', 'position', 'updatedAt'],
  },
  supplierCatalog: {
    title: 'Supplier Catalog',
    description: 'Supplier source records and their storefront links.',
    path: '/supplier-sources',
    columns: ['supplier', 'supplierSku', 'product', 'stock', 'status'],
  },
  abandonedCarts: {
    title: 'Abandoned Carts',
    description: 'Persisted customer carts that may need operational review.',
    path: '/abandoned-carts',
    columns: ['customer', 'items', 'total', 'updatedAt'],
  },
  reportsSales: {
    title: 'Sales Report',
    description: 'Server-calculated sales performance for the selected period.',
    path: '/reports/sales',
    columns: ['date', 'orders', 'revenue'],
  },
  reportsProducts: {
    title: 'Product Report',
    description: 'Server-calculated product performance.',
    path: '/reports/products',
    columns: ['name', 'orders', 'revenue'],
  },
  reportsInventory: {
    title: 'Inventory Report',
    description: 'Authoritative inventory balances and stock health.',
    path: '/reports/inventory',
    columns: ['product', 'warehouse', 'available', 'status'],
  },
  reportsCustomers: {
    title: 'Customer Report',
    description: 'Customer activity and order aggregates.',
    path: '/reports/customers',
    columns: ['name', 'orders', 'revenue'],
  },
  reportsOrders: {
    title: 'Order Report',
    description: 'Order totals and status aggregates.',
    path: '/reports/orders',
    columns: ['status', 'orders', 'revenue'],
  },
  reportsPurchases: {
    title: 'Purchasing Report',
    description: 'Purchase order and receipt aggregates.',
    path: '/reports/purchases',
    columns: ['status', 'orders', 'total'],
  },
  reportsTax: {
    title: 'Tax Report',
    description: 'Server-calculated tax totals for the selected period.',
    path: '/reports/tax',
    columns: ['taxableSales', 'tax', 'orders'],
  },
  reportsProfit: {
    title: 'Profit Report',
    description: 'Revenue, COGS, and profit calculations from the finance authority.',
    path: '/reports/profit',
    columns: ['period', 'revenue', 'grossProfit'],
  },
};
