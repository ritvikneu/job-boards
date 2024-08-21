
import { write } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;
import { config } from 'dotenv';
config();

import { FilterJobs } from './filtering-service.js';
const filterJob = new FilterJobs();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

async function getDiceJobs(queryParams) {
    const baseUrl = 'https://job-search-api.svc.dhigroupinc.com/v1/dice/jobs/search';
    const url = new URL(baseUrl);
    // Add query parameters to the URL
    Object.keys(queryParams).forEach(key => {
        if (Array.isArray(queryParams[key])) {
            queryParams[key].forEach(value => url.searchParams.append(key, value));
        } else {
            url.searchParams.append(key, queryParams[key]);
        }
    });

    const headers = {
        'x-api-key': '1YAt0R9wBg4WfsF9VB2778F5CHLAPMVW3WAZcKd8'
    };

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const diceJobs = await response.json();
        return diceJobs.data;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

// Call the function to get the Dice jobs
export const diceJobsFetch = async () => {
    const queryParams = {
        page: 1,
        pageSize: 1000,
        facets: ['employmentType', 'postedDate', 'workFromHomeAvailability', 'workplaceTypes', 'employerType', 'easyApply', 'isRemote', 'willingToSponsor'],
        'filters.employmentType': 'FULLTIME',
        'filters.employerType': 'Direct Hire',
        'filters.postedDate': 'ONE',
        // 'filters.clientBrandNameFilter': 'Goldman Sachs & Co.'
        // fields: [
        //     'id', 'jobId', 'guid', 'summary', 'title', 'postedDate', 'modifiedDate', 'jobLocation.displayName'
        // ],
        q: 'software'
    };
    try {
        const diceJobs = await getDiceJobs(queryParams);
        // console.log('Dice Jobs:', diceJobs);
        return diceJobs;
    } catch (error) {
        console.error('Error fetching jobs:', error);
    }
}


export const filterDiceJobs = async () => {
    const allDiceJobs = await diceJobsFetch();
    const filteredJobs = [];
    const job_links_seen = new Set();

    const job_posting = allDiceJobs.map(async job => {
        let data = {}
        data["company_name"] = job.companyName;
        data["job_title"] = job.title;
        data["job_link"] = job.detailsPageUrl;
        data["location"] = job.jobLocation.displayName;
        // format the current date to the same format as the posting date(YYYY-MM-DD)
        let formatted_date = new Date(job.postedDate);
        data["posting_date"] = formatted_date;

        let title_to_check = data["job_title"].toLowerCase();

        if (job.jobLocation.country === 'USA') {
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false, 'workday');
            if (title_matched) {
                // console.log("title:", title_to_check);
                data["position_id"] = await getJobPositionId(data["job_link"]);
                if (!job_links_seen.has(data["job_link"])) {
                    job_links_seen.add(data["job_link"]);
                    filteredJobs.push(data);
                }
            }
        }

    });

    const diceJobs = await Promise.all(job_posting);
    // writeToExcel(filteredJobs, 'dice');
    // sort all the jobs by company name
    filteredJobs.sort((a, b) => {
        return a.company_name.localeCompare(b.company_name);
    });
    fileHandler.writeToExcel(filteredJobs, 'dice');
    return filteredJobs;
    // writeToExcel(filteredJobs, 'dice');
    // console.log("filterDiceJobs", filterDiceJobs);

}

export const getJobPositionId = async (job_link) => {
    let response = null;

    try {
        response = await axios.get(job_link);

        if (response.status == 200) {
            const htmlDom = new JSDOM(response.data);

            // Fetch the aside tag with the class 'legalInfo'
            const asideTag = htmlDom.window.document.querySelector('aside.legalInfo');

            if (asideTag) {
                // Get the li tag with the data-testid 'legalInfo-referenceCode'
                const jobPositionElement = asideTag.querySelector('li[data-testid="legalInfo-referenceCode"]');

                if (jobPositionElement) {
                    // Extract the position ID text
                    const jobPositionId = jobPositionElement.textContent.trim().replace('Position Id:', '').trim();
                    // console.log("Job Position ID:", jobPositionId);
                    return jobPositionId;
                } else {
                    console.log("Job Position ID element not found");
                    return 0;
                }
            } else {
                console.log("Aside tag with class 'legalInfo' not found");
                return 0;
            }
        } else {
            console.log("Cannot fetch job position id");
            return 0;
        }
    } catch (error) {
        console.log("Error in fetching job position id");
        return 0;
    }
};

