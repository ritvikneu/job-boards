import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";
import * as ghService from "./services/greenhouse-service.js";
import * as leverService from "./services/lever-service.js";
// import * as workdayService from "./services/workday-service-all.js";
import * as workdayService from "./services/workday-service.js";

const app = express();
app.use(cors());
app.use(express.json());
route(app);
let URL = 'https://fiserv.wd5.myworkdayjobs.com/wday/cxs/fiserv/EXT/job/Remote-Colorado/Restaurant-Solutions-Business-Consultant_R-10322313'
URL = 'https://fiserv.wd5.myworkdayjobs.com/wday/cxs/fiserv/EXT/jobs'

// RUN ONLY ONE OF THE SERVICE AT A TIME - GREENHOUSE or LEVER or WORKDAY
// // GreenHouse Jobs
// // to run the greenhouse jobs with filter
ghService.getFilteredGreenHouseJobs();

// // Lever Jobs
// // to run the lever jobs with filter
// leverService.getFilteredLeverJobs();

// // Workday Jobs
// // to run the workday jobs with filter
// // set offset in workdayFetch and appliedFacets in workdayJobFetch
// workdayService.filterWorkDayJobs();

// to run the workday jobs without filter
// workdayService.workdayJobsNoFilter();



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


export {
    app
} 
