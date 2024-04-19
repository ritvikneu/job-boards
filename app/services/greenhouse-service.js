import { filterJob } from './filtering-service.js';
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';

import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';

export const getAllCompanies = async () => {
    console.log("inside get all companies");

    const greenUrl = "https://boards.greenhouse.io/";
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = 'app/data/companies/greenhouse_companies.csv';
    let company_list = [];
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');
    // console.log(rows);
    rows.forEach(row => {
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            const company = splitRow[0].split('/');
            let companyName = company[0].toLowerCase();
            if (company.length > 0) {
                if (!company_set.has(companyName)) {
                    // write all the compnies to a csv file
                    company_set.add(companyName);
                    company_list.push({
                        name: companyName,
                        link: greenUrl + companyName
                    })
                }
            }
        }
    });

    // writeToCsvCompanyNames(company_set, "greenhouse");
    // process.exit();
    return company_list;
}

export const getGreenHouseJobs = async () => {
    console.log("inside get greenhouse jobs");
    const GH_URL = "https://boards.greenhouse.io"
    const company_list = await getAllCompanies();
    let job_links_seen = new Set();
    // create a list of greenhouse companies intialize to empty
    let greenhouse_list = [];

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
                htmlDom.window.document.querySelectorAll('section').forEach(async section => {
                    section.querySelectorAll('div.opening').forEach(async opening => {
                        let data = {}
                        opening.querySelectorAll('a').forEach(async link => {

                            data["company_name"] = company.name
                            data["job_title"] = link.innerHTML
                            data["job_link"] = GH_URL + link.getAttribute('href')


                        });
                        opening.querySelectorAll('span.location').forEach(async location => {
                            data["location"] = location.innerHTML

                        })
                        if (!job_links_seen.has(data["job_link"])) {
                            job_links_seen.add(data["job_link"]);
                            greenhouse_list.push(data);
                        }
                    })
                });
            }
            else {
                console.log(company.name + " failed ")
            }
        }
        catch (err) {
            response = null;
        }
    }
    return greenhouse_list;

}

export const filterGreenHouseJobs = async () => {
    console.log("inside filter greenhouse jobs");
    const greenhouse_list = await getGreenHouseJobs();
    const filtered_greenhouse_list = [];
    let maxCount = 0;


    const filter_greenhouse = greenhouse_list.map(async data => {

        let location_to_check = data["location"];
        location_to_check = location_to_check.toLowerCase();
        const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

        if (location_matched) {
            let title_to_check = data["job_title"];
            title_to_check = title_to_check.toLowerCase();
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

            let gh_job_link = data["job_link"];

            if (title_matched) {
                let posting_date = await getJobPostingDates(gh_job_link);
                data["posting_date"] = posting_date;
                if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                    return data;
                }
            }
        }
        return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(filter_greenhouse);

    // Filter out null values and add valid items to the filtered list
    results.forEach(data => {
        if (data !== null) {
            filtered_greenhouse_list.push(data);
            maxCount++;
        }
    });

    return filtered_greenhouse_list;
}



export const getFilteredGreenHouseJobs = async () => {
    console.log("inside get filtered greenhouse jobs");
    const greenhouse_list = await filterGreenHouseJobs();
    console.log("greenhouse_list");
    writeToCsv(greenhouse_list, "greenhouse");
    writeToExcel(greenhouse_list, "greenhouse");
}


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

