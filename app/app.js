import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";
import * as ghService from "./services/greenhouse-service.js";
import * as leverService from "./services/lever-service.js";
import * as workdayService from "./services/workday-service1.js";

const app = express();
app.use(cors());
app.use(express.json());
route(app);
// ghService.getFilteredGreenHouseJobs();
workdayService.workdayCall();
// workdayService.filterWorkDayJobs();
// leverService.getFilteredLeverJobs();


export {
    app
} 
