import * as greenService from './../services/greenhouse-service.js';
import { response } from 'express';


export const get = async (request, response) => {
    // try {
        const csvFile = 'greenhouse.csv';
        const companies_list = greenService.companies_list()
        console.log(companies_list);

        // // add companies_list to the response object
        // setSuccessfulResponse(companies_list,response);
        response.json({companies_list: companies_list});


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
