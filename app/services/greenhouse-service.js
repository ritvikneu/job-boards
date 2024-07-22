
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import { config } from 'dotenv';
import pLimit from 'p-limit';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs } from './filtering-service.js';
import { logger } from '../middleware/logger.js';
const filterJob = new FilterJobs();

var fileName = process.env.FILE_GH
const CONCURRENCY_LIMIT = 300; // Number of concurrent requests
export const getAllCompanies = async (embed) => {
    console.log("inside get all companies");
    if (embed) {
        fileName = process.env.FILE_EMBED;
    }

    let greenUrl = "https://boards.greenhouse.io/";
    if (embed) {
        greenUrl = "https://boards.greenhouse.io/embed/job_board?for=";
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

    // fileHandler.writeToCsvCompanyNames(csvCompanyNames.sort(), "g-test");
    // process.exit();
    return company_list;
}

export const getFilteredGreenHouseJobs = async (embed) => {
    const startTimer = new Date();
    console.log("Start filtering greenhouse jobs:", startTimer);
    console.log("inside get filtered greenhouse jobs");
    const greenhouse_list = await filterGreenHouseJobs(embed);
    console.log("Filtering started for Greenhouse Jobs:", new Date());
    console.log("greenhouse_list");
    fileHandler.writeToExcel(greenhouse_list, fileName);
    console.log("Time taken to filter Greenhouse Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");
    return greenhouse_list;
}


const GH_URL = "https://boards.greenhouse.io";

export const getGreenHouseJobs = async (embed) => {
    console.log("inside get greenhouse jobs");

    const company_list = await getAllCompanies(embed);
    const job_links_seen = new Set();
    const greenhouse_list = [];

    const fetchJobs = async (company) => {
        try {
            const response = await axios.get(company.link);
            if (response.status === 200) {
                const htmlDom = new jsdom.JSDOM(response.data);
                const jobs = htmlDom.window.document.querySelectorAll('section div.opening');
                jobs.forEach(opening => {
                    const data = {};
                    const link = opening.querySelector('a');
                    const location = opening.querySelector('span.location');

                    if (link && location) {
                        const job_link = link.getAttribute('href');

                        data["company_name"] = company.name;
                        // console.log("company name", company.name);
                        data["job_title"] = link.innerHTML;
                        data["location"] = location.innerHTML;

                        if (embed) {

                            let position_id = link.getAttribute('href').split('?gh_jid=')[1];
                            data["position_id"] = position_id;
                            data["job_link"] = GH_URL + "/" + data["company_name"] + "/jobs/" + position_id;
                                
                        } else {

                            let position_id = job_link.split('/')[3];
                            data["position_id"] = position_id;
                            data["job_link"] = GH_URL + job_link;
                        }


                        if (!job_links_seen.has(data["job_link"])) {
                            job_links_seen.add(data["job_link"]);
                            greenhouse_list.push(data);
                        }
                    }
                });
                htmlDom.window.close();
            } else {
                console.log(`Error fetching jobs for ${company.name}`);
                logger.error(`Error fetching jobs for ${company.name}`);
            }
        } catch (err) {
            console.log(`Error fetching jobs for ${company.name}`);
            logger.error(`Error fetching jobs for ${company.name}`);
        }
    };

    const fetchJobsPromises = company_list.map(company => fetchJobs(company));
    await Promise.all(fetchJobsPromises);

    // const fetchJobsBatched = async (companies) => {
    //     const fetchJobsPromises = companies.map(company => limit(() => fetchJobs(company)));
    //     await Promise.all(fetchJobsPromises);
    // };

    // // Process companies in batches
    // const BATCH_SIZE = 50; // Adjust the batch size as needed
    // for (let i = 0; i < company_list.length; i += BATCH_SIZE) {
    //     const batch = company_list.slice(i, i + BATCH_SIZE);
    //     await fetchJobsBatched(batch);
    // }


    return greenhouse_list;
};

export const filterGreenHouseJobs = async (embed) => {
    console.log("inside filter greenhouse jobs");
    const greenhouse_list = await getGreenHouseJobs(embed);
    const filtered_greenhouse_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);

    const filterJobData = async (data) => {
        let location_to_check = data["location"].toLowerCase();
        const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

        if (location_matched) {
            let title_to_check = data["job_title"].toLowerCase();
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

            if (title_matched) {
                let posting_date = await getJobPostingDates(data["job_link"]);
                data["posting_date"] = posting_date;
                if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                    return data;
                }
            }
        }
        return null;
    };

    const filterJobsBatched = async (jobs) => {
        const filterPromises = jobs.map(job => limit(() => filterJobData(job)));
        return await Promise.all(filterPromises);
    };

    for (let i = 0; i < greenhouse_list.length; i += CONCURRENCY_LIMIT) {
        const batch = greenhouse_list.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await filterJobsBatched(batch);
        filtered_greenhouse_list.push(...batchResults.filter(job => job !== null));
    }

    filtered_greenhouse_list.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

    return filtered_greenhouse_list;
};

export const getJobPostingDates = async (job_link) => {
    let response = null;
    try {
        response = await axios.get(job_link);
        const headers = response.headers;

        // Calculate the size of the headers in bytes
        const headerSize = JSON.stringify(headers).length;
        // console.log(job_link + " success" + response.status + " " + headerSize)
        if (response.status == 200) {
            const htmlDom = new jsdom.JSDOM(response.data);
            // fetch the job posting date from the script tag
            const job_posting_content = htmlDom.window.document.querySelector('script[type="application/ld+json"]').innerHTML;
            const job_posting_date = JSON.parse(job_posting_content).datePosted;
            // console.log(job_posting_date);
            return job_posting_date;
        }
        else {
            console.log(job_link + " failed ")
        }

    }
    catch (err) {
        response = null;
    }
}

