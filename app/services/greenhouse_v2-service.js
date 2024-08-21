
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import { config } from 'dotenv';
import pLimit from 'p-limit';
config();

import { FileHandler } from './file_creation-service.js';
const fileHandler = new FileHandler();

import { FilterJobs } from './filtering-service.js';
import { logger } from '../middleware/logger.js';
const filterJob = new FilterJobs();

var fileName = process.env.FILE_GH
const CONCURRENCY_LIMIT = 300; // Number of concurrent requests

const company_with_no_date = new Set();
export const getAllCompanies = async (embed) => {
    console.log("inside get all companies");
    if (embed) {
        fileName = process.env.FILE_EMBED;
    }

    let greenUrl = "https://job-boards.greenhouse.io/";
    if (embed) {
        greenUrl = "https://job-boards.greenhouse.io/embed/job_board?for=";
    }
    // console.log("000000000000-0-----00--0980980809080",fileName)
    // const greenApis = new Set();
    const company_set = new Set();
    const csvFile = `app/companies/greenhouse/${fileName}.csv`;
    let company_list = [];
    const csvCompanyNames = [];
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
                    csvCompanyNames.push(company[0]);
                    company_set.add(companyName);
                    company_list.push({
                        name: companyName,
                        link: greenUrl + companyName
                    })
                }
            }
        }
    });

    // fileHandler.writeToCsvCompanyNames(csvCompanyNames.sort(), "gh-embed-ez-all");
    // process.exit();
    return company_list;
}

export const getFilteredGreenHouseJobs = async (embed) => {
    const startTimer = new Date();
    console.log("Start filtering greenhouse jobs:", startTimer);
    console.log("inside get filtered greenhouse jobs");
    const greenhouse_list = await filterGreenHouseJobs(embed);
    console.log("Filtering started for Greenhouse Jobs:", new Date());
    console.log("greenhouse_list");
    fileHandler.writeToExcel(greenhouse_list, fileName);
    console.log("Time taken to filter Greenhouse Jobs: : " + (Date.now() - startTimer) / 1000 + " seconds");
    return greenhouse_list;
}


const GH_URL = "https://job-boards.greenhouse.io";

export const getGreenHouseJobs = async (embed) => {
    console.log("inside get greenhouse jobs");

    const company_list = await getAllCompanies(embed);
    const job_links_seen = new Set();
    const greenhouse_list = [];

    const fetchJobData = async (company) => {
        try {
            const response = await axios.get(company.link);
            if (response.status === 200) {
                const htmlDom = new jsdom.JSDOM(response.data);
                const document = htmlDom.window.document;
                
                const scriptTag = Array.from(document.querySelectorAll('script')).find(
                    script => script.textContent.includes('window.__remixContext')
                );
    
                if (scriptTag) {
                    const scriptContent = scriptTag.textContent;
                    const remixContextMatch = scriptContent.match(/window\.__remixContext\s*=\s*({[\s\S]*?});/);
                    
                    if (remixContextMatch) {
                        const remixContextStr = remixContextMatch[1];
                        const remixContext = JSON.parse(remixContextStr);
                        
                        if (remixContext.state && remixContext.state.loaderData && remixContext.state.loaderData['routes/$url_token'].jobPosts) {
                            const jobPostingsFromBaseUrl = remixContext.state.loaderData['routes/$url_token'].jobPosts.data;
                            
                            for (const job of jobPostingsFromBaseUrl) {
                                const posting_date =  job.published_at ;
                                
                                if (await filterJob.postingDateChecker(posting_date)) {
                                    const extractedJob = {
                                        job_id: job.id,
                                        job_title: job.title,
                                        internal_job_id: job.internal_job_id,
                                        posting_date: posting_date,
                                        position_id: job.requisition_id,
                                        location: job.location,
                                        job_link: job.absolute_url,
                                        published_at: job.published_at,
                                        company_name: company.name
                                    };
                                    
                                    greenhouse_list.push(extractedJob);
                                }
                            }
                        }
                    }
                }
            } 
            return [];
        } catch (err) {
            console.error('Error fetching jobs:', err);
            return [];
        }
    };

    const fetchJobsPromises = company_list.map(company => fetchJobData(company));
    await Promise.all(fetchJobsPromises);
    return greenhouse_list;
};

export const filterGreenHouseJobs = async (embed) => {
    console.log("inside filter greenhouse jobs");
    const greenhouse_list = await getGreenHouseJobs(embed);
    const filtered_greenhouse_list = [];
    const limit = pLimit(CONCURRENCY_LIMIT);


    const filterJobData = async (data) => {
        // console.log(`------ ${data["job_link"]} -----`);
        if(!data["job_link"] || data["company_name"] in company_with_no_date) {
            console.log("skipping---------", data["company_name"]);
            return null;
        }
        let location_to_check = data["location"].toLowerCase();
        const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

        if (location_matched) {
            let title_to_check = data["job_title"].toLowerCase();
            const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

            if (title_matched) {
                // let posting_date = data["posting_date"];
                // if (posting_date && await filterJob.postingDateChecker(posting_date)) {
                    return data;
                // }
                // else if (!posting_date) {
                //     return data;
                // }
            }
        }
        return null;
    };

    const filterJobsBatched = async (jobs) => {
        const filterPromises = jobs.map(job => limit(() => filterJobData(job)));
        return await Promise.all(filterPromises);
    };

    for (let i = 0; i < greenhouse_list.length; i += CONCURRENCY_LIMIT) {
        const batch = greenhouse_list.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await filterJobsBatched(batch);
        filtered_greenhouse_list.push(...batchResults.filter(job => job !== null));
    }

    filtered_greenhouse_list.sort((a, b) => new Date(b.posting_date) - new Date(a.posting_date));

    return filtered_greenhouse_list;
};

export const getJobPostingDates = async (job_link,company) => {
    let response = null;
    try {
        response = await axios.get(job_link);
        const headers = response.headers;

        if (response.status == 200) {
            const htmlDom = new jsdom.JSDOM(response.data);
            // fetch the job posting date from the script tag
            if (!htmlDom.window.document.querySelector('script[type="application/ld+json"]').innerHTML) {
                return null;
            }
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
        console.log("Error in getJobPostingDates: ", job_link,err.message);
        company_with_no_date.add(company);
        return null;
    }
}


export const getJobPublishedAt = async (job_link) => {
  try {
    // Send a GET request to the URL
    const response = await axios.get(job_link);

    if (response.status === 200) {
      // Create a JSDOM object to parse the HTML content
      const dom = new jsdom.JSDOM(response.data);
      const document = dom.window.document;

      // Find the script tag containing the JSON data
      const scriptTag = Array.from(document.querySelectorAll('script')).find(
        script => script.textContent.includes('window.__remixContext')
      );

      if (scriptTag) {
        // Extract the JSON data from the script tag
        const jsonText = scriptTag.textContent
          .split('window.__remixContext = ')[1]
          .split(';')[0];

        // Parse the JSON data
        const data = JSON.parse(jsonText);

        // Extract the published_at date
        const publishedAt = data.state.loaderData['routes/$url_token_.jobs_.$job_post_id'].jobPost.published_at;

        return publishedAt;
      }
    }

    console.log(`${job_link} failed`);
    return null;
  } catch (err) {
    console.error("Error in getJobPublishedAt: ", job_link, err.message);
    return null;
  }
};