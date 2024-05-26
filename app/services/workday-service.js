import { parse } from "dotenv";

import { logger } from '../middleware/logger.js';
import { readFileSync } from 'fs';

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import axios from 'axios';
import { config } from 'dotenv';
config();

import { FilterJobs, LocationChecker } from './filtering-service.js';
const filterJob = new FilterJobs();
const locationChecker = new LocationChecker();


const fileName = process.env.FILE_WDAY
 

export const workdayFetch = async (url, offset, companyName) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            appliedFacets: {},
            // appliedFacets:{"locationCountry":["bc33aa3152ec42d4995f4791a106ed09"]}, //FILTER BY COUNTRY CODE USA
            // appliedFacets:{"jobFamilyGroup":["e65dbadf6a50100168ed7f2a693c0001","e65dbadf6a50100168ed86fe4cf50001"],"timeType":["1aea6da227e21005504339b6b1770001"]},
            //walmart
            // appliedFacets:{"locationCountry":["bc33aa3152ec42d4995f4791a106ed09"],"jobFamilyGroup":["e83ebdbd2a0a01ea72c2808948e924c6","e83ebdbd2a0a01e7e1477a8948e904c6"]},
            limit: 20,
            offset: offset,
            searchText: ''
            
        })
    });
    try {
        const data = await response.json();
        if (data.jobPostings) {
            data.jobPostings.forEach(job => {
                job.companyName = companyName;
                job.baseURL = url;
            });
        }
        return data.jobPostings;
    } catch (error) {
        logger.error(`'Error in fetching jobs:', ${error}`);
    }
}

export const workdayJobFetch = async (url) => {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
        });
        const jobData = await response.json();
        return jobData.jobPostingInfo;
    } catch (error) {
        logger.error(`'Error fetching single job:' ${url}`);
        // throw error; // Throw the error so it can be caught in the calling function
    }
}

export const getAllCompanies = async () => {
    logger.info("inside get all workday companies");
    const company_set = new Set();
    const csvFile = `app/companies/workday/${fileName}.csv`;
    let company_list = [];
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');

    rows.forEach(row => {
        try {
            const splitRow = row.split('<');
            if (splitRow.length > 0) {
                let companyName = splitRow[0].trim().toLowerCase();
                let companyURL = splitRow[1].trim().toLowerCase();
                if (companyName.length > 0) {
                    if (!company_set.has(companyName)) {
                        // write all the compnies to a csv file
                        company_set.add(companyName);
                        company_list.push({
                            name: companyName,
                            link: companyURL
                        })
                    }
                }
            }
        }
        catch (error) {
            logger.error("Error in parsing company names");
        }
    });
    return company_list;
}



export const getWorkdayJobs = async (company_list) => {
    let jobPostings = [];
    for (let i = 0; i < company_list.length; i++) {
        let companyName = company_list[i].name;
        let URL = company_list[i].link;
        let offset = 0;
        while (offset < process.env.WORKDAY_OFFSET) {
            let response = await workdayFetch(URL, offset, companyName);
            try {
                jobPostings.push(...response);
            }
            catch (error) {
                logger.error(`Error in pushing job data ${companyName} to jobPostings array`);
            }
            offset += 20;
        }
    }
    let allJobData = [];
    const job_links_seen = new Set();

    const jobsInfo = jobPostings.map(async (job) => {
        let data = {}
        let URL = job.baseURL;
        // job.externalPath = vertexinc/job/London-United-Kingdom/Digital-Marketing-Specialist--Europe_JR100862
        // fetch the job data from the externalPath starting from /job return job/London-United-Kingdom/Digital-Marketing-Specialist--Europe_JR100862
        // let job_URL = job.externalPath.split('/job')[1];
        let job_URL = URL.slice(0, -5) + job.externalPath;
        try {
            let jobData = await workdayJobFetch(job_URL);
            data["company_name"] = job.companyName;
            data["job_title"] = jobData.title;
            data["job_link"] = jobData.externalUrl;
            // jobData.jobRequisitionLocation.country.descriptor
            // check if country is present in the job data
            if (jobData.jobRequisitionLocation) {
                data["location"] = jobData.jobRequisitionLocation.country.descriptor;
            }else{
                data["location"] = jobData.country.descriptor;
            }
            data["posting_date"] = jobData.startDate;
            // check if job_link is present in the allJobData
            if (!job_links_seen.has(data["job_link"])) {
                job_links_seen.add(data["job_link"]);
                allJobData.push(data);
            }

            // allJobData.push(data);
        }
        catch (error) {
            logger.error(`"Error fetching job data", ${job_URL}`);
        }

    }
    );
    const jobDataInfo = await Promise.all(jobsInfo);
    return allJobData
}

export const workdayJobsNoFilter = async () => {
    logger.info("inside workday call");
    const company_list = await getAllCompanies();
    const workdayListInfo = await getWorkdayJobs(company_list);

    // writeToCsv(workdayListInfo, "workday");
    // writeToExcel(workdayListInfo, "workday");
    return workdayListInfo;
}

export const filterWorkDayJobs = async () => {
    logger.info("inside filter workday jobs");
    const workday_list = await workdayJobsNoFilter();
    const filtered_workday_list = [];

    const jobPosting = workday_list.map(async job => {
        // logger.info("inside jobPosting");
        let country_check = job["location"].toLowerCase();
        const location_matched = await locationChecker.isCountryPresentWorkday(country_check);

        if (location_matched) {
            let posting_date = job["posting_date"];
            if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                let title_to_check = job["job_title"].toLowerCase();
                // logger.info("title_to_check", title_to_check);
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false, 'workday');
                // logger.info("title_matched", title_matched);
                if (title_matched) {
                    return job; // Keep the job if it matches all criteria
                }
                // return job;
            }
        }

        return null; // Discard the job if it doesn't meet the criteria
    });

    // Wait for all promises to resolve
    let filteredJobs = await Promise.all(jobPosting);

    // Filter out null values (jobs that didn't meet the criteria) and sort by posting date and format the date
    // filteredJobs = filteredJobs.filter(job => job !== null );
    filteredJobs = filteredJobs.filter(job => job !== null).sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));


    // writeToCsv(filteredJobs, "workday");
    // writeToExcel(filteredJobs, fileName);
    fileHandler.writeToExcel(filteredJobs, fileName);

    return filteredJobs;
}


export const getFilteredWorkDayJobs = async () => {
    logger.info("inside get filtered workday jobs");
    const workday_list = await filterWorkDayJobs();
}