import { readFileSync, writeFileSync, existsSync } from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';
import { config } from 'dotenv';
// import { send } from 'process';
import { sendMail, sendMailAttachment } from './mail-service.js';
// import Airtable from 'airtable';
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


        try {
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
                    { header: 'Job ID', key: 'position_id', width: 50 }
                ];
                data.forEach(row => {
                    row["job_title"] = {
                        text: row["job_title"],
                        hyperlink: row["job_link"]
                    };
                    worksheet.addRow(row);
                });
            }
        } catch (error) {
            console.log("Error occurred while writing to Excel file:", error);
        }

        try {
            await this.workbook.xlsx.writeFile(excelFilePath);
            // sendMail(listing, excelFileName + " " + ". Number of jobs: " + data.length);

            console.log('Excel file saved:----------------', listing);
            printSuccessMessage(listing);
            // sendMailAttachment(listing, `Please find the attached Excel file with the job listings`, excelFilePath, excelFileName);
        } catch (err) {
            console.log("Error occurred while saving Excel file:", err);
        }
    }

    getLatestJobs() {
        const excelFileName = `${this.excelFileName}`;
        const excelFilePath = path.join(process.cwd(), 'app', 'data', excelFileName);
        sendMailAttachment('Latest Jobs file', `Please find the attached Excel file with the job listings`, excelFilePath, excelFileName);
    }

    // export the excel file to airtable
    // exportToAirtable(data, listing) {
    //     const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
    //     const base = airtable.base(process.env.AIRTABLE_BASE_ID);
    //     const table = base(listing);
    // }

    writeToCsv(data, listing) {
        const header = ['Company Name', 'Job Title', 'Link', 'Location', 'Posting Date', 'Job ID'];
        this.csvData.push(header);
        

        data.forEach(row => {
            this.csvData.push([row["company_name"], row["job_title"], row["job_link"], row["location"], row["posting_date"], row["position_id"]]);
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

export { FileHandler };