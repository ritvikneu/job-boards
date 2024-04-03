// const fs = require('fs');

import { readFileSync } from 'fs';

export const companies_list = function getCompanies() {

    const greenUrl = "https://boards.greenhouse.io/";
    const greenApis = new Set();

    const csvFile = 'app/services/greenhouse.csv';
    
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
            }
        }
    });

    return greenApis;
}

// const csvFile = 'greenhouse.csv';
// const companies = getCompanies(csvFile);
// console.log(companies);
