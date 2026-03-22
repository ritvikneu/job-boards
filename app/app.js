import express from "express";
import cors from 'cors';
import route from "./routes/index.js";
import { httpMetrics } from './middleware/metrics.js';
import { createCustomLogger } from './middleware/logger.js';

const logger = createCustomLogger('app');

const app = express();
app.use(cors());
app.use(express.json());
app.use(httpMetrics);
route(app);

// ─── Centralised Error Handler ────────────────────────────────────────────────
// Must be registered AFTER routes. Express identifies this as an error handler
// by the 4-argument signature — do NOT remove the unused `_next` parameter.
app.use((err, req, res, _next) => {
    logger.error(`${req.method} ${req.path} — ${err.message ?? String(err)}`);
    res.status(err.status ?? 500).json({
        error: {
            message: err.message ?? 'Internal server error',
            timestamp: new Date().toISOString(),
        },
    });
});

export { app }
