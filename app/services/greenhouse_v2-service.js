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

let fileName = process.env.FILE_GH
const CONCURRENCY_LIMIT = 100; // Number of concurrent requests


import { createCustomLogger } from '../middleware/logger.js';
let logger = createCustomLogger(fileName);

let EMBED = false;

export const getFilteredGreenHouseJobs = async (embed) => {
    EMBED = embed;
    fileName = EMBED ? process.env.FILE_EMBED : process.env.FILE_GH;
    logger = createCustomLogger(fileName);

    const startTimer = new Date();

    console.log("Start filtering greenhouse jobs:", startTimer);
    logger.info(`Start filtering greenhouse jobs: ${startTimer}`);

    const filtered_greenhouse_list = await filterGreenHouseJobs();

    console.log("Filtering started for Greenhouse Jobs:", new Date());
    logger.info(`Filtering started for Greenhouse Jobs: ${new Date()}`);
    console.log("Number of jobs after filtering:", filtered_greenhouse_list.length);
    logger.info(`Number of jobs after filtering: ${filtered_greenhouse_list.length}`);

    fileHandler.writeToExcel(filtered_greenhouse_list, fileName);
    // total number of jobs filtered
    console.log(filtered_greenhouse_list.length);
    logger.info(`Number of jobs after filtering: ${filtered_greenhouse_list.length}`);
    console.log("Time taken to filter Greenhouse Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");
    logger.info(`Time taken to filter Greenhouse Jobs: : ${(Date.now() - startTimer) / 1000} seconds`);
    
    return filtered_greenhouse_list;
}

export const getAllCompanies = async () => {
    const baseGreenUrl = "https://job-boards.greenhouse.io/";
    const greenUrl = EMBED ? `${baseGreenUrl}embed/job_board?for=` : baseGreenUrl;
    fileName = EMBED ? process.env.FILE_EMBED : process.env.FILE_GH;
    const csvFile = `app/companies/greenhouse/${fileName}.csv`;
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n').map(row => row.toLowerCase().trim()).filter(row => row.length > 0);
    const company_set = new Set(rows);
    const company_list = Array.from(company_set).map(companyName => ({
        name: companyName,
        link: greenUrl + companyName
    }));

    // fileHandler.writeToCsvCompanyNames(company_set.sort(), "gh-embed-ez-all");
    // process.exit();
    return company_list;
}

export const getGreenHouseJobs = async () => {
    logger.info(`Inside get greenhouse jobs`);

    const company_list = await getAllCompanies();
    const greenhouse_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);

    async function fetchJobData(company) {
        let requestCount = 0;
        const MAX_REQUESTS = 500; // Adjust this value based on your rate limit

        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        let company_jobs_url = company.link;

        try {
            let total_pages = 1;
            let current_page = 0;
            while (current_page < total_pages) {
                current_page += 1;
                if (current_page > 1) {
                    company_jobs_url = company.link + `&page=${current_page}`;
                }
                // console.log("current page:", current_page);

                // Rate limiting logic
                if (requestCount >= MAX_REQUESTS) {
                    console.log("Rate limit reached, waiting for 10 seconds...");
                    logger.info(`Rate limit reached, waiting for 10 seconds...`);
                    await delay(10000);
                    requestCount = 0; // Reset the counter after waiting
                }

                let response = await axios.get(company_jobs_url);
                requestCount++; // Increment the request counter

                if (response.status === 200) {
                    const htmlDom = new jsdom.JSDOM(response.data);
                    const document = htmlDom.window.document;

                    const scriptTag = Array.from(document.querySelectorAll('script')).find(
                        script => script.textContent.includes('window.__remixContext')
                    );
                    // get all the jobs from the scriptTag
                    if (scriptTag) {
                        const scriptContent = scriptTag.textContent;
                        const remixContextMatch = scriptContent.match(/window\.__remixContext\s*=\s*({[\s\S]*?});/);

                        if (remixContextMatch) {
                            const remixContextStr = remixContextMatch[1];
                            const remixContext = JSON.parse(remixContextStr);

                            const routeKey = EMBED ? 'routes/embed.job_board' : 'routes/$url_token';
                            
                            if (remixContext.state && remixContext.state.loaderData && remixContext.state.loaderData[routeKey].jobPosts) {
                                if (current_page == 1) {
                                    total_pages = remixContext.state.loaderData[routeKey].jobPosts.total_pages;
                                }
                                const jobPostingsFromBaseUrl = remixContext.state.loaderData[routeKey].jobPosts.data;

                                for (const job of jobPostingsFromBaseUrl) {
                                    let posting_date = job.published_at;

                                    if (await filterJob.postingDateChecker(posting_date)) {
                                        // Convert the DateTime formatted posting_date to date
                                        posting_date = new Date(posting_date).toISOString().split('T')[0];
                                        const extractedJob = {
                                            job_id: job.id,
                                            job_title: job.title,
                                            internal_job_id: job.internal_job_id,
                                            posting_date: posting_date,
                                            position_id: job.requisition_id,
                                            location: job.location,
                                            job_link: job.absolute_url,
                                            published_at: posting_date,
                                            company_name: company.name
                                        };

                                        if (extractedJob.job_link) {
                                            greenhouse_list.push(extractedJob);
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
    //     greenhouse_list.push(...batchResults.filter(job => job !== null));
    // }
    const fetchJobsPromises = company_list.map(company => fetchJobData(company));
    await Promise.all(fetchJobsPromises);
    return greenhouse_list;

};

export const filterGreenHouseJobs = async () => {
    console.log("Inside filter greenhouse jobs");
    logger.info(`Inside filter greenhouse jobs`);
    const greenhouse_list = await getGreenHouseJobs();
    console.log("Total number of jobs found:", greenhouse_list.length);
    logger.info(`Total number of jobs found: ${greenhouse_list.length}`);
    const filtered_greenhouse_list = [];
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
        greenhouse_list.map(job => limit(() => filterJobData(job)))
    );
    filtered_greenhouse_list.push(...filteredJobs.filter(Boolean));
    // Use native sort with a comparison function
    return filtered_greenhouse_list.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));
};