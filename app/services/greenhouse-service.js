// const fs = require('fs');

import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import ExcelJS from 'exceljs';
import path from 'path';

export const companies_list = function getCompanies() {

    const greenUrl = "https://boards.greenhouse.io/";
    const greenApis = new Set();
    const company_set = new Set();
    const csvFile = 'app/data/greenhouse_companies.csv';
    let company_list = []; 
    const csvData = readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');
    // console.log(rows);
    rows.forEach(row => {
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            const company = splitRow[0].split('/');
            if (company.length > 0) {
                // console.log(company[0]);
                greenApis.add(greenUrl + company[0]);
                if (!company_set.has(company[0])){
                    company_set.add(company[0]);
                    company_list.push({
                         name: company[0],
                        link: greenUrl + company[0]
                    })
                }
            }
        }
    });

    return company_list;
}

export const getJobs = async ()=>{
    const GH_URL = "https://boards.greenhouse.io"
    const company_list = companies_list();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    let maxCount = 0;
    worksheet.columns = [
        { header: 'Company Name', key: 'company_name', width: 20 },
        { header: 'Job Title', key: 'job_title', width: 50 },
        { header: 'Link', key: 'job_link', width: 70 },
        { header: 'Location', key: 'location', width: 50 },
      ];

      for(let i=0; i<company_list.length; i++){
        let company= company_list[i];
//       company_list.forEach(async company => {
        if (maxCount>1000){
            break;
        }
        let response = null;
        try{
        response =  await axios.get(company.link);
        const headers = response.headers;

        // Calculate the size of the headers in bytes
        const headerSize = JSON.stringify(headers).length;
        // console.log(company.name + " success" + response.status + " " + headerSize)
          if (response.status==200 && headerSize== 469){

            // /*
            const htmlDom = new jsdom.JSDOM(response.data);
             htmlDom.window.document.querySelectorAll('section').forEach(section => {
                section.querySelectorAll('div.opening').forEach(opening => {
                    let data = {}
                    opening.querySelectorAll('a').forEach(link => {
                    
                       data["company_name"] = company.name
                       data["job_title"]= link.innerHTML
                        data["job_link"]= GH_URL + link.getAttribute('href')

                    });
                    opening.querySelectorAll('span.location').forEach(location => {
                        data["location"]= location.innerHTML
                        
                    })
                    worksheet.addRow(data);
                    maxCount++;
                })
                
                
             });            
          }
          else{

            console.log(company.name + " failed " + response.status + " " + headerSize)
          }
    
        }
        catch(err){
            response=null;
            
            console.log( err.message) 
        }
   }

    const filePath = path.join(process.cwd(), 'app','data','jobs.xlsx');
    workbook.xlsx.writeFile(filePath).then(() => {
        console.log('file saved');
    }).catch(err => {
        console.log("error occured while saving file");
    });
}
