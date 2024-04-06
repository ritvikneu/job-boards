// const fs = require('fs');
// import { jobChecker } from './job_match-service.js';
import { filterJob } from './filtering-service.js';
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';

import { writeToCsv, writeToExcel } from './file_creation-service.js';


export const companies_list = function getCompanies() {

    const greenUrl = "https://boards.greenhouse.io/";
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = 'app/data/greenhouse_companies.csv';
    let company_list = [];
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

export const getJobs = async () => {
    const GH_URL = "https://boards.greenhouse.io"
    const company_list = companies_list();

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
            if (response.status == 200 && headerSize == 469) {

                // /*
                const htmlDom = new jsdom.JSDOM(response.data);
                htmlDom.window.document.querySelectorAll('section').forEach(section => {
                    section.querySelectorAll('div.opening').forEach(opening => {
                        let data = {}
                        opening.querySelectorAll('a').forEach(link => {

                            data["company_name"] = company.name
                            data["job_title"] = link.innerHTML
                            data["job_link"] = GH_URL + link.getAttribute('href')

                        });
                        opening.querySelectorAll('span.location').forEach(location => {
                            data["location"] = location.innerHTML

                        })
                        let title_to_check = data["job_title"];
                        title_to_check = title_to_check.toLowerCase();
                        const title_matched = filterJob.matchJobsToChecker(title_to_check, true, false);

                        let location_to_check = data["location"];
                        location_to_check = location_to_check.toLowerCase();
                        const location_matched = filterJob.matchJobsToChecker(location_to_check, false, true);

                        if (title_matched && location_matched) {
                            // csvData.push([data["company_name"], data["job_title"], data["job_link"], data["location"]]);
                            greenhouse_list.push(data);
                            maxCount++;
                        }
                    })
                });
            }
            else {
                console.log(company.name + " failed " + response.status + " " + headerSize)
            }

        }
        catch (err) {
            response = null;

            console.log(err.message)
        }
    }

    writeToCsv(greenhouse_list);
    writeToExcel(greenhouse_list);

    return greenhouse_list;

}
