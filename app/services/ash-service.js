import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import { config } from 'dotenv';
import pLimit from 'p-limit';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs } from './filtering-service.js';
const filterJob = new FilterJobs();

let fileName = process.env.FILE_ASH
const CONCURRENCY_LIMIT = 100; // Number of concurrent requests


import { createCustomLogger } from '../middleware/logger.js';
let logger = createCustomLogger(fileName);

let EMBED = false;

export const getFilteredAshJobs = async () => {
    logger = createCustomLogger(fileName);

    const startTimer = new Date();

    console.log("Start filtering Ash jobs:", startTimer);
    logger.info(`Start filtering Ash jobs: ${startTimer}`);
    const filtered_ash_list = await filterAshJobs();

    console.log("Filtering started for Ash Jobs:", new Date());
    console.log("Number of jobs after filtering:", filtered_ash_list.length);
    fileHandler.writeToExcel(filtered_ash_list, fileName);
    // total number of jobs filtered
    console.log(filtered_ash_list.length);
    logger.info(`Number of jobs after filtering: ${filtered_ash_list.length}`);
    console.log("Time taken to filter Ash Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");
    logger.info(`Time taken to filter Ash Jobs: : ${(Date.now() - startTimer) / 1000} seconds`);
    return filtered_ash_list;
}

export const getAllCompanies = async () => {
    const basURL = "https://jobs.ashbyhq.com/";
    fileName = process.env.FILE_ASH;
    const csvFile = `app/companies/ashbyhq/${fileName}.csv`;
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n').map(row => row.toLowerCase().trim()).filter(row => row.length > 0);
    const company_set = new Set(rows);
    const company_list = Array.from(company_set).map(companyName => ({
        name: companyName,
        link: basURL + companyName
    }));

    // fileHandler.writeToCsvCompanyNames(company_set.sort(), "gh-embed-ez-all");
    // process.exit();
    console.log(company_list.length);
    logger.info(`Number of companies for Ash: ${company_list.length}`);
    return company_list;
}

export const getAshJobs = async () => {
    console.log("inside get Ash jobs");

    const company_list = await getAllCompanies();
    const ash_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);

    async function fetchJobData(company) {
        let requestCount = 0;
        const MAX_REQUESTS = 100; // Adjust this value based on your rate limit

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        let company_jobs_url = company.link;

        try {
                // Rate limiting logic
                if (requestCount >= MAX_REQUESTS) {
                    console.log("Rate limit reached, waiting for 10 seconds...");
                    await delay(10000);
                    requestCount = 0; // Reset the counter after waiting
                }

                let response = await axios.get(company_jobs_url);
                requestCount++; // Increment the request counter

                if (response.status === 200) {
                    const htmlDom = new jsdom.JSDOM(response.data);
                    const document = htmlDom.window.document;

                    const scriptTag = Array.from(document.querySelectorAll('script')).find(
                        script => script.textContent.includes('window.__appData')
                    );
                    // get all the jobs from the scriptTag
                    if (scriptTag) {
                        const scriptContent = scriptTag.textContent;
                        const appDataMatch = scriptContent.match(/window\.__appData\s*=\s*({[\s\S]*?});/);

                        if (appDataMatch) {
                            const appDataStr = appDataMatch[1];
                            const appData = JSON.parse(appDataStr);

                            if (appData.jobBoard && appData.jobBoard.jobPostings) {
                                
                                const jobPostingsFromBaseUrl = appData.jobBoard.jobPostings;

                                for (const job of jobPostingsFromBaseUrl) {
                                    let posting_date = job.updatedAt;

                                    if (await filterJob.postingDateChecker(posting_date)) {
                                        // Convert the DateTime formatted posting_date to date
                                        posting_date = new Date(posting_date).toISOString().split('T')[0];
                                        const extractedJob = {
                                            job_id: job.jobId,
                                            job_title: job.title,
                                            posting_date: posting_date,
                                            location: job.locationName,
                                            company_name: company.name,
                                            // add / between company_jobs_url and job.id
                                            job_link: company_jobs_url + '/' + job.id
                                        };

                                        if (extractedJob.job_id) {
                                            ash_list.push(extractedJob);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    console.log("Error fetching jobs:", company.link, response.statusText);
                    logger.error(`Error fetching jobs for company: ${company.name} url: ${company_jobs_url}`, response.statusText);
                }
            
        } catch (err) {
            console.log("Error fetching jobs:", company.link, err.message);
            logger.error(`Error fetching jobs for company: ${company.name} url: ${company_jobs_url} msg: ${err.message}`, err.message);
            // wait for 10 seconds and try again
            await delay(10000);
            // return fetchJobData(company);
        }
    };

    // const fetchJobsPromises = company_list.map(company => limit(() => fetchJobData(company)));
    // process all companies in multiple batches
    // for (let i = 0; i < company_list.length; i += CONCURRENCY_LIMIT) {
    //     const batch = company_list.slice(i, i + CONCURRENCY_LIMIT);
    //     const batchResults = await Promise.all(batch.map(company => limit(() => fetchJobData(company))));
    //     ash_list.push(...batchResults.filter(job => job !== null));
    // }
    const fetchJobsPromises = company_list.map(company => fetchJobData(company));
    await Promise.all(fetchJobsPromises);
    return ash_list;

};

export const filterAshJobs = async () => {
    console.log("Inside filter Ash jobs");
    logger.info(`Inside filter Ash jobs`);
    const ash_list = await getAshJobs();
    console.log("Total number of jobs found:", ash_list.length);
    logger.info(`Total number of jobs found: ${ash_list.length}`);
    const filtered_ash_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);

    const filterJobData = async (data) => {
        try {
            if (!data || !data.job_link) {
                return null;
            }
            const location_to_check = data.location.toLowerCase();
            const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);
    
            if (location_matched) {
                const title_to_check = data.job_title.toLowerCase();
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);
    
                if (title_matched) {
                    return data;
                }
            }
            return null;
        } catch (error) {
            console.log("Error filtering job data for company:", error.message);
            logger.error(`Error filtering job data for company: ${error.message}`);
        }
    };

    // Process all jobs in a single batch
    const filteredJobs = await Promise.all(
        ash_list.map(job => limit(() => filterJobData(job)))
    );
    filtered_ash_list.push(...filteredJobs.filter(Boolean));
    // Use native sort with a comparison function
    return filtered_ash_list.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));
};