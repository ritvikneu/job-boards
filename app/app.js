import 'express-async-errors';
import express from "express";
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import crypto from 'crypto';
import route from "./routes/index.js";
import { httpMetrics } from './middleware/metrics.js';
import { createCustomLogger } from './middleware/logger.js';

const logger = createCustomLogger('app');

const app = express();

// Trust the first proxy hop (ALB/CloudFront). Required for express-rate-limit
// to read X-Forwarded-For instead of bucketing every request as the proxy IP.
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Fail closed in production: a missing CORS_ORIGIN on prod is almost always a
// misconfigured deploy, not "use the localhost default".
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set when NODE_ENV=production');
}
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));

// ─── Request body parsing (with size limit) ───────────────────────────────────
app.use(express.json({ limit: '100kb' }));

// ─── Response compression ─────────────────────────────────────────────────────
app.use(compression());

// ─── Request correlation ID ───────────────────────────────────────────────────
app.use((req, _res, next) => {
    req.id = crypto.randomUUID();
    next();
});

// ─── Metrics ──────────────────────────────────────────────────────────────────
app.use(httpMetrics);

// ─── Static frontend ──────────────────────────────────────────────────────────
app.use(express.static('front-end'));

// ─── Routes ───────────────────────────────────────────────────────────────────
route(app);

// ─── Centralised Error Handler ────────────────────────────────────────────────
// Must be registered AFTER routes. Express identifies this as an error handler
// by the 4-argument signature — do NOT remove the unused `_next` parameter.
app.use((err, req, res, _next) => {
    logger.error(`${req.method} ${req.path} — ${err.message ?? String(err)}`, { reqId: req.id });
    res.status(err.status ?? 500).json({
        error: {
            message: err.message ?? 'Internal server error',
            timestamp: new Date().toISOString(),
        },
    });
});

export { app }
