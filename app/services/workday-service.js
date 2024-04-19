import { parse } from "dotenv";
import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';
import axios from 'axios';

export const workdayFetch = async (url, offset) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            appliedFacets: {},
            limit: 20,
            offset: offset,
            searchText: ''
        })
    });
    const data =  response.json();
    console.log('Data:', data);
    return data.jobPostings;
}

export const workdayJobFetch = async (url) => {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
    });
    // resoolve the promise and return the data
    const data = await response.json();
    console.log('Data:', data.jobPostingInfo);
    // return data.jobPostingInfo;
}

let URL = 'https://fiserv.wd5.myworkdayjobs.com/wday/cxs/fiserv/EXT/jobs';
 URL = 'https://analogdevices.wd1.myworkdayjobs.com/en-US/External/jobs';
 URL = 'https://analogdevices.wd1.myworkdayjobs.com/wday/cxs/analogdevices/External/jobs'
 URL = 'https://centrify.wd1.myworkdayjobs.com/wday/cxs/centrify/External/jobs'
let offset = 0;
let jobPostings = [];
export const workdayCall = async (url=URL) => {
    while (true) {
        let response = await workdayFetch(url, offset);
        console.log('Response:', response);
        // if (offset > 20) {
        //     console.log('Offset minit reached:', offset);
        //     break;
        // }
        
        let postedOn = response[0].postedOn;
        // split the string at space and get the first element
        let postedOnDigit = postedOn.split(' ')[1];
        //check if postedOnDigit is an integer
        try {
            postedOnDigit = parseInt(postedOnDigit);
        } 
        catch (error) {
        }
        postedOnDigit = parseInt(postedOnDigit);

        if ( postedOnDigit > 7) {
            break;
        }
        // // append response to a allJobs array
        jobPostings.push(...response);
        offset += 20;
    }

    let allJobData = []; // Create an array to store data for each job

    console.log('All Jobs:', jobPostings);
    console.log('All Jobs length:', jobPostings.length);
    jobPostings.forEach((job) => {
        let data = {}
        data["company_name"] = "fiserv";
        data["job_title"] = job.title;
        // append URl and job.externalPath
        // exclude the last 4 characters from the URL
        let job_URL = URL.slice(0, -4);
        data["job_link"] = job_URL + job.externalPath;
        // data["job_link"] = job.externalPath;
        data["location"] = job.locationsText;
        data["posting_date"] = job.postedOn;
        allJobData.push(data);
    });

    // console.log('Data:', data);

    writeToCsv(allJobData, 'workday');
    writeToExcel(allJobData, 'workday');
    return allJobData
}

export const filterWorkDayJobs = async () => {
    console.log("inside filter workday jobs");
    const workday_list = await workdayCall();
    const filtered_workday_list = [];
    let maxCount = 0;
    let response = null;
    workday_list.forEach(async data => {
        // console.log(data["job_link"]);
        URL = data["job_link"];
        // console.log(URL);
        
        try {
            response = await workdayJobFetch(URL);
            console.log(response.json());
        }
        catch (error) {
            console.log(error);
            process.exit();
        }
        // response = await workdayJobFetch(URL);



        // if (response.status == 200) {
        //     console.log(response.json());
        // }
        // else {
        //     console.log("Error in fetching job details");
        //     process.exit();
        // }

        // let location_to_check = data["location"];
        // location_to_check = location_to_check.toLowerCase();
        // const location_matched = await filterJob.matchJobsToChecker(location_to_check, false, true);

        // if (location_matched) {
        //     let title_to_check = data["job_title"];
        //     title_to_check = title_to_check.toLowerCase();
        //     const title_matched = await filterJob.matchJobsToChecker(title_to_check, true, false);

        //     let workday_job_link = data["job_link"];

        //     if (title_matched) {
        //         let posting_date = await getJobPostingDates(workday_job_link);
        //         data["posting_date"] = posting_date;
        //         if (posting_date && await filterJob.postingDateChecker(posting_date)) {
        //             return data;
        //         }
        //     }
        // }
        // return null;
    });

    // Wait for all promises to resolve
    // const results = await Promise.all(filter_workday);

    // Filter out null values and add valid items to the filtered list
    // results.forEach(data => {
    //     if (data !== null) {
    //         filtered_workday_list.push(data);
    //         maxCount++;
    //     }
    // });

    // return filtered_workday_list;
}



