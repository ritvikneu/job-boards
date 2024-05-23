import * as greenService from './../services/greenhouse-service.js';
import { response } from 'express';
import axios from 'axios';
import * as ghService from "../services/greenhouse-service.js";
import * as ghEmbedService from "../services/greenEmbed-service.js";
import * as leverService from "../services/lever-service.js";
import * as workdayService from "../services/workday-service.js";


export const get = async (request, response) => {
    // try {
        const csvFile = 'greenhouse.csv';
        const companies_list = greenService.companies_list()
        console.log(companies_list);
        response.json({companies_list: companies_list});
}


export const getGreenhouse = async (request, response) => { 
    res = ghService.getFilteredGreenHouseJobs();
    response.json({message: res});
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
