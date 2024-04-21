import { parse } from "dotenv";
import { readFileSync } from 'fs';
import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';
import axios from 'axios';
import { filterJob, locationChecker } from './filtering-service.js';


 

export const workdayFetch = async (url, offset, companyName) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            appliedFacets: {},
            // appliedFacets:{"locationCountry":["bc33aa3152ec42d4995f4791a106ed09"]}, //FILTER BY COUNTRY CODE USA
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
        console.error('Error fetching job data:', error);
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
        console.log('Error fetching job data:', url);
        // throw error; // Throw the error so it can be caught in the calling function
    }
}

export const getAllCompanies = async () => {
    console.log("inside get all workday companies");
    const company_set = new Set();
    const csvFile = 'app/companies/workday_test.csv';
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
            console.log("Error in parsing company names");
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
        while (offset < 260) {
            let response = await workdayFetch(URL, offset, companyName);
            try {
                jobPostings.push(...response);
            }
            catch (error) {
                console.log(`Error in pushing job data ${companyName} to jobPostings array`);
            }
            offset += 20;
        }
    }
    let allJobData = [];
    const jobsInfo = jobPostings.map(async (job) => {
        let data = {}
        let URL = job.baseURL;
        let job_URL = URL.slice(0, -5) + job.externalPath;
        try {
            let jobData = await workdayJobFetch(job_URL);
            data["company_name"] = job.companyName;
            data["job_title"] = jobData.title;
            data["job_link"] = jobData.externalUrl;
            data["location"] = jobData.country.descriptor;
            data["posting_date"] = jobData.startDate;
            allJobData.push(data);
        }
        catch (error) {
            console.log("Error in fetching job data", job_URL);
        }

    }
    );
    const jobDataInfo = await Promise.all(jobsInfo);
    return allJobData
}

export const workdayJobsNoFilter = async () => {
    console.log("inside workday call");
    const company_list = await getAllCompanies();
    const workdayListInfo = await getWorkdayJobs(company_list);

    // writeToCsv(workdayListInfo, "workday");
    // writeToExcel(workdayListInfo, "workday");
    return workdayListInfo;
}

export const filterWorkDayJobs = async () => {
    console.log("inside filter workday jobs");
    const workday_list = await workdayJobsNoFilter();
    const filtered_workday_list = [];

    const jobPosting = workday_list.map(async job => {
        // console.log("inside jobPosting");
        let country_check = job["location"].toLowerCase();
        const location_matched = await locationChecker.isCountryPresentWorkday(country_check);

        if (location_matched) {
            let posting_date = job["posting_date"];
            if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                let title_to_check = job["job_title"].toLowerCase();
                // console.log("title_to_check", title_to_check);
                const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false, 'workday');
                // console.log("title_matched", title_matched);
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

    // Filter out null values (jobs that didn't meet the criteria)
    filteredJobs = filteredJobs.filter(job => job !== null);

    writeToCsv(filteredJobs, "workday");
    writeToExcel(filteredJobs, "workday");

    return filteredJobs;
}


export const getFilteredWorkDayJobs = async () => {
    console.log("inside get filtered workday jobs");
    const workday_list = await filterWorkDayJobs();
}