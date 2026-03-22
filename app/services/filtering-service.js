import { config } from 'dotenv';
config();

/**
 * Optimized TitleChecker using Sets for O(1) lookups
 * Implements simple substring matching without expensive combination generation
 */
class TitleChecker {
    constructor(config = {}) {
        const jobTitles = config.job_titles
            ?? process.env.JOB_TITLES.split(",").map(t => t.trim().toLowerCase());
        const ignoreTitles = config.ignore_titles
            ?? process.env.IGNORE_TITLES.split(",").map(t => t.trim().toLowerCase());

        this.jobTitlesSet = new Set(jobTitles);
        this.ignoreTitlesSet = new Set(ignoreTitles);
    }

    /**
     * Fast title matching using word boundary checks
     * @param {string} title - Job title to check
     * @returns {boolean} - True if title matches acceptance criteria
     */
    matchesAcceptedTitle(title) {
        const lowerTitle = title.toLowerCase();
        
        // Check for exact match first (fastest path)
        if (this.jobTitlesSet.has(lowerTitle)) {
            return true;
        }

        // Check if any accepted keyword appears as a whole word in the title
        for (const keyword of this.jobTitlesSet) {
            if (this.containsWord(lowerTitle, keyword)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Fast title rejection using word boundary checks
     * @param {string} title - Job title to check
     * @returns {boolean} - True if title should be rejected
     */
    matchesRejectedTitle(title) {
        const lowerTitle = title.toLowerCase();
        
        // Check for exact match first
        if (this.ignoreTitlesSet.has(lowerTitle)) {
            return true;
        }

        // Check if any ignored keyword appears as a whole word in the title
        for (const keyword of this.ignoreTitlesSet) {
            if (this.containsWord(lowerTitle, keyword)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Check if a word exists in text with word boundaries
     * @param {string} text - Text to search in
     * @param {string} word - Word to search for
     * @returns {boolean}
     */
    containsWord(text, word) {
        // Use word boundary regex for accurate matching
        // \b ensures we match whole words only
        const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
        return regex.test(text);
    }

    /**
     * Escape special regex characters
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Optimized LocationChecker using Sets for O(1) lookups
 */
class LocationChecker {
    constructor(config = {}) {
        const countries = config.countries
            ?? process.env.COUNTRIES.split(",").map(l => l.trim().toLowerCase());
        const states = config.states
            ?? process.env.STATES.split(",").map(l => l.trim().toLowerCase());
        const statesAbbr = config.states_abbr
            ?? process.env.STATES_ABBR.split(",").map(l => l.trim().toLowerCase());

        this.countriesSet = new Set(countries);
        this.statesSet = new Set(states);
        this.statesAbbrSet = new Set(statesAbbr);
    }

    /**
     * Fast location matching using word boundary checks
     * @param {string} location - Location string to check
     * @returns {boolean} - True if location matches US/Canada criteria
     */
    matchesLocation(location) {
        const lowerLocation = location.toLowerCase();
        
        // Check exact matches first (fastest)
        if (this.countriesSet.has(lowerLocation) || 
            this.statesSet.has(lowerLocation) || 
            this.statesAbbrSet.has(lowerLocation)) {
            return true;
        }

        // Check if location contains any valid country
        for (const country of this.countriesSet) {
            if (this.containsWord(lowerLocation, country)) {
                return true;
            }
        }

        // Check if location contains any valid state
        for (const state of this.statesSet) {
            if (this.containsWord(lowerLocation, state)) {
                return true;
            }
        }

        // Check for state abbreviations with word boundaries
        for (const abbr of this.statesAbbrSet) {
            if (this.containsWord(lowerLocation, abbr)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Check if a word exists in text with word boundaries
     */
    containsWord(text, word) {
        const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
        return regex.test(text);
    }

    /**
     * Escape special regex characters
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * Optimized FilterJobs - simplified interface without expensive combination generation
 */
class FilterJobs {
    constructor(config = {}) {
        this.locationChecker = new LocationChecker(config);
        this.titleChecker = new TitleChecker(config);
        this.postingDiff = config.posting_diff ?? parseInt(process.env.POSTING_DIFF || 10);
    }

    /**
     * Check if job title passes filters
     * @param {string} title - Job title to check
     * @returns {boolean} - True if title is valid
     */
    matchesTitle(title) {
        if (!title || typeof title !== 'string') {
            return false;
        }

        // First check if title should be rejected
        if (this.titleChecker.matchesRejectedTitle(title)) {
            return false;
        }

        // Then check if title is accepted
        return this.titleChecker.matchesAcceptedTitle(title);
    }

    /**
     * Check if job location passes filters
     * @param {string} location - Job location to check
     * @returns {boolean} - True if location is valid
     */
    matchesLocation(location) {
        if (!location || typeof location !== 'string') {
            return false;
        }

        return this.locationChecker.matchesLocation(location);
    }

    /**
     * Check if posting date is within acceptable range
     * @param {string} postingDate - Date string to check
     * @returns {boolean} - True if within POSTING_DIFF days
     */
    matchesPostingDate(postingDate) {
        if (!postingDate) {
            return false;
        }

        try {
            const currDate = new Date();
            const postedDate = new Date(postingDate);
            
            // Check if date is valid
            if (isNaN(postedDate.getTime())) {
                return false;
            }

            const diffTime = Math.abs(currDate - postedDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            return diffDays <= this.postingDiff;
        } catch (error) {
            console.error('Error checking posting date:', error.message);
            return false;
        }
    }

    /**
     * Check if job passes all filters
     * @param {Object} job - Job object with title, location, posting_date
     * @returns {boolean} - True if job passes all filters
     */
    matchesAllCriteria(job) {
        if (!job) {
            return false;
        }

        // Check posting date first (fastest rejection)
        if (job.posting_date && !this.matchesPostingDate(job.posting_date)) {
            return false;
        }

        // Check location
        if (!this.matchesLocation(job.location)) {
            return false;
        }

        // Check title last (might be most selective)
        if (!this.matchesTitle(job.job_title)) {
            return false;
        }

        return true;
    }
}

export { TitleChecker, LocationChecker, FilterJobs };
