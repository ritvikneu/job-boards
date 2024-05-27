import { readFileSync, writeFileSync, existsSync } from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';
import { config } from 'dotenv';
// import { send } from 'process';
import { sendMail, sendMailAttachment } from './mail-service.js';
// import { sendMail } from '../data/';
config();


class FileHandler {
    constructor() {
        // this.fileName = fileName;
        this.currDate = new Date();
        this.formattedDate = this.currDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        this.formattedTime = this.currDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric' });
        // this.excelFileName = `Jobs_${this.formattedDate}-${this.formattedTime}.xlsx`;
        this.excelFileName = `Jobs_${this.formattedDate}.xlsx`;
        this.csvFileName = `_${this.formattedDate}-${this.formattedTime}.csv`;
        this.workbook = new ExcelJS.Workbook();
        this.csvData = [];
    }

    async writeToExcel(data, listing) {
        const excelFileName = `${this.excelFileName}`;
        const excelFilePath = path.join(process.cwd(), 'app', 'data', excelFileName);
     

        if (existsSync(excelFilePath)) {
            await this.workbook.xlsx.readFile(excelFilePath);
        }

        let worksheet = this.workbook.getWorksheet(listing);
        if (!worksheet) {
            worksheet = this.workbook.addWorksheet(listing);
            worksheet.columns = [
                { header: 'Company Name', key: 'company_name', width: 20 },
                // { header: 'Job Title', key: 'job_title', width: 50 },
                { header: 'Job Info', key: 'job_title', width: 70, style: { font: { color: { argb: 'FF0000FF' } } } },
                // { header: 'Link', key: 'job_link', width: 70, style: { font: { color: { argb: 'FF0000FF' } } } },
                { header: 'Location', key: 'location', width: 50 },
                { header: 'Posting Date', key: 'posting_date', width: 50 },
                { header: 'Job ID', key: 'postion_id', width: 50 }
            ];
        }

        data.forEach(row => {
            row["job_title"] = {
                text: row["job_title"],
                hyperlink: row["job_link"]
            };
            worksheet.addRow(row);
        });

        try {
            await this.workbook.xlsx.writeFile(excelFilePath);
            sendMail(listing, excelFileName);

            console.log('Excel file saved:----------------', listing);
            printSuccessMessage(listing);
            sendMailAttachment(listing, `Please find the attached Excel file with the job listings`, excelFilePath, excelFileName);
        } catch (err) {
            console.log("Error occurred while saving Excel file:", err);
        }
    }

    writeToCsv(data, listing) {
        const header = ['Company Name', 'Job Title', 'Link', 'Location', 'Posting Date', 'Job ID'];
        this.csvData.push(header);

        data.forEach(row => {
            this.csvData.push([row["company_name"], row["job_title"], row["job_link"], row["location"], row["posting_date"], row["postion_id"]]);
        });

        const csvFileName = `${listing}-${this.csvFileName}`;
        const csvFilePath = path.join(process.cwd(), 'app', 'data', csvFileName);
        const csvDataString = this.csvData.map(row => row.join(',')).join('\n');
        
        try {
            writeFileSync(csvFilePath, csvDataString);
            console.log('CSV file saved:', listing);
        } catch (error) {
            console.log("Error occurred while saving CSV file:", error);
        }
    }

    writeToCsvCompanyNames(data, listing) {
        data.forEach(row => {
            this.csvData.push(row);
        });

        const csvFileName = `${listing}-companies.csv`;
        const csvFilePath = path.join(process.cwd(), 'app', 'data', csvFileName);
        const csvDataString = this.csvData.join('\n');
        
        try {
            writeFileSync(csvFilePath, csvDataString);
            console.log('CSV file for company names saved:', listing);
        } catch (error) {
            console.log("Error occurred while saving CSV file for company names:", error);
        }
    }
}

function printSuccessMessage(listing) {
   
    console.log("------------^^^^^^^^^^-----------------");
    console.log("--------------------------------------");
    console.log("--------------------------------------");
    console.log(`----------${listing}--------------------`);
    console.log("--------------------------------------");
    console.log("--------------------------------------");
    console.log("--------------------------------------");
    console.log("-----------###########-----------------");

}

export { FileHandler};

// const file_name = 'jobs';
// const curr_date = new Date()
// const formatted_date = curr_date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// const formatted_time = curr_date.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric' });
// let excel_file_name = file_name + '_' + formatted_date + '-' + formatted_time + '.xlsx';
// // let excel_file_name = file_name + '_' + formatted_date + '.xlsx';
// let csv_file_name = file_name + '_' + formatted_date + '-' + formatted_time + '.csv';

// // check if the excel file exists add a new a worksheet to it else create a new one
// const workbook = new ExcelJS.Workbook();

// export const writeToExcel = function writeExcelFile(data, listing) {
//     // open an existing workbook from the same folder
//     const worksheet = workbook.addWorksheet(listing);
//     // set the columns for the worksheet
//     worksheet.columns = [
//         { header: 'Company Name', key: 'company_name', width: 20 },
//         { header: 'Job Title', key: 'job_title', width: 50 },
//         { header: 'Link', key: 'job_link', width: 70, style: { font: { color: { argb: 'FF0000FF' } }, }, },
//         // { header: 'Link', key: 'job_link', width: 70 },
//         { header: 'Location', key: 'location', width: 50 },
//         { header: 'Posting Date', key: 'posting_date', width: 50 },
//         { header: 'Job ID', key: 'postion_id', width: 50 },
//     ];

//     // write the data to a csv file with the company name, job title, job link and location
//     const header = ['Company Name', 'Job Title', 'Link', 'Location', 'Posting Date', 'Job ID'];
//     const csvData = [];
//     csvData.push(header);
//     // loop through the data and write to the excel file
//     data.forEach(data => {
//         // make data a hyperlink and add color to it
//         data["job_link"] = {
//             text: data["job_link"],
//             hyperlink: data["job_link"]

//         };
//         worksheet.addRow(data);
//     });
//     excel_file_name = listing + '-' + excel_file_name;
//     const excelFilePath = path.join(process.cwd(), 'app', 'data', listing, excel_file_name);
//     workbook.xlsx.writeFile(excelFilePath).then(() => {
//         console.log('excel file saved-----------:::', listing);
//     }).catch(err => {
//         console.log("error occured while saving file");
//     });

// }

// export const writeToCsv = function writeCsvFile(data, listing) {
//     // loop through the data and write to the csv file
//     try {
//         data.forEach(async data => {
//             csvData.push([data["company_name"], data["job_title"], data["job_link"], data["location"], data["posting_date"]]);
//         });
//         csv_file_name = listing + '-' + csv_file_name;
//         const csvFilePath = path.join(process.cwd(), 'app', 'data', csv_file_name);
//         const csvDataString = csvData.map(row => row.join(',')).join('\n');
//         writeFileSync(csvFilePath, csvDataString);
//         console.log('csv file saved');
//     }
//     catch (error) {
//         console.log("Error in writing to csv file");
//     }
// }


// export const writeToCsvCompanyNames = function writeCsvFile(data, listing) {
//     console.log("inside write csv gh companies clefile");
//     // loop through the data and write to the csv file
//     data.forEach(async data => {
//         csvData.push(data);
//     });
//     csv_file_name = listing + '-' + "companies";
//     const csvFilePath = path.join(process.cwd(), 'app', 'data', csv_file_name);
//     const csvDataString = csvData.map(row => row).join('\n');
//     writeFileSync(csvFilePath, csvDataString);
//     console.log('csv file saved');
// }

