import { readFileSync } from 'fs';

export const loadCompanies = (fileName, buildLink, logger) => {
    const csvFilePath = `app/companies/${fileName}.csv`;
    logger.info(`Loading companies from: ${csvFilePath}`);
    try {
        const rows = readFileSync(csvFilePath, 'utf8')
            .split('\n')
            .map((row) => row.toLowerCase().trim())
            .filter((row) => row.length > 0 && !row.startsWith('#'));
        const companies = [...new Set(rows)].map((name) => ({
            name,
            link: buildLink(name),
        }));
        logger.info(`Companies loaded: ${companies.length}`);
        return companies;
    } catch (error) {
        logger.error(`Failed to load companies CSV: ${error.message}`);
        throw error;
    }
};
