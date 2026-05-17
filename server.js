import { app } from './app/app.js';
import { initDb, cleanOldJobs } from './app/database/sqlite-service.js';
import { createCustomLogger } from './app/middleware/logger.js';

const logger = createCustomLogger('server');
const port   = 7777;

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason}`);
});

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    process.exit(1);
});

async function main() {
    try {
        // Initialise SQLite — creates jobs.db and table on first run
        initDb();

        // Remove jobs older than 30 days and reclaim freed pages
        cleanOldJobs(30);

        // Start the server
        app.listen(port, () => console.log(`Server is listening at ${port}`));
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main();