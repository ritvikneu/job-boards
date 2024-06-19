import { filterJob } from './filtering-service.js';
import { readFileSync } from 'fs';
import axios from 'axios';
import jsdom from 'jsdom';
import { writeToCsv, writeToCsvCompanyNames, writeToExcel } from './file_creation-service.js';


class Portal {
    constructor(portalURL, csvFile, portalName) {
        this.portalURL = portalURL;
        this.csvFile = csvFile;
        this.portalName = portalName;
    }

    async getAllCompanies() {
        console.log("inside get all companies");
        const companySet = new Set();
        let companyList = [];
        const csvData = readFileSync(this.csvFile, 'utf8');
        const rows = csvData.split('\n');
        rows.forEach(row => {
            const splitRow = row.split(',');
            if (splitRow.length > 0) {
                const company = splitRow[0].split('/');
                let companyName = company[0].toLowerCase();
                if (company.length > 0) {
                    if (!companySet.has(companyName)) {
                        companySet.add(companyName);
                        companyList.push({
                            name: companyName,
                            link: this.portalURL + companyName
                        });
                    }
                }
            }
        });
        writeToCsvCompanyNames(companySet, this.portalName);
        return companyList;
    }

    async filterPortalJobs() {
        console.log("inside filter Portal jobs");
        const portalList = await this.getPortalJobs();
        const filteredPortalList = [];
        let maxCount = 0;

        const filterPortal = portalList.map(async data => {
            let locationToCheck = data["location"].toLowerCase();
            const locationMatched = await filterJob.matchJobsToChecker(locationToCheck, false, true);

            if (locationMatched) {
                let titleToCheck = data["job_title"].toLowerCase();
                const titleMatched = await filterJob.matchJobsToChecker(titleToCheck, true, false);

                let jobLink = data["job_link"];

                if (titleMatched) {
                    let postingDate = await this.getJobPostingDates(jobLink);
                    data["posting_date"] = postingDate;
                    if (postingDate && await filterJob.postingDateChecker(postingDate)) {
                        return data;
                    }
                }
            }
            return null;
        });

        const results = await Promise.all(filterPortal);
        results.forEach(data => {
            if (data !== null && maxCount < 50) {
                filteredPortalList.push(data);
                maxCount++;
            }
        });
        return filteredPortalList;
    }

    async getFilteredPortalJobs() {
        const jobsList = await this.filterPortalJobs();
        writeToCsv(jobsList, this.portalName);
        writeToExcel(jobsList, this.portalName);
    }

    async getJobPostingDates(jobLink) {
        let response = null;
        try {
            response = await axios.get(jobLink);
            const headers = response.headers;
            const headerSize = JSON.stringify(headers).length;

            if (response.status == 200) {
                const htmlDom = new jsdom.JSDOM(response.data);
                const content = htmlDom.window.document.querySelector('script[type="application/ld+json"]').innerHTML;
                const postingDate = JSON.parse(content).datePosted;
                return postingDate;
            } else {
                console.log(jobLink + " failed ");
            }
        } catch (err) {
            response = null;
        }
    }
}

export default Portal;
