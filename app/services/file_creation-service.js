import { readFileSync, writeFileSync } from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';


const file_name = 'jobs';
const curr_date = new Date()
const formatted_date = curr_date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const excel_file_name = file_name + '_' + formatted_date + '.xlsx';
const csv_file_name = file_name + '_' + formatted_date + '.csv';



const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet('Sheet1');

// set the columns for the worksheet
worksheet.columns = [
    { header: 'Company Name', key: 'company_name', width: 20 },
    { header: 'Job Title', key: 'job_title', width: 50 },
    { header: 'Link', key: 'job_link', width: 70 },
    { header: 'Location', key: 'location', width: 50 },
];

// write the data to a csv file with the company name, job title, job link and location
const header = ['Company Name', 'Job Title', 'Link', 'Location'];
const csvData = [];
csvData.push(header);

export const writeToExcel = function writeExcelFile(data) {
    // loop through the data and write to the excel file
    data.forEach(data => {
        worksheet.addRow(data);
    });

    const excelFilePath = path.join(process.cwd(), 'app', 'data', excel_file_name);
    workbook.xlsx.writeFile(excelFilePath).then(() => {
        console.log('excel file saved');
    }).catch(err => {
        console.log("error occured while saving file");
    });


}

export const writeToCsv = function writeCsvFile(data) {
    // loop through the data and write to the csv file
    data.forEach(data => {
        csvData.push([data["company_name"], data["job_title"], data["job_link"], data["location"]]);
    });
    const csvFilePath = path.join(process.cwd(), 'app', 'data', csv_file_name);
    const csvDataString = csvData.map(row => row.join(',')).join('\n');
    writeFileSync(csvFilePath, csvDataString);
    console.log('csv file saved');
}



