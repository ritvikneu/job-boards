import * as greenService from './../services/greenhouse-service.js';
import { response } from 'express';
import axios from 'axios';
import * as ghService from "../services/greenhouse-service.js";
import * as ghEmbedService from "../services/greenEmbed-service.js";
import * as leverService from "../services/lever-service.js";
import * as workdayService from "../services/workday-service.js";
import * as diceService from "../services/dice-service.js";
import * as oraCloudService from "../services/oraclecloud-service.js";
import { sendMailAttachment } from '../services/mail-service.js';
import { FileHandler } from '../services/file_creation-service.js';

import { config } from 'dotenv';
config();

export const get = async (request, response) => {
    // try {
        const csvFile = 'greenhouse.csv';
        const companies_list = greenService.companies_list()
        console.log(companies_list);
        response.json({companies_list: companies_list});
}


export const getGreenhouse = async (request, response) => { 
    const res = await ghService.getFilteredGreenHouseJobs();
    response.json({message: res});
}

export const getGreenhouseEmbed = async (request, response) => { 
    const res = await ghEmbedService.getFilteredGreenHouseJobs();
    response.json({message: res});
}

export const getLever = async (request, response) => { 
    const res = await leverService.getFilteredLeverJobs();
    response.json({message: res});
}

export const getWorkday = async (request, response) => { 
    const res = await workdayService.filterWorkDayJobs();
    response.json({message: res});
}

export const getDice = async (request, response) => { 
    const res = await diceService.filterDiceJobs();
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
