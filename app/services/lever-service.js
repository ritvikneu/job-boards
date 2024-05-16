import { filterJob } from './filtering-service.js';
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';

import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';
import { config } from 'dotenv';
config();


const fileName = process.env.FILE_NAME
export const getAllCompanies = async () => {
    console.log("inside get all companies for lever");

    const leverUrl = "https://jobs.lever.co/";
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = `app/companies/lever/${fileName}.csv`;
    let company_list = [];
    const csvCompanyNames = [];
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');
    // console.log(rows);
    rows.forEach(row => {
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            const company = splitRow[0].split('/');
            if (company.length > 0) {
                if (!company_set.has(company[0])) {
                    // write all the compnies to a csv file
                    csvCompanyNames.push(company[0]);
                    company_set.add(company[0]);
                    company_list.push({
                        name: company[0],
                        link: leverUrl + company[0]
                    })
                }
            }
        }
    });

    // writeToCsvCompanyNames(csvCompanyNames, "lever");
    return company_list;
}

export const getLeverJobs = async () => {
    console.log("inside get lever jobs");
    const LEVER_URL = "https://jobs.lever.co/";
    const company_list = await getAllCompanies();
    let job_links_seen = new Set();
    // create a list of greenhouse companies intialize to empty
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
                    }
                    lever_list.push(data);
                    // console.log(`Posting Title Href: ${postingTitleHref}`);
                    // console.log(`Posting Name Text: ${postingNameText}`);
                    // console.log(`Location Text: ${locationText}`);
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
    return lever_list;

}

export const filterLeverJobs = async () => {
    const lever_list = await getLeverJobs();
    const filtered_lever_list = [];
    console.log("inside filter lever jobs");
    let maxCount = 0;

    const filter_lever = lever_list.map(async data => {

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
        return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(filter_lever);

    // Filter out null values and add valid items to the filtered list
    results.forEach(data => {
        if (data !== null) {
            filtered_lever_list.push(data);
            maxCount++;
        }
    });

    return filtered_lever_list;
}

export const getFilteredLeverJobs = async () => {
    console.log("inside get filtered Lever jobs");
    const lever_list = await filterLeverJobs();
    console.log("lever_list");
    // writeToCsv(lever_list, "Lever");
    writeToExcel(lever_list, fileName);
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

