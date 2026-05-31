import { readFileSync, existsSync } from 'fs';
import path from 'path';

const PROFILES_DIR     = path.join(process.cwd(), 'app', 'config', 'profiles');
const PROFILE_NAME_RE  = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Loads a named filter profile from app/config/profiles/<name>.json.
 * Throws if the profile name is invalid or the file does not exist.
 */
const loadProfile = (profileName) => {
    if (!PROFILE_NAME_RE.test(profileName)) {
        throw new Error(`Invalid profile name: "${profileName}"`);
    }
    const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
    if (!existsSync(filePath)) {
        throw new Error(`Filter profile "${profileName}" not found in ${PROFILES_DIR}`);
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
};

/**
 * Resolves a FilterJobs-compatible config object from a request body.
 *
 * Resolution order (highest → lowest priority):
 *   1. body.filters  — inline overrides (individual fields)
 *   2. body.profile  — named profile loaded from profiles/<name>.json
 *   3. (empty)       — FilterJobs falls back to process.env for any missing key
 *
 * Example request body:
 *   { "profile": "swe-us", "filters": { "posting_diff": 3 } }
 *
 * Returns a plain config object (may be empty if neither is provided).
 */
export const resolveFilterConfig = (body = {}) => {
    let config = {};

    if (body.profile) {
        config = loadProfile(body.profile);
    }

    if (body.filters) {
        config = { ...config, ...body.filters };
    }

    return config;
};
