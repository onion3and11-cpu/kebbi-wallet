import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import apiRouter from './src/routes/api';
import { handleRoflowRequest } from './src/routes/roflow';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // CORS middleware - Allow cross-origin requests from Kebbi Robot, Roflow, Webviews, and external apps
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Robot-ID', 'X-Roflow-Key', 'X-Requested-With'],
      credentials: true,
    })
  );

  // Body parser middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Safe logger for API requests (never logs request body, PINs, passwords, or secret keys)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      console.log(`[API ${req.method}] ${req.path}`);
    }
    next();
  });

  // API Health Check (Endpoint供測試部署，不執行 Gemini)
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
    });
  });

  // NUWA Robotics Roflow API
  app.post('/api/roflow', handleRoflowRequest);

  // Mount API V1 routes
  app.use('/api/v1', apiRouter);

  // Smart Fallback for Kebbi Roflow if user posted to AI Studio app page URL or nested paths
  app.use((req, res, next) => {
    // 0. Fallback for /api/roflow if nested path
    if (req.method === 'POST' && req.path.includes('/api/roflow')) {
      return handleRoflowRequest(req, res);
    }

    // 1. If path starts with /apps/{app_id}/api/v1/..., rewrite to /api/v1/...
    if (req.path.includes('/api/v1/')) {
      const targetApiIndex = req.url.indexOf('/api/v1/');
      if (targetApiIndex > 0) {
        req.url = req.url.substring(targetApiIndex);
        return apiRouter(req, res, next);
      }
    }

    // 2. If it's a POST request to root or /apps/ without /api/ path, but contains order fields
    if (req.method === 'POST' && (req.body?.total_amount || req.body?.robot_id || req.body?.amount)) {
      console.log('[Roflow Fallback] Caught POST order request sent to non-API URL:', req.path);
      req.url = '/robot/orders';
      return apiRouter(req, res, next);
    }

    // 3. If it's a GET request looking for order status without /api/ path
    if (req.method === 'GET' && (req.query?.order_id || req.query?.orderId || req.url.includes('status') || req.url.includes('orders'))) {
      console.log('[Roflow Fallback] Caught GET status request sent to non-API URL:', req.path);
      req.url = req.query?.order_id ? '/robot/orders/status' : '/robot/orders/latest';
      return apiRouter(req, res, next);
    }

    next();
  });

  // Vite middleware for dev or Static asset serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Kebbi E-Wallet Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
