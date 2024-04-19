import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";
import * as ghService from "./services/greenhouse-service.js";
import * as leverService from "./services/lever-service.js";
// import * as workdayService from "./services/workday-service-all.js";
import * as workdayService from "./services/workday-service-filtering.js";

const app = express();
app.use(cors());
app.use(express.json());
route(app);
let URL = 'https://fiserv.wd5.myworkdayjobs.com/wday/cxs/fiserv/EXT/job/Remote-Colorado/Restaurant-Solutions-Business-Consultant_R-10322313'
URL = 'https://fiserv.wd5.myworkdayjobs.com/wday/cxs/fiserv/EXT/jobs'
// ghService.getFilteredGreenHouseJobs();
// workdayService.getWorkdayJobs();
// workdayService.getAllCompanies();
// workdayService.workdayFetch(URL, 20, 'Fiserv');
// workdayService.workdayCall();
workdayService.filterWorkDayJobs();
// workdayService.workdayJobFetch(URL);
// workdayService.filterWorkDayJobs();
// leverService.getFilteredLeverJobs();


export {
    app
} 
