require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const seedDB = require('./seed/productSeeds');
const syncPinecone = require('./sync/syncPinecone');
const productRoutes = require('./routes/products');
const checkoutRoutes = require('./routes/checkout');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const v1Routes = require('./routes/v1');
const { swaggerUi, swaggerSpec, setupSwaggerUi, setupSwaggerJson } = require('./docs/swagger');
const { validateEnvironment } = require('./config/env');
const { requestContext } = require('./middleware/requestContext');
const { notFound, errorHandler } = require('./middleware/errors');
const { requireAuth, requireSuperAdmin } = require('./middleware/auth');

// Create Express App
const app = express();
const config = validateEnvironment();
const PORT = config.port;

// Database Connection + Seed + Vector Sync + Server Start
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log('MongoDB Connected');

    // 1. Seed the database (only when necessary)
    const skipSeed = process.env.SKIP_SEED_ON_START === 'true';
    if (!skipSeed) {
      try {
        const forceSeed = process.env.FORCE_SEED_ON_START === 'true';
        const result = await seedDB({ force: forceSeed, skipIfExists: !forceSeed });
        if (result?.seeded) {
          console.log('🪴 Database seeded');
        } else if (result?.skipped) {
          console.log('🌱 Seed skipped (existing products retained)');
        }
      } catch (err) {
        console.error('❌ Seeding error:', err);
      }
    } else {
      console.log('🌱 SKIP_SEED_ON_START enabled. Existing products preserved.');
    }

    // 2. Sync with Pinecone (primary recommendation engine)
    try {
      await syncPinecone();
      console.log('✅ Pinecone synced');
    } catch (err) {
      console.error('❌ Pinecone sync error (continuing with fallbacks):', err);
    }

    // 3. Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server ready on port ${PORT}.`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Middleware
const allowedOrigins = new Set([config.frontendUrl, ...config.allowedOrigins, 'http://localhost:3000', 'http://localhost:5173'].filter(Boolean));
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

app.get('/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded' });
});

// Redirect root to /api-docs
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// Setup Swagger UI with customized title
setupSwaggerJson(app); // serves /api-docs/swagger.json
setupSwaggerUi(app);

// Routes
app.use('/api/v1', v1Routes);
app.use('/api/products', productRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/search', require('./routes/search'));
app.use('/api/auth', authRoutes);
app.get('/api/admin/verification', requireAuth, requireSuperAdmin, (req, res) => res.json({ success: true, data: { role: req.user.role } }));
app.use(notFound);
app.use(errorHandler);

module.exports = app;
