import { filterJob } from './filtering-service.js';
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';

import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';



export const getAllCompanies = async() => {
    console.log("inside get all companies");

    const greenUrl = "https://boards.greenhouse.io/";
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = 'app/data/greenhouse_companies_test.csv';
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
                // console.log(company[0]);
                // greenApis.add(greenUrl + company[0]);
                if (!company_set.has(company[0])) {
                    // write all the compnies to a csv file
                    csvCompanyNames.push(company[0]);
                    company_set.add(company[0]);
                    company_list.push({
                        name: company[0],
                        link: greenUrl + company[0]
                    })
                }
            }
        }
    });


    return company_list;
}

export const getGreenHouseJobs = async () => {
    console.log("inside get greenhouse jobs");
    const GH_URL = "https://boards.greenhouse.io"
    const company_list = await getAllCompanies();
    // create a list of greenhouse companies intialize to empty
    let greenhouse_list = [];
    let maxCount = 0;

    for (let i = 0; i < company_list.length; i++) {
        let company = company_list[i];
        //       company_list.forEach(async company => {
        if (maxCount > 100) {
            break;
        }
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
                        let title_to_check = data["job_title"];
                        title_to_check = title_to_check.toLowerCase();
                        const title_matched = filterJob.matchJobsToChecker(title_to_check, true, false);

                        let location_to_check = data["location"];
                        location_to_check = location_to_check.toLowerCase();
                        const location_matched = filterJob.matchJobsToChecker(location_to_check, false, true);

                        let gh_job_link = data["job_link"];

                        if (title_matched && location_matched) {
                            // csvData.push([data["company_name"], data["job_title"], data["job_link"], data["location"]]);
                            //wait for the job posting date
                            let posting_date = await getJobPostingDates(gh_job_link);
                            data["posting_date"] = posting_date;
                            // if the posting date is not null and less than 30 days from current then push the data to the greenhouse list
                            if (posting_date && filterJob.postingDateChecker(posting_date)) {
                                // if the job link is not already in the greenhouse list then add it
                                if (!greenhouse_list.includes(data)) {
                                    greenhouse_list.push(data);
                                    maxCount++;
                                }
                            }
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

export const getFilteredGreenHouseJobs = async () => {
    console.log("inside get filtered greenhouse jobs");
    const greenhouse_list = await getGreenHouseJobs();
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
        // console.log(err.message)
    }
}

