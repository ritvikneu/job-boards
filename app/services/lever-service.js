import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';

import * as dynamoService from "./dynamo-service.js";

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

// import { logger } from '../middleware/logger.js';

import { config } from 'dotenv';
config();
import { FilterJobs } from './filtering-service.js';
const filterJob = new FilterJobs();

const CONCURRENCY_LIMIT = process.env.CONCURRENCY_LIMIT; // Number of concurrent requests

const fileName = process.env.FILE_LEVER

import { createCustomLogger } from '../middleware/logger.js';
const logger = createCustomLogger(fileName);

export const getAllCompanies = async () => {
    console.log("inside get all companies for lever");
    logger.info("inside get all companies for lever");
    const leverUrl = "https://jobs.lever.co/";
    const csvFile = `app/companies/lever/${fileName}.csv`;
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n').map(row => row.toLowerCase().trim()).filter(row => row.length > 0);

    const company_set = new Set(rows);
    const company_list = Array.from(company_set).map(companyName => ({
        name: companyName,
        link: leverUrl + companyName
    }));
    // sort csvCompanyNames

    // fileHandler.writeToCsvCompanyNames(csvCompanyNames.sort(), "lever");
    // process.exit();
    return company_list;
}

export const getLeverJobs = async () => {
    const company_list = await getAllCompanies();
    let job_links_seen = new Set();
    // create a list of greenhouse companies intialize to empty
    logger.info("Inside get lever jobs");
    console.log("inside get lever jobs");
    let lever_list = [];
    for (let i = 0; i < company_list.length; i++) {
        let company = company_list[i];
        let response = null;
        try {
            response = await axios.get(company.link);
            const headers = response.headers;
            // Calculate the size of the headers in bytes
            const headerSize = JSON.stringify(headers).length;
            // console.log(company.name + " success" + response.status + " " + headerSize)
            if (response.status == 200) {
                const htmlDom = new jsdom.JSDOM(response.data);
                // Assuming 'htmlDom' is your document object
                const postings = htmlDom.window.document.querySelectorAll('.posting');
                postings.forEach(posting => {
                    // Retrieve the href attribute of the posting-title
                    const postingTitleHref = posting.querySelector('.posting-title').getAttribute('href');
                    // Retrieve the text content of the posting-name h5 element
                    const postingNameText = posting.querySelector('.posting-title h5').textContent;
                    // Retrieve the text content of the sort-by-location span element
                    const locationText = posting.querySelector('.sort-by-location').textContent;
                    let data = {
                        "company_name": company.name,
                        "job_title": postingNameText,
                        "job_link": postingTitleHref,
                        "location": locationText,
                        "position_id": postingTitleHref.split('/')[4]
                    }
                    lever_list.push(data);
                });
            }
            else {
                console.log(`Failed Lever on company: ${company.link}`);
                logger.info(`Failed Lever on company: ${company.link}`);
            }
        }
        catch (err) {
            response = null;
            console.log(`Failed Lever on company: ${company.link}`);
            logger.info(`Failed Lever on company link: ${company.link}`);
        }
    }
    return lever_list;
}

export const filterLeverJobs = async () => {
    const lever_list = await getLeverJobs();
    const filtered_lever_list = [];
    console.log("inside filter lever jobs");
    logger.info("Inside filter lever jobs");

    const filter_lever = lever_list.map(async data => {

        try {
            let location_to_check = data["location"];
            location_to_check = location_to_check.toLowerCase();
            const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);
    
            if (location_matched) {
                let title_to_check = data["job_title"];
                title_to_check = title_to_check.toLowerCase();
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);
    
                let lever_job_link = data["job_link"];
    
                if (title_matched) {
                    let posting_date = await getJobPostingDates(lever_job_link);
                    data["posting_date"] = posting_date;
                    if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                        return data;
                    }
                }
            }
        } catch (error) {
            console.log(`Failed to filter Lever Job: ${data.job_link}`);
            logger.info(`Failed to filter Lever Job: ${data.job_link}`);
        }
        return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(filter_lever);
    // Filter out null values and add valid items to the filtered list and sort by posting date
    results.forEach(data => {
        if (data !== null) {
            filtered_lever_list.push(data);
        }
    });
    filtered_lever_list.sort((a, b) => {
        return new Date(b.posting_date) - new Date(a.posting_date);
    }
    );
    return filtered_lever_list;
}

export const filterLeverJobs_normal = async () => {
    const lever_list = await getLeverJobs();
    const filtered_lever_list = [];
    console.log("inside filter lever jobs");
    logger.info("Inside filter lever jobs");
    let count = 0

    const filter_lever = lever_list.map(async data => {

        let lever_job_link = data["job_link"];
        let posting_date = await getJobPostingDates(lever_job_link);
        data["posting_date"] = posting_date;

        let location_to_check = data["location"];
        location_to_check = location_to_check.toLowerCase();
        const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

        if (location_matched) {
            let title_to_check = data["job_title"];
            title_to_check = title_to_check.toLowerCase();
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

            if (title_matched) {

                if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                    return data;
                }
            }
        }
        return null;
    });

    // Wait for all promises to resolve
    filtered_lever_list = await Promise.all(filter_lever);

    // Filter out null values and add valid items to the filtered list and sort by posting date 
    filtered_lever_list.filter(job => job !== null).sort((a, b) => {
        return new Date(b.posting_date) - new Date(a.posting_date);
    }
    );

    return filtered_lever_list;
}

// https://jobs.lever.co/latitudeinc/41326559-ef9a-4b31-ab5d-739be683d52f/
export const getFilteredLeverJobs = async () => {
    const startTimer = Date.now();
    logger.info("Started Lever Jobs at: " + startTimer);
    const filteredJobs = await filterLeverJobs();
    // number of filtered jobs
    console.log("Number of lever filtered jobs", filteredJobs.length);
    logger.info("Number of lever filtered jobs: " + filteredJobs.length);
    // writeToCsv(filteredJobs, "Lever");

    fileHandler.writeToExcel(filteredJobs, fileName);
    logger.info("Time taken to filter Lever Jobs: " + (Date.now() - startTimer) / 1000 + " seconds");
    console.log("Time taken to filter Lever Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");

    return filteredJobs;
}

export const getJobPostingDates = async (job_link) => {
    let response = null;
    try {
        response = await axios.get(job_link);
        if (response.status == 200) {
            const htmlDom = new jsdom.JSDOM(response.data);
            // fetch the job posting date from the script tag
            const job_posting_content = htmlDom.window.document.querySelector('script[type="application/ld+json"]').innerHTML;
            const job_posting_date = JSON.parse(job_posting_content).datePosted;
            return job_posting_date;
        }
        else {
            console.log(job_link + " failed ")
            logger.info("Failed to get Date for Lever Job: " + job_link);
        }
    }
    catch (err) {
        response = null;
    }
}

export const filterLeverJobswithDynamo = async () => {

    // calculate the time to complete this function
    const startTimer = Date.now();

    const lever_list = await getLeverJobs();
    const filtered_lever_list = [];
    console.log("inside filter lever jobs");
    logger.info("Inside filter lever jobs");


    const filter_lever = lever_list.map(async job => {

        let lever_job_link = job.job_link;
        let posting_date = await getJobPostingDates(lever_job_link);
        job.posting_date = posting_date;
        let location_matched = false;
        let title_matched = false;

        // get the posting date from dynamoDb table
        try {
            const dbEntry = await dynamoService.getJobfromDynamoDB(job.job_link)
            if (dbEntry) {
                location_matched = dbEntry.isLocation
                title_matched = dbEntry.isTitle
            } else {
                let location_to_check = job.location.toLowerCase();
                location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

                let title_to_check = job.job_title.toLowerCase();
                title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

                try {
                    await dynamoService.addJobstoDynamoDB({
                        link: job.job_link,
                        title: job.job_title,
                        jobId: job.jobId,
                        location: job.location,
                        datePosted: job.posting_date,
                        companyName: job.company_name,
                        portalName: 'lever',
                        isLocation: location_matched,
                        isTitle: title_matched
                    });
                } catch (error) {
                    console.log(error)

                }
            }
        } catch (error) {
            console.log(error)

        }
        if (location_matched && title_matched) {
            if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                return job;
            }
        }
        return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(filter_lever);

    // Filter out null values and add valid items to the filtered list and sort by posting date
    results.forEach(job => {
        if (job !== null) {
            filtered_lever_list.push(job);
        }
    });
    filtered_lever_list.sort((a, b) => {
        return new Date(b.posting_date) - new Date(a.posting_date);
    }
    );
    // print the duration in seconds
    console.log("Duration: " + (Date.now() - startTimer) / 1000 + " seconds");
    logger.info("Time taken to filter Lever Jobs: " + (Date.now() - startTimer) / 1000 + " seconds");
    return filtered_lever_list;
}
