import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import connectDB from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';
import productRoutes from './routes/productRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import saleRoutes from './routes/saleRoutes.js';
import companyRoutes from './routes/companyRoutes.js';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

// Fail fast if production secrets are missing or still placeholders
if (isProd) {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];
  for (const key of required) {
    const val = process.env[key];
    if (!val || val.includes('replace_this')) {
      console.error(`Missing or insecure ${key}. Set a long random value in .env before production.`);
      process.exit(1);
    }
  }
}

connectDB();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cloudflare Tunnel / reverse proxy — required for correct HTTPS & rate-limit IPs
app.set('trust proxy', 1);

// Always allow local Vite + API, and the public domain (merge with CORS_ORIGIN if set)
const builtinOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://stockhold.dpdns.org',
  'http://stockhold.dpdns.org',
];
const envOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
// Render injects RENDER_EXTERNAL_URL (e.g. https://stockhold.onrender.com)
const renderOrigin = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '').replace(/\/$/, '');
const allowedOrigins = [
  ...new Set([...builtinOrigins, ...envOrigins, ...(renderOrigin ? [renderOrigin] : [])]),
];

// Gzip JSON/API responses — big win on slow links / weak CPUs
app.use(
  compression({
    threshold: 1024,
    level: 6,
  })
);

// Security headers (API + static). CSP relaxed enough for React + inline chart styles.
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            "font-src": ["'self'", 'https://fonts.gstatic.com', 'data:'],
            "img-src": ["'self'", 'data:', 'blob:'],
            "connect-src": ["'self'"],
            "frame-ancestors": ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / server-to-server / no Origin header
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
  })
);

// Cap body size so a large avatar/base64 cannot blow memory
app.use(express.json({ limit: process.env.JSON_LIMIT || '2mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_LIMIT || '2mb' }));
app.use(cookieParser());

// Verbose request logs only outside production
if (!isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('tiny'));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/products', productRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/company', companyRoutes);

// Serve built frontend from the same process in production (one port, less RAM)
const clientDist = path.join(__dirname, '../client/dist');
if (isProd) {
  app.use(
    express.static(clientDist, {
      maxAge: '7d',
      etag: true,
      index: false,
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });
}

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
  );
});
