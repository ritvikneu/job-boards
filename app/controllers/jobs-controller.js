import * as ghService from "../services/greenhouse-service.js";
import { runCleanup } from "../services/cleanup-service.js";
import * as leverService from "../services/lever-service.js";
import * as ashService from "../services/ash-service.js";
import * as wday from "../services/wday-rabbit.js";
import * as diceService from "../services/dice-service.js";
import * as oraCloudService from "../services/oraclecloud-service.js";
import { FileHandler } from '../services/file_creation-service.js';
import { FilterJobs } from '../services/filtering-service.js';
import { resolveFilterConfig } from '../services/profile-service.js';
import { createCustomLogger } from '../middleware/logger.js';

import { config } from 'dotenv';
config();

const logger = createCustomLogger('controller');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a per-request FilterJobs instance.
 * Resolution order: inline body.filters → named body.profile → .env defaults.
 * Throws if body.profile names a file that doesn't exist on disk.
 */
const buildFilterJob = (body) => new FilterJobs(resolveFilterConfig(body));

// ─── Route Handlers ───────────────────────────────────────────────────────────

export const getGreenhouse = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const res = await ghService.runGreenhouseScraper(filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getGreenhouse failed: ${err.message}`);
        next(err);
    }
};

export const getCleanup = async (request, response, next) => {
    try {
        const portals = request.body?.portals;
        const result  = await runCleanup({ portals });
        response.json(result);
    } catch (err) {
        logger.error(`getCleanup failed: ${err.message}`);
        next(err);
    }
};

export const getLever = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const res = await leverService.runLeverScraper(filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getLever failed: ${err.message}`);
        next(err);
    }
};

export const getAsh2 = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const res = await ashService.runAshScraper(filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getAsh2 failed: ${err.message}`);
        next(err);
    }
};

export const getWorkday = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const file_name = request.body.file_name || 'wday1';
        const res = await wday.runWorkdayScraper(file_name, filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getWorkday failed: ${err.message}`);
        next(err);
    }
};

export const getDice = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const page_number = request.body.page_number || 1;
        const res = await diceService.runDiceScraper(page_number, filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getDice failed: ${err.message}`);
        next(err);
    }
};

export const getOraCloud = async (request, response, next) => {
    try {
        const filterJob = buildFilterJob(request.body);
        const res = await oraCloudService.runOracleCloudScraper(filterJob);
        response.json({ message: res });
    } catch (err) {
        logger.error(`getOraCloud failed: ${err.message}`);
        next(err);
    }
};

export const getLatestJobs = async (request, response, next) => {
    try {
        const fileHandler = new FileHandler();
        await fileHandler.getLatestJobs();
        response.json({ message: 'Check your mail for the latest jobs' });
    } catch (err) {
        logger.error(`getLatestJobs failed: ${err.message}`);
        next(err);
    }
};

export const HealthCheck = (request, response) => {
    response.status(200).json({ message: process.env.HEALTH_CHECK });
};
