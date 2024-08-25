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

var fileName = process.env.FILE_GH
const CONCURRENCY_LIMIT = 300; // Number of concurrent requests

import { createCustomLogger } from '../middleware/logger.js';
const logger = createCustomLogger(fileName);


const company_with_no_date = new Set();

export const getAllCompanies = async (embed) => {
    console.log("inside get all companies");
    if (embed) {
        fileName = process.env.FILE_EMBED;
    }

    let greenUrl = "https://job-boards.greenhouse.io/";
    if (embed) {
        greenUrl = "https://job-boards.greenhouse.io/embed/job_board?for=";
    }
    // console.log("000000000000-0-----00--0980980809080",fileName)
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = `app/companies/greenhouse/${fileName}.csv`;
    let company_list = [];
    const csvCompanyNames = [];
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');
    // console.log(rows);
    rows.forEach(row => {
        
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            // console.log(splitRow)
            const company = splitRow[0].split('/');
            // console.log(company)
            let companyName = company[0].toLowerCase();
            if (company.length > 0) {
                if (!company_set.has(companyName)) {
                    // write all the compnies to a csv file
                    csvCompanyNames.push(company[0]);
                    company_set.add(companyName);
                    company_list.push({
                        name: companyName,
                        link: greenUrl + companyName
                    })
                }
            }
        }
    });

    // fileHandler.writeToCsvCompanyNames(csvCompanyNames.sort(), "gh-embed-ez-all");
    // process.exit();
    return company_list;
}


export const getFilteredGreenHouseJobs = async (embed) => {
    const startTimer = new Date();
    console.log("Start filtering greenhouse jobs:", startTimer);
    const filtered_greenhouse_list = await filterGreenHouseJobs(embed);
    console.log("Filtering started for Greenhouse Jobs:", new Date());
    console.log("Number of jobs after filtering:", filtered_greenhouse_list.length);
    fileHandler.writeToExcel(filtered_greenhouse_list, fileName);
    // total number of jobs filtered
    console.log(filtered_greenhouse_list.length);

    console.log("Time taken to filter Greenhouse Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");
    return filtered_greenhouse_list;
}


const GH_URL = "https://job-boards.greenhouse.io";
// 
export const getGreenHouseJobs = async (embed) => {
    console.log("inside get greenhouse jobs");

    const company_list = await getAllCompanies(embed);
    const greenhouse_list = [];

    const fetchJobData = async (company) => {
        try {
            let total_pages = 1
            let current_page = 0
            while (current_page < total_pages) {
                current_page += 1
                let company_jobs_url = company.link + `&page=${current_page}`;

                let response = await axios.get(company_jobs_url);
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

                            const routeKey = embed ? 'routes/embed.job_board' : 'routes/$url_token';

                            if (remixContext.state && remixContext.state.loaderData && remixContext.state.loaderData[routeKey].jobPosts) {
                                if (current_page == 1) {
                                    total_pages = remixContext.state.loaderData[routeKey].jobPosts.total_pages;
                                }
                                const jobPostingsFromBaseUrl = remixContext.state.loaderData[routeKey].jobPosts.data;

                                for (const job of jobPostingsFromBaseUrl) {
                                    const posting_date = job.published_at;

                                    if (await filterJob.postingDateChecker(posting_date)) {
                                        const extractedJob = {
                                            job_id: job.id,
                                            job_title: job.title,
                                            internal_job_id: job.internal_job_id,
                                            posting_date: posting_date,
                                            position_id: job.requisition_id,
                                            location: job.location,
                                            job_link: job.absolute_url,
                                            published_at: job.published_at,
                                            company_name: company.name
                                        };
                                        greenhouse_list.push(extractedJob);
                                    }
                                    // else{
                                    //     console.log("not adding job",job.title)
                                    // }
                                }
                            }
                        }
                    }
                }
                else{
                    logger.error(`Error fetching jobs for company: ${company.name} url: ${company_jobs_url}`, err);
                }
            }
        } catch (err) {
            console.error('Error fetching jobs:', err);
            return [];
        }
    };

    const fetchJobsPromises = company_list.map(company => fetchJobData(company));
    await Promise.all(fetchJobsPromises);
    return greenhouse_list;
};

export const filterGreenHouseJobs = async (embed) => {
    console.log("Inside filter greenhouse jobs");
    const greenhouse_list = await getGreenHouseJobs(embed);
    console.log("Total number of jobs found:", greenhouse_list.length);
    const filtered_greenhouse_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);

    const filterJobData = async (data) => {
        if (!data.job_link || company_with_no_date.has(data.company_name)) {
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
    };

    // Process all jobs in a single batch
    const filteredJobs = await Promise.all(
        greenhouse_list.map(job => limit(() => filterJobData(job)))
    );

    filtered_greenhouse_list.push(...filteredJobs.filter(Boolean));

    // Use native sort with a comparison function
    return filtered_greenhouse_list.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));
};


export const getJobPublishedAt = async (job_link) => {
    try {
        // Send a GET request to the URL
        const response = await axios.get(job_link);

        if (response.status === 200) {
            // Create a JSDOM object to parse the HTML content
            const dom = new jsdom.JSDOM(response.data);
            const document = dom.window.document;

            // Find the script tag containing the JSON data
            const scriptTag = Array.from(document.querySelectorAll('script')).find(
                script => script.textContent.includes('window.__remixContext')
            );

            if (scriptTag) {
                // Extract the JSON data from the script tag
                const jsonText = scriptTag.textContent
                    .split('window.__remixContext = ')[1]
                    .split(';')[0];

                // Parse the JSON data
                const data = JSON.parse(jsonText);

                // Extract the published_at date
                const publishedAt = data.state.loaderData['routes/$url_token_.jobs_.$job_post_id'].jobPost.published_at;

                return publishedAt;
            }
        }

        console.log(`${job_link} failed`);
        return null;
    } catch (err) {
        console.error("Error in getJobPublishedAt: ", job_link, err.message);
        return null;
    }
};