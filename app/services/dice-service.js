
import { filterJob, locationChecker } from './filtering-service.js';
import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';
import { write } from 'fs';


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
    // const queryParams = {
    //     q: 'software',
    //     countryCode2: 'US',
    //     radius: 30,
    //     radiusUnit: 'mi',
    //     page: 1,
    //     pageSize: 10,
    //     facets: [
    //         'employmentType', 'postedDate', 'workFromHomeAvailability', 'workplaceTypes', 'employerType',
    //         'easyApply', 'isRemote', 'willingToSponsor'
    //     ],
    //     'filters.employmentType': 'FULLTIME',
    //     'filters.employerType': 'Direct Hire',
    //     'filters.postedDate': 'ONE',
    //     fields: [
    //         'id', 'jobId', 'guid', 'summary', 'title', 'postedDate', 'modifiedDate', 'jobLocation.displayName',
    //         'detailsPageUrl', 'salary', 'clientBrandId', 'companyPageUrl', 'companyLogoUrl', 'companyLogoUrlOptimized',
    //         'positionId', 'companyName', 'employmentType', 'isHighlighted', 'score', 'easyApply', 'employerType',
    //         'workFromHomeAvailability', 'workplaceTypes', 'isRemote', 'debug', 'jobMetadata', 'willingToSponsor'
    //     ],
    //     culture: 'en',
    //     recommendations: true,
    //     interactionId: 0,
    //     fj: true,
    //     includeRemote: true
    // };
    const queryParams = {
        page: 3,
        pageSize: 1000,
        facets: ['employmentType', 'postedDate', 'workFromHomeAvailability', 'workplaceTypes', 'employerType', 'easyApply', 'isRemote', 'willingToSponsor'],
        'filters.employmentType': 'FULLTIME',
        'filters.employerType': 'Direct Hire',
        'filters.postedDate': 'ONE',
        // fields: [
        //     'id', 'jobId', 'guid', 'summary', 'title', 'postedDate', 'modifiedDate', 'jobLocation.displayName'
        // ],
        // q: 'software'
    };
    try {
        const diceJobs = await getDiceJobs(queryParams);
        // console.log('Dice Jobs:', diceJobs);
        return diceJobs;
    } catch (error) {
        console.error('Error fetching jobs:', error);
    }
}


export const getAllDiceJobs = async () => {
    const allDiceJobs = await diceJobsFetch();
    const filteredJobs = [];
    const job_links_seen = new Set();

    const job_posting = allDiceJobs.map(async job => {
        let data = {}
        data["company_name"] = job.companyName;
        data["job_title"] = job.title;
        data["job_link"] = job.detailsPageUrl;
        data["location"] = job.jobLocation.displayName;
        data["posting_date"] = job.postedDate;

        let title_to_check = data["job_title"].toLowerCase();

        if (job.jobLocation.country === 'USA') {
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false, 'workday');
            if (title_matched) {
                // console.log("title:", title_to_check);

                if (!job_links_seen.has(data["job_link"])) {
                    job_links_seen.add(data["job_link"]);
                    filteredJobs.push(data);
                }
            }
        }

    });

    const diceJobs = await Promise.all(job_posting);
    writeToExcel(filteredJobs, 'dice');
    return filteredJobs;
    // writeToExcel(filteredJobs, 'dice');
    // console.log("filterDiceJobs", filterDiceJobs);

}

export const filterDiceJobs = async () => {
    const diceJobs = await getAllDiceJobs();
    console.log("inside filter dice jobs");
    // console.log("diceJobs", diceJobs);


}