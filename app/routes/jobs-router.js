import express from "express";
import * as jobsController from "./../controllers/jobs-controller.js";
import { scraperLimiter, generalLimiter } from '../middleware/rateLimiter.js';
import { validateGreenhouse, validateWorkday, validateDice, validateFilters } from '../middleware/validate.js';

const router = express.Router();

// ─── Scraper routes — rate-limited + validated ────────────────────────────────

router.route('/greenhouse')
        .get(scraperLimiter, validateGreenhouse, jobsController.getGreenhouse);

router.route('/lever')
        .get(scraperLimiter, validateFilters, jobsController.getLever);

router.route('/workday')
        .get(scraperLimiter, validateWorkday, jobsController.getWorkday);

router.route('/dice')
        .get(scraperLimiter, validateDice, jobsController.getDice);

router.route('/oracloud')
        .get(scraperLimiter, validateFilters, jobsController.getOraCloud);

router.route('/ash')
        .get(scraperLimiter, validateFilters, jobsController.getAsh2);

// ─── Utility routes ───────────────────────────────────────────────────────────

router.route('/latest')
        .get(generalLimiter, jobsController.getLatestJobs);

// /health is exempt from auth (handled in auth middleware) and rate limiting
router.route('/health')
        .get(jobsController.HealthCheck);

router.route('/jobs')
        .get(generalLimiter, jobsController.getJobsView);

router.route('/jobs/status')
        .patch(jobsController.patchJobStatus);

export default router;
