import { config } from 'dotenv';
import { readFileSync } from 'fs';
config();

class TitleChecker {
    constructor() {
        const jobTitles = process.env.JOB_TITLES.split(",").map(title => title.trim().toLowerCase());
        const ignoreTitles = process.env.IGNORE_TITLES.split(",").map(title => title.trim().toLowerCase());

        //store all the job titles in a map, if the key is present then do not add it again else increment the value with every key
        this.jobTitlesMap = new Map();
        jobTitles.forEach(title => this.jobTitlesMap.set(title, this.jobTitlesMap.has(title) ? this.jobTitlesMap.get(title) + 1 : 1));

        this.ignoreTitlesMap = new Map();
        ignoreTitles.forEach(title => this.ignoreTitlesMap.set(title, this.ignoreTitlesMap.has(title) ? this.ignoreTitlesMap.get(title) + 1 : 1));

    }

    isJobPresentAccept(title) {
        if (this.jobTitlesMap.has(title)) {
            return true;
        }
        return false;
    }

    isJobPresentReject(title) {
        if (this.ignoreTitlesMap.has(title)) {
            return true;
        }
        return false;
    }

}

class LocationChecker {
    constructor() {
        const countries = process.env.COUNTRIES.split(",").map(location => location.trim().toLowerCase());
        this.countriesMap = new Map();
        countries.forEach(location => this.countriesMap.set(location, this.countriesMap.has(location) ? this.countriesMap.get(location) + 1 : 1));

        const states = process.env.STATES.split(",").map(location => location.trim().toLowerCase());
        this.statesMap = new Map();
        states.forEach(location => this.statesMap.set(location, this.statesMap.has(location) ? this.statesMap.get(location) + 1 : 1));

        const statesAbbr = process.env.STATES_ABBR.split(",").map(location => location.trim().toLowerCase());
        this.statesAbbrMap = new Map();
        statesAbbr.forEach(location => this.statesAbbrMap.set(location, this.statesAbbrMap.has(location) ? this.statesAbbrMap.get(location) + 1 : 1));

    }

    isCountryPresent(location) {
        if (this.countriesMap.has(location)) {
            return true;
        }
    }

    async isCountryPresentWorkday(location) {
        if (this.countriesMap.has(location)) {
            return true;
        }
    }



    isStatePresent(location) {
        if (this.statesMap.has(location)) {
            return true;
        }
    }

    isStateAbbrPresent(location) {
        if (this.statesAbbrMap.has(location)) {
            return true;
        }
    }
}
class FilterJobs {

    constructor() {
        this.locationChecker = new LocationChecker();
        this.titleChecker = new TitleChecker();
    }

    async getCombinations(part, r) {
        let result = [];
        this.generateCombinations(part, r, 0, [], result);
        return result;
    }

    async generateCombinations(part, r, index, current, result) {
        if (current.length === r) {
            result.push(current);
            return;
        }
        if (index === part.length) return;
        this.generateCombinations(part, r, index + 1, [...current, part[index]], result);
        this.generateCombinations(part, r, index + 1, current, result);
    }

    async matchJobsToChecker(word, checkTitle = false, checkLocation = false, portal) {
        let wordParts = [];

        wordParts = word.split(' ').map(part => part.trim().toLowerCase());


        const validParts = wordParts
            .filter(part => part)
            .map(part => (part.slice(-1).match(/[a-zA-Z]/) ? part : part.slice(0, -1)));

        for (let r = 0; r <= validParts.length; r++) {
            for (let combo of await this.getCombinations(validParts, r)) {
                let searchWord = combo.join(' ');
                // let searchWordLen = searchWord.length;
                if (checkTitle) {
                    if (this.titleChecker.isJobPresentAccept(searchWord)) {
                        return true;
                    }
                    if (this.titleChecker.isJobPresentReject(searchWord)) {
                        return false;
                    }
                }
                if (checkLocation) {
                    if (this.locationChecker.isCountryPresent(searchWord)) {
                        return true;
                    }
                    if (this.locationChecker.isStatePresent(searchWord)) {
                        return true;
                    }
                    if (this.locationChecker.isStateAbbrPresent(searchWord)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    async postingDateChecker(postingDate) {
        let currDate = new Date();
        // format the current date to the same format as the posting date(YYYY-MM-DD)
        let formatted_date = new Date(postingDate);
        const diffTime = Math.abs(currDate - formatted_date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 10) {
            return true;
        }
        return false;
    }

}

const titleChecker = new TitleChecker();
const locationChecker = new LocationChecker();
const filterJob = new FilterJobs();

export { titleChecker, locationChecker, filterJob };