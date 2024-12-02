// Import required modules and configure environment
import { readFileSync } from 'fs';
import axios from 'axios';
import { config } from 'dotenv';
import Bottleneck from 'bottleneck';
import NodeCache from 'node-cache';
import CircuitBreaker from 'opossum';
import prometheus from 'prom-client';
import apm from 'elastic-apm-node';

// Initialize environment configuration
config();

// Import custom services
import { FileHandler } from './services/file-service.js';
import { FilterJobs, LocationChecker } from './services/filtering-service.js';
import { 
    producer, 
    getNextMessages, 
    closeConnection, 
    setupDeadLetterQueue 
} from './services/queue-service.js';
import { createCustomLogger } from './services/logger-service.js';
import { MetricsService } from './services/metrics-service.js';

// Initialize services
const fileHandler = new FileHandler();
const filterJob = new FilterJobs();
const locationChecker = new LocationChecker();
// const metricsService = new MetricsService();

// Configuration constants
const CONFIG = {
    fileName: process.env.FILE_WDAY,
    workdayOffset: parseInt(process.env.WORKDAY_OFFSET) || 200,
    concurrencyLimit: parseInt(process.env.CONCURRENCY_LIMIT) || 5,
    batchSize: parseInt(process.env.BATCH_SIZE) || 150,
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS) || 3,
    cacheTTL: parseInt(process.env.CACHE_TTL) || 3600,
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000
};

// Initialize logging
const logger = createCustomLogger(CONFIG.fileName);

// Initialize caching
const cache = new NodeCache({ 
    stdTTL: CONFIG.cacheTTL,
    checkperiod: 120,
    useClones: false
});

// Initialize rate limiter with more sophisticated configuration
const limiter = new Bottleneck({
    maxConcurrent: CONFIG.concurrencyLimit,
    minTime: 1000,
    reservoir: 100, // Maximum number of jobs per minute
    reservoirRefreshAmount: 100,
    reservoirRefreshInterval: 60 * 1000 // 1 minute
});

// Initialize circuit breaker for API calls
const breaker = new CircuitBreaker(axios, {
    timeout: 3000, // Time in milliseconds to wait for API response
    errorThresholdPercentage: 50,
    resetTimeout: 30000
});

// Initialize HTTP client with connection pooling
const httpClient = axios.create({
    timeout: 5000,
    maxContentLength: Infinity,
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 })
});

/**
 * Fetches and processes company data from JSON file
 * @returns {Promise<Array>} Array of company objects
 */
export const getAllCompaniesJson = async () => {
    const metricsTimer = metricsService.startTimer('company_data_processing');
    try {
        const company_set = new Set();
        const jsonFile = `app/companies/workday/${CONFIG.fileName}.json`;
        
        // Try to get from cache first
        const cachedCompanies = cache.get('companies');
        if (cachedCompanies) {
            return cachedCompanies;
        }

        const content = readFileSync(jsonFile, 'utf8');
        const companies = JSON.parse(content);

        const processedCompanies = companies.reduce((acc, company) => {
            try {
                if (company.name && !company_set.has(company.name)) {
                    company_set.add(company.name);
                    acc.push({ 
                        name: company.name, 
                        link: company.link,
                        status: 'active'
                    });
                }
            } catch (error) {
                logger.error(`Error processing company: ${error.message}`, { 
                    company, 
                    error: error.stack 
                });
                metricsService.incrementCounter('company_processing_errors');
            }
            return acc;
        }, []);

        // Cache the results
        cache.set('companies', processedCompanies);
        
        metricsService.observeHistogram('company_count', processedCompanies.length);
        return processedCompanies;
    } catch (error) {
        logger.error(`Failed to process companies: ${error.message}`, { 
            error: error.stack 
        });
        metricsService.incrementCounter('company_processing_failures');
        throw error;
    } finally {
        metricsTimer.end();
    }
};

/**
 * Enhanced job fetching with circuit breaker and retry mechanism
 * @param {string} url API endpoint
 * @param {number} offset Pagination offset
 * @param {string} companyName Company identifier
 * @returns {Promise<Array>} Array of job postings
 */
export const workdayFetch = async (url, offset, companyName) => {
    const fetchTimer = metricsService.startTimer('job_fetch');
    try {
        // Check cache first
        const cacheKey = `${url}_${offset}`;
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        const response = await breaker.fire(async () => {
            return limiter.schedule(() => httpClient.post(url, {
                limit: 20,
                offset: offset,
                searchText: ''
            }));
        });

        const jobs = response.data.jobPostings || [];
        jobs.forEach(job => {
            job.companyName = companyName;
            job.baseURL = url;
            job.fetchTimestamp = new Date().toISOString();
        });

        // Cache the results
        cache.set(cacheKey, jobs);
        
        metricsService.observeHistogram('jobs_per_request', jobs.length);
        return jobs;
    } catch (error) {
        handleFetchError(error, url, companyName);
        return [];
    } finally {
        fetchTimer.end();
    }
};

/**
 * Enhanced consumer worker with improved error handling and monitoring
 * @param {number} workerId Worker identifier
 * @param {string} queueName Queue identifier
 * @returns {Promise<void>}
 */
const consumerWorker = async (workerId, queueName) => {
    const workerMetrics = {
        processedJobs: 0,
        errors: 0,
        startTime: Date.now()
    };

    logger.info(`Consumer ${workerId} started`);
    
    while (true) {
        const batchTimer = metricsService.startTimer('batch_processing');
        try {
            const messages = await getNextMessages(CONFIG.batchSize, queueName);
            
            if (messages.length === 0) {
                if (await shouldTerminateWorker(workerId, workerMetrics)) {
                    break;
                }
                await delay(2000);
                continue;
            }

            const results = await processBatch(messages, workerId);
            updateWorkerMetrics(workerMetrics, results);
            
            // Health check and metrics reporting
            if (workerMetrics.processedJobs % 1000 === 0) {
                reportWorkerHealth(workerId, workerMetrics);
            }

        } catch (error) {
            handleWorkerError(error, workerId);
            await delay(7000);
        } finally {
            batchTimer.end();
        }
    }

    logger.info(`Consumer ${workerId} finished`, { metrics: workerMetrics });
};

/**
 * Process a batch of messages with enhanced error handling
 * @param {Array} messages Array of queue messages
 * @param {number} workerId Worker identifier
 * @returns {Promise<Array>} Processed jobs
 */
async function processBatch(messages, workerId) {
    const processedJobs = [];
    const errors = [];

    await Promise.all(messages.map(async message => {
        const jobTimer = metricsService.startTimer('job_processing');
        try {
            const { url, companyName } = message.content;
            const jobData = await fetchJobWithRetry(url);
            
            if (jobData) {
                const processedJob = await processJobData(jobData, companyName);
                if (processedJob) {
                    processedJobs.push(processedJob);
                }
            }
            
            message.ack();
            metricsService.incrementCounter('processed_jobs');
        } catch (error) {
            errors.push(error);
            message.nack(false);
            metricsService.incrementCounter('job_processing_errors');
        } finally {
            jobTimer.end();
        }
    }));

    return { processedJobs, errors };
}

/**
 * Health check implementation
 * @param {number} workerId Worker identifier
 * @param {Object} metrics Worker metrics
 */
function reportWorkerHealth(workerId, metrics) {
    const healthStatus = {
        workerId,
        uptime: Date.now() - metrics.startTime,
        processedJobs: metrics.processedJobs,
        errorRate: metrics.errors / metrics.processedJobs,
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    };

    logger.info('Worker health status', healthStatus);
    metricsService.gaugeMetric('worker_health', healthStatus);
}

/**
 * Error handling for fetch operations
 * @param {Error} error Error object
 * @param {string} url Request URL
 * @param {string} companyName Company identifier
 */
function handleFetchError(error, url, companyName) {
    const errorContext = {
        url,
        companyName,
        timestamp: new Date().toISOString(),
        errorType: error.name,
        statusCode: error.response?.status
    };

    logger.error(`Fetch error: ${error.message}`, errorContext);
    metricsService.incrementCounter('fetch_errors');

    // Handle specific error types
    if (error.response?.status === 429) {
        metricsService.incrementCounter('rate_limit_hits');
    } else if (error.code === 'ECONNABORTED') {
        metricsService.incrementCounter('timeout_errors');
    }
}

/**
 * Initialize metrics collection
 */
function initializeMetrics() {
    // Register default metrics
    prometheus.collectDefaultMetrics();

    // Custom metrics
    new prometheus.Gauge({
        name: 'job_processor_active_workers',
        help: 'Number of active worker processes'
    });

    new prometheus.Counter({
        name: 'job_processor_processed_jobs_total',
        help: 'Total number of processed jobs'
    });

    new prometheus.Histogram({
        name: 'job_processor_processing_duration_seconds',
        help: 'Time spent processing jobs',
        buckets: [0.1, 0.5, 1, 2, 5]
    });
}

// Initialize the application
initializeMetrics();
setupDeadLetterQueue();

export const startJobProcessing = async (fileName) => {
    const startTime = Date.now();
    try {
        CONFIG.fileName = fileName;
        logger.info('Starting job processing', { fileName });

        const companies = await getAllCompaniesJson();
        const jobs = await processCompanies(companies);
        const filteredJobs = await filterJobs(jobs);

        logger.info('Job processing completed', {
            duration: Date.now() - startTime,
            totalJobs: filteredJobs.length
        });

        return filteredJobs;
    } catch (error) {
        logger.error('Job processing failed', { error: error.stack });
        throw error;
    }
};