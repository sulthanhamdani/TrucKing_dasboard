import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { initializeDatabase } from './server/db.ts';
import { authRouter } from './server/routes/authRoutes.ts';
import { adminRouter } from './server/routes/adminRoutes.ts';
import { monitoringRouter } from './server/routes/monitoringRoutes.ts';
import { transporterRouter } from './server/routes/transporterRoutes.ts';
import { orderRouter } from './server/routes/orderRoutes.ts';

initializeDatabase();

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Prevent caching of sensitive API responses
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timezone: 'Asia/Jakarta' });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/transporters', transporterRouter);
app.use('/api/orders', orderRouter);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output tidak ditemukan.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MODA Server running on http://0.0.0.0:${PORT}`);
  });
}

// Start HTTP server unless imported for testing
if (process.env.VITEST !== 'true' && process.env.MODA_NO_LISTEN !== 'true' && !process.env.VERCEL) {
  startServer();
}
