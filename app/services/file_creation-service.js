import { writeFileSync, existsSync } from 'fs';
import ExcelJS from 'exceljs';
import path from 'path';
import { config } from 'dotenv';
import { sendMailAttachment } from './mail-service.js';
import { createCustomLogger } from '../middleware/logger.js';
config();

const logger = createCustomLogger('file_creation');


class FileHandler {
    constructor() {
        this.currDate      = new Date();
        this.formattedDate = this.currDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        this.formattedTime = this.currDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric' });
        this.excelFileName = `Jobs_${this.formattedDate}.xlsx`;
        this.csvFileName   = `_${this.formattedDate}-${this.formattedTime}.csv`;
        this.workbook      = new ExcelJS.Workbook();
        this.csvData       = [];
    }

    async writeToExcel(data, listing) {
        const excelFilePath = path.join(process.cwd(), 'app', 'data', this.excelFileName);

        try {
            if (existsSync(excelFilePath)) {
                await this.workbook.xlsx.readFile(excelFilePath);
            }

            let worksheet = this.workbook.getWorksheet(listing);
            if (!worksheet) {
                worksheet = this.workbook.addWorksheet(listing);
                worksheet.columns = [
                    { header: 'Company Name', key: 'company_name',  width: 20 },
                    { header: 'Job Info',      key: 'job_title',     width: 70, style: { font: { color: { argb: 'FF0000FF' } } } },
                    { header: 'Location',      key: 'location',      width: 50 },
                    { header: 'Posting Date',  key: 'posting_date',  width: 50 },
                    { header: 'Job ID',        key: 'position_id',   width: 50 },
                ];
                data.forEach(row => {
                    row['job_title'] = { text: row['job_title'], hyperlink: row['job_link'] };
                    worksheet.addRow(row);
                });
            }
        } catch (error) {
            logger.error(`Error reading existing Excel file: ${error.message}`);
        }

        try {
            await this.workbook.xlsx.writeFile(excelFilePath);
            logger.info(`Excel file saved: ${listing} (${data.length} jobs)`);
        } catch (err) {
            logger.error(`Error saving Excel file: ${err.message}`);
        }
    }

    getLatestJobs() {
        const excelFilePath = path.join(process.cwd(), 'app', 'data', this.excelFileName);
        sendMailAttachment(
            'Latest Jobs',
            'Please find the attached Excel file with the job listings',
            excelFilePath,
            this.excelFileName,
        );
    }

    writeToCsv(data, listing) {
        const header = ['Company Name', 'Job Title', 'Link', 'Location', 'Posting Date', 'Job ID'];
        this.csvData.push(header);

        data.forEach(row => {
            this.csvData.push([row['company_name'], row['job_title'], row['job_link'], row['location'], row['posting_date'], row['position_id']]);
        });

        const csvFileName   = `${listing}-${this.csvFileName}`;
        const csvFilePath   = path.join(process.cwd(), 'app', 'data', csvFileName);
        const csvDataString = this.csvData.map(row => row.join(',')).join('\n');

        try {
            writeFileSync(csvFilePath, csvDataString);
            logger.info(`CSV saved: ${listing}`);
        } catch (error) {
            logger.error(`Error saving CSV: ${error.message}`);
        }
    }

    writeToCsvCompanyNames(data, listing) {
        data.forEach(row => this.csvData.push(row));

        const csvFileName   = `${listing}-companies.csv`;
        const csvFilePath   = path.join(process.cwd(), 'app', 'data', csvFileName);
        const csvDataString = this.csvData.join('\n');

        try {
            writeFileSync(csvFilePath, csvDataString);
            logger.info(`Company names CSV saved: ${listing}`);
        } catch (error) {
            logger.error(`Error saving company names CSV: ${error.message}`);
        }
    }
}

export { FileHandler };
