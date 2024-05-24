import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import { config } from 'dotenv';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs } from './filtering-service.js';
const filterJob = new FilterJobs();


const fileName = process.env.FILE_EMBED

export const getAllCompanies = async () => {
    console.log("inside get all companies");

    const greenEmbedUrl = "https://boards.greenhouse.io/embed/job_board?for=";
    // console.log("000000000000-0-----00--0980980809080",fileName)
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = `app/companies/greenhouse/${fileName}.csv`;
    let company_list = [];
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');
    // console.log(rows);
    rows.forEach(row => {
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            // console.log(splitRow)
            const company = splitRow[0].split('/');
            // console.log(company)
            let companyName = company[0].toLowerCase();
            if (company.length > 0) {
                if (!company_set.has(companyName)) {
                    // write all the compnies to a csv file
                    company_set.add(companyName);
                    company_list.push({
                        name: companyName,
                        link: greenEmbedUrl + companyName
                    })
                }
            }
        }
    });

    // writeToCsvCompanyNames(company_set, "g-test");
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
    const company_set = new Set();

    for (let i = 0; i < company_list.length; i++) {
        let company = company_list[i];
        // console.log(company)
        let response = null;
        try {
            // console.log(" LINK  ", company.link)
            response = await axios.get(company.link);
            const headers = response.headers;

            // Calculate the size of the headers in bytes
            const headerSize = JSON.stringify(headers).length;
            // console.log(company.name + " success" + response.status + " " + headerSize)
            if (response.status == 200) {
                // clearConsole();
                const htmlDom = new jsdom.JSDOM(response.data);
                htmlDom.window.document.querySelectorAll('section').forEach(async section => {
                    section.querySelectorAll('div.opening').forEach(async opening => {
                        let data = {}
                        opening.querySelectorAll('a').forEach(async link => {

                            data["company_name"] = company.name
                            data["job_title"] = link.innerHTML
                            let job_id = link.getAttribute('href').split('?gh_jid=')[1];
                            data["job_link"] = GH_URL + "/"+ data["company_name"]+ "/jobs/" + job_id

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
                htmlDom.window.close()
            }
            else {
                console.log("Errors --------------- ", company.name);
            }
        }
        catch (err) {
            console.log("Errors --------------- ", company.name);
            response = null;
        }

    }


    // writeToCsvCompanyNames(company_set, "g-test");
    // process.exit();
    return greenhouse_list;

}

export const filterGreenHouseJobs = async () => {
    const greenhouse_list = await getGreenHouseJobs();
    const filtered_greenhouse_list = [];
    console.log("inside filter greenhouse jobs");
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
                // if posting date is not available, then return the data
                // else if (!posting_date){
                //     return data;
                // }
            }
        }
        return null;
    });

    // Wait for all promises to resolve
    // process the promises in sequence
    const results = await Promise.all(filter_greenhouse);
    filter_greenhouse.length = 0; // Release memory by emptying the array

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
    console.log("inside get filtered greenhouse Embed jobs");
    const greenembed_list = await filterGreenHouseJobs();
    console.log("greenhouse_list");
    // writeToCsv(greenhouse_list, fileName);
    // writeToExcel(greenhouse_list, fileName);

    fileHandler.writeToExcel(greenembed_list, fileName);
    return greenembed_list; 
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

function clearConsole() {
    // Move cursor to the beginning of the console
    process.stdout.write('\x1B[2J\x1B[0f');
}


// export const filterGreenHouseJobsBatch = async () => {
//     console.log("inside filter greenhouse jobs");
//     const greenhouse_list = await getGreenHouseJobs();
//     const filtered_greenhouse_list = [];
//     let maxCount = 0;

//     // Define the batch size for processing
//     const batchSize = 100;

//     // Loop through the greenhouse_list in batches
//     for (let i = 0; i < greenhouse_list.length; i += batchSize) { 
//         const batch = greenhouse_list.slice(i, i + batchSize);

//         // Process each batch sequentially
//         for (const data of batch) {
//             let location_to_check = data["location"].toLowerCase();
//             const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

//             if (location_matched) {
//                 let title_to_check = data["job_title"].toLowerCase();
//                 const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

//                 let gh_job_link = data["job_link"];

//                 if (title_matched) {
//                     let posting_date = await getJobPostingDates(gh_job_link);
//                     data["posting_date"] = posting_date;
//                     if (posting_date && await filterJob.postingDateChecker(posting_date)) {
//                         filtered_greenhouse_list.push(data);
//                         maxCount++;
//                     }
//                 }
//             }
//         }
//     }

//     return filtered_greenhouse_list;
// }

// export const filterGreenHouseJobsSeq = async () => {
//     const greenhouse_list = await getGreenHouseJobs();
//     const filtered_greenhouse_list = [];
//     let maxCount = 0;
//     console.log("inside filter greenhouse jobs");

//     // Loop through each data item sequentially
//     for (let data of greenhouse_list) {
//         let location_to_check = data["location"].toLowerCase();
//         const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

//         if (location_matched) {
//             let title_to_check = data["job_title"].toLowerCase();
//             const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

//             let gh_job_link = data["job_link"];

//             if (title_matched) {
//                 let posting_date = await getJobPostingDates(gh_job_link);
//                 data["posting_date"] = posting_date;
//                 if (posting_date && await filterJob.postingDateChecker(posting_date)) {
//                     filtered_greenhouse_list.push(data);
//                     maxCount++;
//                 }
//             }
//         }

//         // Release memory associated with the resolved promise
//         data = null;
//     }

//     return filtered_greenhouse_list;
// }