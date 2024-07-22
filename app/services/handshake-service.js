
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

async function getShakeJobs(queryParams) {
    const baseUrl = 'https://app.joinhandshake.com/stu/jobs/9064354/recommended_jobs';

    const url = new URL(baseUrl);

    // Add query parameters to the URL
    Object.keys(queryParams).forEach(key => {
        if (Array.isArray(queryParams[key])) {
            queryParams[key].forEach(value => url.searchParams.append(key, value));
        } else {
            url.searchParams.append(key, queryParams[key]);
        }
    });

    // const headers = {
    //     'x-api-key': '1YAt0R9wBg4WfsF9VB2778F5CHLAPMVW3WAZcKd8'
    // };

    try {
        const response = await fetch(url.toString(), {
            method: 'GET',
            // headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const shakeJobs = await response.json();
        return shakeJobs.data;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

// Call the function to get the Dice jobs
export const shakeJobsFetch = async () => {
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



// fetch("https://app.joinhandshake.com/stu/jobs/9064354/recommended_jobs?exclude_saved_jobs=true&per_page=6&_=1719342444129", {
//   "headers": {
//     "accept": "application/json, text/javascript, */*; q=0.01",
//     "accept-language": "en-US,en;q=0.9",
//     "priority": "u=1, i",
//     "sec-ch-ua": "\"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"126\"",
//     "sec-ch-ua-mobile": "?0",
//     "sec-ch-ua-platform": "\"macOS\"",
//     "sec-fetch-dest": "empty",
//     "sec-fetch-mode": "cors",
//     "sec-fetch-site": "same-origin",
//     "x-csrf-token": "uXXpnekOQFLuIUMTN0zNFUZNoclVY9sdAT8WLbFDHrJ9SNqqNKbq26F4670JMnTrb/USVRqSIZe4qVkoJm7Wwg==",
//     "x-requested-with": "XMLHttpRequest",
//     "cookie": "OptanonAlertBoxClosed=2024-06-25T15:34:01.708Z; OptanonConsent=isGpcEnabled=0&datestamp=Tue+Jun+25+2024+11%3A34%3A01+GMT-0400+(Eastern+Daylight+Time)&version=202403.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&landingPath=NotLandingPage&groups=C0003%3A1%2CC0001%3A1%2CC0002%3A1%2CC0004%3A1%2COSSTA_BG%3A1; production_submitted_email_address=eyJfcmFpbHMiOnsibWVzc2FnZSI6IkluQmhjbUZ0YTNWemFHRnRMbk5BYm05eWRHaGxZWE4wWlhKdUxtVmtkU0k9IiwiZXhwIjoiMjA0NC0wNi0yNVQxNTozNDoxMC40MDZaIiwicHVyIjpudWxsfX0%3D--573623a69c28796920ef737c18cfe51231b43953; production_current_user=53329579; hss-global=eyJhbGciOiJkaXIiLCJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIiwidHlwIjoiSldUIn0..gXe-HHLq2JU5Q_WDbN306w.8kh6_fgsVLEok4iNfN9iiHSwqG3vUX32jnFR0i8QjHrWrqKMv2Rjwo5Bhvj0EkSb0sLuwEcYoMnL2Z9psngft6QZKWnMA2XQMRuOyB64t7xkBHSWqfAeNcUXQ8N9mN4ZqSoS25IdYU1U88xhRZngtbT5HYNbykpGK05dF8-XZLo_VBU6N_t-KaS5Jg4ybd_nvmOclWe5nA-yXbD5z5qoH4YA4CLE688tIQ3Lq0LUdR9AS7Ha5q6YnRh3Gy2Adv_1uYFU8-XIvvPh9MykFkkzgVRRnRuDYWcD_62J3n4KtwQA0QaqHzvc8oKkhrF4_PNxMaIeMHhykY565q1c6dgenMm0ModzuOTMVeeTL5bfniOIU4248V95xQqHI4uhzDVn.vB38vqg0FST9TJbtbhFvp1uiBD4g8xQis_tYO3t8SvM; production_js_on=true; production_53329579_incident-warning-banner-show=%5B%5D; _trajectory_session=UWlNUjM4WXdONHVYRVpLdEN5ZHJ3eEY5VTZKNGdiMncrVzV6eDRCN3hTYWFsdllmVjFaMGpCblNrUHZnK0VzSWpFYThjZTYxOEZZTmFueWZROTVaWmYxMEw4VW9KMlo3T1F6aSszZUtkckVzSXJQKzBrS3o1WlVNemw2cU1qTElVUWFFeGpFL2R3MGNPQXZYUG1Eby9QbitiU1R5NVE0NzVPRzd5OGdRY1V0ZHhySkM0UUtCeDNQUjA5UTVoT2treHlXN0pTb0F1cVVFc1VlL2NudkhJYU5BdmloMTQyODBVd0ZvRVUrdm5NZ1FPT3R5WnhhdE5NVWxISjN2bkxpRi0tZjJycTd5ZWdZalRTZVVJMTNCeDdhdz09--533ac1db87db2c0d33967d847aec278d9260cd55",
//     "Referer": "https://app.joinhandshake.com/stu/postings?page=1&per_page=25&sort_direction=desc&sort_column=created_at&employment_type_names%5B%5D=Full-Time&job.job_types%5B%5D=9&job.salary_types%5B%5D=1&job.job_applicant_preference.willing_to_sponsor_candidate=true&job.job_applicant_preference.accepts_opt_cpt_candidates=true&pay_schedule_name=Annual%20Salary&pay_min=10000000",
//     "Referrer-Policy": "strict-origin-when-cross-origin"
//   },
//   "body": null,
//   "method": "GET"
// });