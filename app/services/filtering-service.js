import { config } from 'dotenv';
config();

// ─── Module-level env var cache ───────────────────────────────────────────────
// Parse environment variables once at module load instead of on every request.
// NOTE: these are frozen for the life of the process. Editing .env on a running
// server has no effect until the process is restarted.
const ENV_JOB_TITLES    = process.env.JOB_TITLES    ? process.env.JOB_TITLES.split(",").map(t => t.trim().toLowerCase())    : [];
const ENV_IGNORE_TITLES = process.env.IGNORE_TITLES ? process.env.IGNORE_TITLES.split(",").map(t => t.trim().toLowerCase()) : [];

// 'remote' is a work-mode, not a US locator — must never match as a country/state.
// Stripped here so a stray entry in .env can't reintroduce the non-US-remote leak.
const REMOTE_TOKENS = new Set(['remote', 'remote work', 'fully remote']);
const parseLocations = (raw) => raw ? raw.split(",").map(l => l.trim().toLowerCase()).filter(l => l && !REMOTE_TOKENS.has(l)) : [];

const ENV_COUNTRIES     = parseLocations(process.env.COUNTRIES);
const ENV_STATES        = parseLocations(process.env.STATES);
const ENV_STATES_ABBR   = parseLocations(process.env.STATES_ABBR);

// ─── Module-level regex cache ─────────────────────────────────────────────────
// Compiled regexes are stored here and reused across all class instances.
// Key: the escaped keyword string. Value: compiled RegExp.
const regexCache = new Map();

/**
 * Escapes special regex characters in a string.
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Returns a cached word-boundary RegExp for the given keyword.
 * Compiles it once and stores it in the module-level cache.
 */
const getWordRegex = (word) => {
    if (regexCache.has(word)) return regexCache.get(word);
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
    regexCache.set(word, re);
    return re;
};

/**
 * Optimized TitleChecker using Sets for O(1) lookups
 * Implements simple substring matching without expensive combination generation
 */
class TitleChecker {
    constructor(config = {}) {
        const jobTitles    = config.job_titles    ?? ENV_JOB_TITLES;
        const ignoreTitles = config.ignore_titles ?? ENV_IGNORE_TITLES;

        this.jobTitlesSet    = new Set(jobTitles);
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
        if (this.jobTitlesSet.has(lowerTitle)) return true;

        // Check if any accepted keyword appears as a whole word in the title
        for (const keyword of this.jobTitlesSet) {
            if (getWordRegex(keyword).test(lowerTitle)) return true;
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
        if (this.ignoreTitlesSet.has(lowerTitle)) return true;

        // Check if any ignored keyword appears as a whole word in the title
        for (const keyword of this.ignoreTitlesSet) {
            if (getWordRegex(keyword).test(lowerTitle)) return true;
        }

        return false;
    }
}

/**
 * Optimized LocationChecker using Sets for O(1) lookups
 */
class LocationChecker {
    constructor(config = {}) {
        const countries  = config.countries   ?? ENV_COUNTRIES;
        const states     = config.states      ?? ENV_STATES;
        const statesAbbr = config.states_abbr ?? ENV_STATES_ABBR;

        this.countriesSet  = new Set(countries);
        this.statesSet     = new Set(states);
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

        for (const country of this.countriesSet) {
            if (getWordRegex(country).test(lowerLocation)) return true;
        }

        for (const state of this.statesSet) {
            if (getWordRegex(state).test(lowerLocation)) return true;
        }

        for (const abbr of this.statesAbbrSet) {
            if (getWordRegex(abbr).test(lowerLocation)) return true;
        }

        return false;
    }
}

/**
 * Optimized FilterJobs - simplified interface without expensive combination generation
 */
class FilterJobs {
    constructor(config = {}) {
        this.locationChecker = new LocationChecker(config);
        this.titleChecker    = new TitleChecker(config);
        this.postingDiff     = config.posting_diff ?? parseInt(process.env.POSTING_DIFF || 10);
    }

    /**
     * Check if job title passes filters
     * @param {string} title - Job title to check
     * @returns {boolean} - True if title is valid
     */
    matchesTitle(title) {
        if (!title || typeof title !== 'string') return false;
        if (this.titleChecker.matchesRejectedTitle(title)) return false;
        return this.titleChecker.matchesAcceptedTitle(title);
    }

    /**
     * Check if job location passes filters
     * @param {string} location - Job location to check
     * @returns {boolean} - True if location is valid
     */
    matchesLocation(location) {
        if (!location || typeof location !== 'string') return false;
        return this.locationChecker.matchesLocation(location);
    }

    /**
     * Check if posting date is within acceptable range
     * @param {string} postingDate - Date string to check
     * @returns {boolean} - True if within POSTING_DIFF days
     */
    matchesPostingDate(postingDate) {
        if (!postingDate) return false;
        try {
            const postedDate = new Date(postingDate);
            if (isNaN(postedDate.getTime())) return false;
            const diffDays = Math.ceil(Math.abs(new Date() - postedDate) / (1000 * 60 * 60 * 24));
            return diffDays <= this.postingDiff;
        } catch {
            return false;
        }
    }

    /**
     * Check if job passes all filters
     * @param {Object} job - Job object with title, location, posting_date
     * @returns {boolean} - True if job passes all filters
     */
    matchesAllCriteria(job) {
        if (!job) return false;
        if (job.posting_date && !this.matchesPostingDate(job.posting_date)) return false;
        if (!this.matchesLocation(job.location)) return false;
        if (!this.matchesTitle(job.job_title)) return false;
        return true;
    }
}

export { TitleChecker, LocationChecker, FilterJobs };
