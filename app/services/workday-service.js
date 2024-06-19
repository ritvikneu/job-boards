import { readFileSync } from 'fs';
import axios from 'axios';
import { config } from 'dotenv';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs, LocationChecker } from './filtering-service.js';
const filterJob = new FilterJobs();
const locationChecker = new LocationChecker();

const fileName = process.env.FILE_WDAY;
const WORKDAY_OFFSET = parseInt(process.env.WORKDAY_OFFSET) || 200;
const CONCURRENCY_LIMIT = process.env.CONCURRENCY_LIMIT; // Number of concurrent requests

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export const workdayFetch = async (url, offset, companyName) => {
    try {
        const response = await axios.post(url, {
            appliedFacets: {},
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
        console.log('Error in fetching jobs:', error);
        return [];
    }
}

export const workdayJobFetch = async (url) => {
    try {
        const response = await axios.get(url);
        return response.data.jobPostingInfo || null;
    } catch (error) {
        console.log('Error fetching single job:', url);
        return null;
    }
}

// export const getAllCompanies = async () => {
//     console.log("inside get all workday companies");
//     const company_set = new Set();
//     const csvFile = `app/companies/workday/${fileName}.csv`;
//     const csvData = readFileSync(csvFile, 'utf8');
//     const rows = csvData.split('\n');

//     return rows.reduce((acc, row) => {
//         try {
//             const [companyName, companyURL] = row.split('<').map(part => part.trim().toLowerCase());
//             if (companyName && !company_set.has(companyName)) {
//                 company_set.add(companyName);
//                 acc.push({ name: companyName, link: companyURL });
//             }
//         } catch (error) {
//             console.log("Error in parsing company names:", companyName);
//         }
//         return acc;
//     }, []);
// }

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
        }
        return acc;
    }, []);

}

export const getWorkdayJobs = async (company_list) => {
    const jobPostings = [];
    const job_links_seen = new Set();

    const fetchJobsForCompany = async (company) => {
        let offset = 0;
        while (offset < WORKDAY_OFFSET) {
            const jobs = await workdayFetch(company.link, offset, company.name);
            jobPostings.push(...jobs);
            if (jobs.length < 20) break; // No more jobs to fetch
            offset += 20;
        }
    }

    for (let i = 0; i < company_list.length; i += CONCURRENCY_LIMIT) {
        const batch = company_list.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchJobsForCompany));
    }

    const allJobData = [];
    for (let i = 0; i < jobPostings.length; i += CONCURRENCY_LIMIT) {
        const batch = jobPostings.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(async (job) => {
            const job_URL = job.baseURL.slice(0, -5) + job.externalPath;
            const jobData = await workdayJobFetch(job_URL);
            try {
                if (jobData) {
                    const data = {
                        company_name: job.companyName,
                        job_title: jobData.title,
                        job_link: jobData.externalUrl,
                        location: jobData.location,
                        location_country: jobData.jobRequisitionLocation?.country.descriptor || jobData.country.descriptor,
                        posting_date: jobData.startDate,
                        position_id: jobData.jobReqId
                    };
                    if (!job_links_seen.has(data.job_link)) {
                        job_links_seen.add(data.job_link);
                        allJobData.push(data);
                    }
                }

            }
            catch (error) {
                console.log("Error in fetching job data:", job_URL);
            }

        }));
        await delay(100); // Add delay to avoid overloading the server
    }

    return allJobData;
}

export const filterWorkDayJobs = async () => {
    // calculate the time to complete this function
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
                    return job; // Keep the job if it matches all criteria
                }
            }
        }
        return null; // Discard the job if it doesn't meet the criteria
    });

    let filteredJobs = await Promise.all(jobPosting);

    filteredJobs = filteredJobs.filter(job => job !== null).sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

    fileHandler.writeToExcel(filteredJobs, fileName);

    // print the duration in seconds
    console.log("Duration of workday jobs: " + (Date.now() - startTime) / 1000 + " seconds");

    return filteredJobs;
}

export const workdayJobsNoFilter = async () => {
    console.log("inside workday call");
    const company_list = await getAllCompaniesJson();
    return getWorkdayJobs(company_list);
}

// export const getFilteredWorkDayJobs = async () => {
//     console.log("inside get filtered workday jobs");
//     return filterWorkDayJobs();
// }

// const fetchAndLogCompanies = async () => {
//     try {
//         const companies = await getAllCompaniesJson();
//         companies.forEach(company => {
//             console.log(`Name: ${company.name}, Link: ${company.link}`);
//         });

//         setTimeout(() => {
//             console.log("companies", companies);
//         }, 15000);
//     } catch (error) {
//         console.log("Error fetching companies:", error);
//     }
// }

// Call the function
// fetchAndLogCompanies();

// console.log("companies", companies);