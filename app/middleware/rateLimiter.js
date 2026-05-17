import rateLimit from 'express-rate-limit';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '300000'); // 5 min default
const MAX = parseInt(process.env.RATE_LIMIT_MAX || '5');

/**
 * Scraper rate limiter — applied to all expensive portal endpoints.
 *
 * Default: 5 requests per 5 minutes per IP.
 * Override via RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX env vars.
 */
export const scraperLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Too many requests, please try again later.', timestamp: new Date().toISOString() } },
});

/**
 * General limiter for lighter-weight endpoints (e.g. /latest).
 * 30 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Too many requests, please try again later.', timestamp: new Date().toISOString() } },
});
