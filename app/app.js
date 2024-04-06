import express from "express";
import mongoose from "mongoose";
import cors from 'cors';
import route from "./routes/index.js";
import * as ghService from "./services/greenhouse-service.js";

const app = express();
app.use(cors());
app.use(express.json());
// app.use(express.urlencoded());
route(app);
// console.log(ghService.companies_list())
// debugger;
ghService.getJobs();
// locationService.country_match();
// locationService.getCombo("Senior Engineer");
// locationService.country_match_loc();
// const connection = mongoose.connect('mongodb://127.0.0.1:27017/local');


export {
    app
} 
