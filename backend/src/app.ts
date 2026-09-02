import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { getConfig, type BackendConfig } from './config/env.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requestContext } from './middleware/request-context.js';
import authRoutes from './routes/v1/auth.js';
import catalogRoutes from './routes/v1/catalog.js';
import meRoutes from './routes/v1/me.js';
import cartRoutes from './routes/v1/cart.js';
import wishlistRoutes from './routes/v1/wishlist.js';
import adminInventoryRoutes from './routes/v1/adminInventory.js';
import couponRoutes from './routes/v1/coupons.js';
import adminCouponRoutes from './routes/v1/adminCoupons.js';
import orderRoutes from './routes/v1/orders.js';
import adminOrderRoutes from './routes/v1/adminOrders.js';
import { adminReviewRoutes, productReviewRoutes, reviewRoutes } from './routes/v1/reviews.js';
import adminCoreRoutes from './routes/v1/adminCore.js';
import adminCatalogRoutes from './routes/v1/adminCatalog.js';
import adminInventoryErpRoutes from './routes/v1/adminInventoryErp.js';
import adminReturnsRoutes from './routes/v1/adminReturns.js';
import adminSalesRoutes from './routes/v1/adminSales.js';
import adminAbandonedCartRoutes from './routes/v1/adminAbandonedCarts.js';
import adminCustomerRoutes from './routes/v1/adminCustomers.js';
import adminPurchasingRoutes from './routes/v1/adminPurchasing.js';

/**
 * Clean TypeScript composition root. Route families are ported here incrementally;
 * legacy JavaScript remains mounted only by the transitional `backend/index.js`.
 */
export function createApp(config: BackendConfig = getConfig()): express.Express {
  const app = express();
  const allowedOrigins = new Set([config.frontendUrl, ...config.allowedOrigins, 'http://localhost:3000', 'http://localhost:5173'].filter(Boolean));

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestContext);

  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.get('/api/v1/health', (_request, response) => response.status(200).json({ success: true, data: { status: 'ok' } }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/me', meRoutes);
  app.use('/api/v1/cart', cartRoutes);
  app.use('/api/v1/wishlist', wishlistRoutes);
  app.use('/api/v1/admin', adminInventoryRoutes);
  app.use('/api/v1/admin', adminInventoryErpRoutes);
  app.use('/api/v1/admin', adminCoreRoutes);
  app.use('/api/v1/admin', adminCatalogRoutes);
  app.use('/api/v1/coupons', couponRoutes);
  app.use('/api/v1/admin', adminCouponRoutes);
  app.use('/api/v1/products', productReviewRoutes);

  // Public catalog must be mounted before the broad authenticated `/api/v1` order router.
  app.use('/api/v1', catalogRoutes);
  app.use('/api/v1', orderRoutes);
  app.use('/api/v1/admin', adminOrderRoutes);
  app.use('/api/v1/admin', adminReturnsRoutes);
  app.use('/api/v1/admin', adminSalesRoutes);
  app.use('/api/v1/admin', adminAbandonedCartRoutes);
  app.use('/api/v1/admin', adminCustomerRoutes);
  app.use('/api/v1/admin', adminPurchasingRoutes);
  app.use('/api/v1/reviews', reviewRoutes);
  app.use('/api/v1/admin', adminReviewRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
