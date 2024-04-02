const fs = require('fs');

function getCompanies(csvFile) {
    const greenUrl = "https://boards.greenhouse.io/";
    const greenApis = new Set();

    const csvData = fs.readFileSync(csvFile, 'utf8');
    const rows = csvData.split('\n');

    rows.forEach(row => {
        const splitRow = row.split(',');
        if (splitRow.length > 0) {
            const company = splitRow[0].split('/');
            if (company.length > 0) {
                greenApis.add(greenUrl + company[0]);
            }
        }
    });

    return greenApis;
}

const csvFile = 'greenhouse.csv';
const companies = getCompanies(csvFile);
console.log(companies);
