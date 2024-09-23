
import * as ghService from "../services/greenhouse_v2-service.js";
import * as leverService from "../services/lever-service.js";
import * as wday from "../services/wday-rabbit.js";
import * as diceService from "../services/dice-service.js";
import * as oraCloudService from "../services/oraclecloud-service.js";
import { FileHandler } from '../services/file_creation-service.js';

import { config } from 'dotenv';
config();

export const getGreenhouse = async (request, response) => { 
    let embed = request.body.embed || false;
    const res = await ghService.getFilteredGreenHouseJobs(embed);
    response.json({message: res});
}

// export const getGreenhouseEmbed = async (request, response) => { 
//     // const res = await ghEmbedService.getFilteredGreenHouseJobs();
//     const res = await ghService.getFilteredGreenHouseJobs(true);
//     response.json({message: res});
// }

export const getLever = async (request, response) => { 
    const res = await leverService.getFilteredLeverJobs();
    response.json({message: res});
}

export const getWorkday = async (request, response) => { 
    // const res = await workdayService.filterWorkDayJobs();
    let file_name = request.body.file_name || "wday1";
    const res = await wday.filterWorkDayJobs(file_name);
    response.json({message: res});
}

export const getDice = async (request, response) => { 
    let page_number = request.body.page_number || 1;
    const res = await diceService.filterDiceJobs(page_number);
    response.json({message: res});
}


export const getOraCloud = async (request, response) => { 
    const res = await oraCloudService.filterOracleCloudJobs();;
    response.json({message: res});
}

export const getLatestJobs = async (request, response) => {
    const fileHandler =  new FileHandler()
    fileHandler.getLatestJobs();
    response.json({message: 'Check your mail for the latest jobs'});
}

export const HealthCheck = async (request, response) => {
    // set the response status to 200
    response.status(200);
    response.json({message: process.env.HEALTH_CHECK});
}

const setSuccessfulResponse = (obj,response) => {
    response.status(200); 
    response.json(obj);
}

const setErrorResponse = (err,response) => {
    response.status(500); 
    response.json({
        error: {
            message: err
        }
    });
}
