import { parse } from "dotenv";

import { readFileSync } from 'fs';

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { logger } from '../middleware/logger.js';

import axios from 'axios';
import { config } from 'dotenv';
config();

import { FilterJobs, LocationChecker } from './filtering-service.js';
import { count } from "console";
const filterJob = new FilterJobs();
const locationChecker = new LocationChecker();

const fileName = process.env.FILE_ORACLOUD

export const fetchJobs = async (companyName, url, jobSearchUrl) => {

    console.log('Fetching jobs for:', companyName);
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    try {
        const data = await response.json();
        let requisitionList = data.items[0].requisitionList;
        // return requisitionList;

        let jobData = [];
        // let getJobData = 
        requisitionList.forEach(job => {
            let data = {}
            data["company_name"] = companyName;
            data["job_title"] = job.Title;
            data["job_link"] = jobSearchUrl + job.Id;
            data["location"] = job.PrimaryLocation;
            data["country"] = job.PrimaryLocationCountry;
            data["posting_date"] = job.PostedDate;
            jobData.push(data);
        });

        // await Promise.all(getJobData);
        return jobData;

    }
    catch (error) {
        console.error(`'Error in fetching jobs:', ${error}`);
    }
}

export const getAllJobPostings = async () => {

    console.log('Getting all companies from Oracle Cloud...');
    const file = `app/companies/oracloud/${fileName}.json`;
    // read a json file with company names, url and job search url
    const content = JSON.parse(readFileSync(file, 'utf8'));

    let allJobPostings = [];

    // loop through the json file and get all company names, urls and job search urls
    let getALlJobs = content.map(async (company) => {
        const companyName = company.companyName;
        const url = company.url;
        const jobSearchUrl = company.jobSearchUrl;

        console.log('Company Name:', companyName);
        logger.info(`Company Name: ${companyName}`);

        // fetch the company jobs
        try {
            let response = await fetchJobs(companyName, url, jobSearchUrl);
            allJobPostings.push(...response);
        } catch (error) {
            console.log("Error in fetching jobs:",companyName, error);
            
        }
    });

    await Promise.all(getALlJobs);

    console.log('All companies:', allJobPostings.length);
    logger.info(`All companies: ${allJobPostings.length}`);
    return allJobPostings;
}

export const filterOracleCloudJobs = async () => {
    const allJobs = await getAllJobPostings();
    const job_links_seen = new Set();


    const job_posting = allJobs.map(async job => {
        let country_check = job["country"].toLowerCase();
        if (country_check === 'united states' || country_check === 'us' || country_check === 'usa') {
            let posting_date = job["posting_date"];

            if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                let title_to_check = job["job_title"].toLowerCase();
                // console.log("title_to_check", title_to_check);
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);
                // console.log("title_matched", title_matched);
                if (title_matched) {
                    return job; // Keep the job if it matches all criteria
                }
                // return job;
            }
        }
        return null;

    });

    let filteredJobs = await Promise.all(job_posting);
    // remove null values from the array and sort by posting date
    filteredJobs = filteredJobs.filter(job => job !== null).sort((a, b) => {
        return new Date(b.posting_date) - new Date(a.posting_date);
    }
    );
    fileHandler.writeToExcel(filteredJobs, fileName);
    console.log('Total Oracle Cloud Jobs:', filteredJobs.length);
    logger.info(`Total Oracle Cloud Jobs: ${filteredJobs.length}`);
    return filteredJobs;

}



