import * as greenService from './../services/greenhouse-service.js';
import { response } from 'express';


export const get = async (request, response) => {
    // try {
        const csvFile = 'greenhouse.csv';
        const companies_list = greenService.companies_list()
        // convert the companies_list to json and add it to response
        const json_companies_list = JSON.stringify(companies_list);
        // add the json_companies_list to response
        response.status(200).send(json_companies_list);

        //  setSuccessfulResponse(remindersFromDb,response);

    // } catch (error) {
    //     // setErrorResponse(error,response); 
    //     response.status(500).send('No Companies');
    // }

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
