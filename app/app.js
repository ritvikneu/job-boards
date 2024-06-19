import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";
import * as ghService from "./services/greenhouse-service.js";
import * as ghEmbedService from "./services/greenEmbed-service.js";
import * as leverService from "./services/lever-service.js";
// import * as workdayService from "./services/workday-service-all.js";
import * as workdayService from "./services/workday-service.js";

import * as diceService from "./services/dice-service.js";

import * as oraCloudService from "./services/oraclecloud-service.js";

import * as dynamoService from "./services/dynamo-service.js";

const app = express();
app.use(cors());
app.use(express.json());
route(app);

// RUN ONLY ONE OF THE SERVICE AT A TIME - GREENHOUSE or LEVER or WORKDAY
// // GreenHouse Jobs
// // to run the greenhouse jobs with filter
// ghService.getFilteredGreenHouseJobs();

// GreenHouse Jobs with Embed
// ghEmbedService.getFilteredGreenHouseJobs();


// // Lever Jobs
// // to run the lever jobs with filter
// leverService.getFilteredLeverJobs();

// // Workday Jobs
// // to run the workday jobs with filter
// // set offset in workdayFetch and appliedFacets in workdayJobFetch
// workdayService.filterWorkDayJobs();

// // Dice Jobs
// // to run the dice jobs
// diceService.filterDiceJobs();

// const job_link = 'https://www.dice.com/job-detail/04beaa5b-2778-4f51-b14a-afee043489f3'
// diceService.getJobPositionId(job_link);


// // Oracle Cloud Jobs
// oraCloudService.getAllCompanies();


// ghService.getFilteredGreenHouseJobs();
// ghService.getAllCompanies();
// ghService.getGreenHouseJobs();

// workdayService.workdayJobsNoFilter();
// leverService.getFilteredLeverJobs();


// workdayService.getWorkdayJobs();
// workdayService.getAllCompanies();
// workdayService.workdayFetch(URL, 20, 'Fiserv');
// workdayService.workdayCall();
// workdayService.filterWorkDayJobs();
// workdayService.workdayJobFetch(URL);

// process.exit(0);


// const data = {
//     job_link: 'some-link',
//     job_title: 'some-title_',
//     jobId: 'some-id',
//     location: 'some-location',
//     posting_date: '2024-05-16T00:25:18.000Z',
//     company_name: 'some-company',
//     portalName: 'lever'
//     // Define isTitle, isLocation, and isDatePosted as per your logic
// };

// Example values for the additional parameters
// const isTitle = true;
// const isLocation = true;
// const isDatePosted = true;

// dynamoService.addJobstoDynamoDB({
//     link: data.job_link,
//     title: data.job_title,
//     jobId: data.jobId,
//     location: data.location,
//     datePosted: data.posting_date,
//     companyName: data.company_name,
//     portalName: 'lever',
//     isTitle,
//     isLocation,
//     isDatePosted
// });

// const companies = workdayService.getAllCompaniesJson();
// workdayService.getAllCompaniesJson().then(companies => {
//     companies.forEach(company => {
//         console.log(`Name: ${company.name}, Link: ${company.link}`);
//     });
// }).catch(error => {
//     console.log("Error fetching companies:", error);
// });


export {
    app
} 
