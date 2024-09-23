import { readFileSync } from 'fs';
import axios from 'axios';
import { config } from 'dotenv';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs, LocationChecker } from './filtering-service.js';
import { logger } from '../middleware/logger.js';
const filterJob = new FilterJobs();
const locationChecker = new LocationChecker();
import { producer, getNextMessages, closeConnection, consusmerBatch } from './rabbitMQ-service.js';

let fileName = process.env.FILE_WDAY;
const WORKDAY_OFFSET = parseInt(process.env.WORKDAY_OFFSET) || 200;
const CONCURRENCY_LIMIT = process.env.CONCURRENCY_LIMIT; // Number of concurrent requests
let ERROR_COUNT = 0
const CONSUMER_COUNT = 5; // Number of concurrent consumers
const BATCH_SIZE = 200; // Number of messages to process in each batch
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

import Bottleneck from 'bottleneck';

let rate_limit_count = 0;


export const getAllCompaniesJson = async () => {
    console.log("inside get all workday companies");
    const company_set = new Set();
    const jsonFile = `app/companies/workday/${fileName}.json`;
    const content = readFileSync(jsonFile, 'utf8');
    const companies = JSON.parse(content); // Parse the JSON content

    return companies.reduce((acc, company) => {
        try {
            if (company.name && !company_set.has(company.name)) {
                company_set.add(company.name);
                acc.push({ name: company.name, link: company.link });
            }
        } catch (error) {
            console.log("Error in parsing company names:", company);
            logger.error("Error in parsing company names:", company);
        }
        return acc;
    }, []);

}

export const workdayJobsNoFilter = async () => {
    console.log("inside workday call");
    const company_list = await getAllCompaniesJson();
    return getWorkdayJobs(company_list);
}

export const filterWorkDayJobs = async (file_name) => {
    fileName = file_name;
    console.log("FileName------------", fileName)
    const startTime = Date.now();
    console.log("inside filter workday jobs");
    const workday_list = await workdayJobsNoFilter();

    const jobPosting = workday_list.map(async job => {
        const country_check = job.location_country.toLowerCase();
        const location_matched = await locationChecker.isCountryPresentWorkday(country_check);

        if (location_matched) {
            const posting_date = job.posting_date;
            if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                const title_to_check = job.job_title.toLowerCase();
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false, 'workday');
                if (title_matched) {
                    return job;
                }
            }
        }
        return null;
    });

    let filteredJobs = await Promise.all(jobPosting);

    filteredJobs = filteredJobs.filter(job => job !== null).sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));
    console.log("Filtered workday jobs: " + filteredJobs.length);
    console.log("ERRORCOUNT", ERROR_COUNT);
    fileHandler.writeToExcel(filteredJobs, fileName);

    console.log("Duration of workday jobs: " + (Date.now() - startTime) / 1000 + " seconds");
    logger.info("Duration of workday jobs: " + (Date.now() - startTime) / 1000 + " seconds");

    return filteredJobs;
}


const limiter = new Bottleneck({
    maxConcurrent: 5, // Allow 5 concurrent requests
    minTime: 1000 // Minimum time between requests (in ms)
});


export const workdayFetch = async (url, offset, companyName, retries = 3) => {
    try {
        const response = await axios.post(url, {
            appliedFacets: {},
            // appliedFacets:{"timeType":["1aea6da227e21005504339b6b1770001"],"jobFamilyGroup":["e65dbadf6a50100168ed86fe4cf50001"],"workerSubType":["183bb31d97231001005066125c530001"]},
            limit: 20,
            offset: offset,
            searchText: ''
        });
        const data = response.data;
        if (data.jobPostings) {
            data.jobPostings.forEach(job => {
                job.companyName = companyName;
                job.baseURL = url;
            });
        }
        return data.jobPostings || [];
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            console.log(`Rate limited in workdayFetch for ${companyName}. Retries left: ${retries}`);
            await delay(10000); // Wait for 10 seconds
            return workdayFetch(url, offset, companyName, retries - 1); // Retry
        }
        console.log('Error in fetching jobs:', companyName, error.message);
        logger.error('Error in fetching jobs:', error.message);
        return [];
    }
}


export const workdayJobFetch = async (url, retries = 3) => {
    // count the time in seconds spent in rate limit
    const startTime = Date.now();
    try {
        const response = await axios.get(url);
        const endTime = Date.now();
        const timeSpent = (endTime - startTime) / 1000;
        rate_limit_count += timeSpent;
        return response.data.jobPostingInfo || null;
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            // delay for an exponential time every time we hit rate limit
            let delay_time = Math.pow(2, 3 - retries) * 20000;
            // console.log(`Rate limited in workdayJobFetch. Waited for ${delay_time} seconds before retry. Retries left: ${retries}`);
            await delay(delay_time); // Wait for 10 seconds
            return workdayJobFetch(url, retries - 1); // Retry with one less retry attempt
        }
        ERROR_COUNT++;
        console.log('Error fetching single job:', url, error.message);
        logger.error('Error fetching single job:', url, error.message);
        return null;
    }
}

function scheduleRequest(endpoint) {
    return limiter.schedule(() => {
        return workdayJobFetch(endpoint);
    })
}

export const getWorkdayJobs = async (company_list) => {
    // Arrays and sets to store job data
    const jobPostings = [];
    const job_links_seen = new Set();
    const processedJobs = [];

    // Producer function to fetch job listings and queue them for processing
    const producerPromise = async () => {
        console.log("Starting producer process...");

        // Helper function to fetch jobs for a single company
        const fetchJobsForCompany = async (company) => {
            let offset = 0;
            const companyJobs = [];
            // Fetch jobs in batches until we hit the offset limit or run out of jobs
            while (offset < WORKDAY_OFFSET) {
                const jobs = await workdayFetch(company.link, offset, company.name);
                companyJobs.push(...jobs);
                if (jobs.length < 20) break; // Less than a full page, no more jobs
                offset += 20;
            }
            return companyJobs;
        }

        // Fetch jobs for all companies concurrently
        const allJobs = await Promise.all(company_list.map(fetchJobsForCompany));
        jobPostings.push(...allJobs.flat());

        // Prepare job URLs for queueing
        const jobUrls = jobPostings.map(job => ({
            url: job.baseURL.slice(0, -5) + job.externalPath,
            companyName: job.companyName
        }));

        // Queue all job URLs for processing
        await producer(jobUrls);
        console.log(`Producer finished. Sent ${jobUrls.length} jobs to the queue.`);

        return jobUrls.length;
    };

    // Consumer worker function to process queued jobs
    const consumerWorker = async (workerId) => {
        console.log(`Consumer ${workerId} started`);
        let emptyQueueCount = 0;
        // Continue processing until we've seen an empty queue 3 times in a row
        while (emptyQueueCount < 3) {
            try {
                // Fetch a batch of messages from the queue
                const messages = await getNextMessages(BATCH_SIZE);
                if (messages.length === 0) {
                    emptyQueueCount++;
                    console.log(`Consumer ${workerId} found empty queue. Attempt ${emptyQueueCount}`);
                    await delay(5000); // Wait before checking again
                    continue;
                }
                emptyQueueCount = 0; // Reset counter if we found messages
                // Process all messages in the batch concurrently
                const jobDataPromises = messages.map(async message => {
                    const { url, companyName } = message.content;
                    return { jobData: await workdayJobFetch(url), message, companyName };
                });

                const results = await Promise.all(jobDataPromises);

                // Process the results of the batch
                results.forEach(({ jobData, message, companyName }) => {
                    if (jobData) {
                        const data = {
                            company_name: companyName,
                            job_title: jobData.title,
                            job_link: jobData.externalUrl,
                            location: jobData.location,
                            location_country: jobData.jobRequisitionLocation?.country.descriptor || jobData.country.descriptor,
                            posting_date: jobData.startDate,
                            position_id: jobData.jobReqId
                        };
                        // Only add job if we haven't seen it before
                        if (!job_links_seen.has(data.job_link)) {
                            job_links_seen.add(data.job_link);
                            processedJobs.push(data);
                        }
                    }
                    message.ack(); // Acknowledge the message as processed
                });

                console.log(`Consumer ${workerId} processed ${messages.length} messages`);
            } catch (error) {
                console.error(`Error in consumer ${workerId}:`, error);
                await delay(5000); // Wait before retrying after an error
            }
        }
        console.log(`Consumer ${workerId} finished due to empty queue`);
    };

    // Function to start all consumer workers
    const consumerPromise = async () => {
        console.log("Starting consumer process...");
        // Create and start multiple consumer workers
        const consumers = Array.from({ length: CONSUMER_COUNT }, (_, i) => consumerWorker(i + 1));
        await Promise.all(consumers);
        console.log(`All consumers finished. Processed ${processedJobs.length} jobs.`);
        return processedJobs;
    };

    try {
        // Start the producer and wait for it to finish
        const producedCount = await producerPromise();
        console.log(`Producer completed. ${producedCount} jobs queued.`);

        // Start the consumers and wait for them to finish
        const consumedJobs = await consumerPromise();
        console.log(`Consumers completed. ${consumedJobs.length} jobs processed.`);

        // Close the connection to the message queue
        await closeConnection();

        return consumedJobs;
    } catch (error) {
        console.error('Error in job processing:', error);
        logger.error('Error in job processing:', error);
        throw error;
    }
}

// export const getWorkdayJobs = async (company_list) => {
//     const jobPostings = [];
//     const job_links_seen = new Set();
//     const processedJobs = [];

//     const producerPromise = async () => {
//         console.log("Starting producer process...");
//         const fetchJobsForCompany = async (company) => {
//             let offset = 0;
//             while (offset < WORKDAY_OFFSET) {
//                 const jobs = await workdayFetch(company.link, offset, company.name);
//                 jobPostings.push(...jobs);
//                 if (jobs.length < 20) break;
//                 offset += 20;
//             }
//         }

//         for (let i = 0; i < company_list.length; i += CONCURRENCY_LIMIT) {
//             const batch = company_list.slice(i, i + CONCURRENCY_LIMIT);
//             await Promise.all(batch.map(fetchJobsForCompany));
//         }

//         const jobUrls = jobPostings.map(job => ({
//             url: job.baseURL.slice(0, -5) + job.externalPath,
//             companyName: job.companyName
//         }));
//         await producer(jobUrls);
//         console.log(`Producer finished. Sent ${jobUrls.length} jobs to the queue.`);
//         return jobUrls.length;
//     };

//     const consumerWorker = async (workerId) => {
//         console.log(`Consumer ${workerId} started`);
//         let emptyQueueCount = 0;
//         while (emptyQueueCount < 3) { // Stop after 3 consecutive empty queue results
//             try {
//                 const messages = await getNextMessages(BATCH_SIZE);
//                 if (messages.length === 0) {
//                     emptyQueueCount++;
//                     console.log(`Consumer ${workerId} found empty queue. Attempt ${emptyQueueCount}`);
//                     await delay(5000); // Wait for 5 seconds before retrying
//                     continue;
//                 }
//                 emptyQueueCount = 0; // Reset the counter if we got messages

//                 for (const message of messages) {
//                     try {
//                         const { url, companyName } = message.content;
//                         const jobData = await workdayJobFetch(url);
//                         if (jobData) {
//                             const data = {
//                                 company_name: companyName,
//                                 job_title: jobData.title,
//                                 job_link: jobData.externalUrl,
//                                 location: jobData.location,
//                                 location_country: jobData.jobRequisitionLocation?.country.descriptor || jobData.country.descriptor,
//                                 posting_date: jobData.startDate,
//                                 position_id: jobData.jobReqId
//                             };
//                             if (!job_links_seen.has(data.job_link)) {
//                                 job_links_seen.add(data.job_link);
//                                 processedJobs.push(data);
//                             }
//                         }
//                         await message.ack();
//                     } catch (error) {
//                         console.error(`Error processing message in consumer ${workerId}:`, error);
//                         // Optionally, you could implement a retry mechanism here
//                     }
//                 }

//                 console.log(`Consumer ${workerId} processed ${messages.length} messages`);
//             } catch (error) {
//                 console.error(`Error in consumer ${workerId}:`, error);
//                 await delay(5000); // Wait before retrying
//             }
//         }
//         console.log(`Consumer ${workerId} finished due to empty queue`);
//     };


//     const consumerPromise = async () => {
//         console.log("Starting consumer process...");
//         const consumers = Array.from({ length: CONSUMER_COUNT }, (_, i) => consumerWorker(i + 1));
//         await Promise.all(consumers);
//         console.log(`All consumers finished. Processed ${processedJobs.length} jobs.`);
//         return processedJobs;
//     };

//     try {
//         const producedCount = await producerPromise();
//         console.log(`Producer completed. ${producedCount} jobs queued.`);

//         const consumedJobs = await consumerPromise();
//         console.log(`Consumers completed. ${consumedJobs.length} jobs processed.`);

//         await closeConnection();

//         return consumedJobs;
//     } catch (error) {
//         console.error('Error in job processing:', error);
//         logger.error('Error in job processing:', error);
//         throw error;
//     }
// }


