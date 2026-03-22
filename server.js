import { app } from './app/app.js';
import { initDb } from './app/database/sqlite-service.js';

const port = 7777;

async function main() {
    try {
        // Initialise SQLite — creates jobs.db and table on first run
        initDb();

        // Start the server
        app.listen(port, () => console.log(`Server is listening at ${port}`));
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main();


// app.listen(port,() => console.log(`Server is listening at ${port}`));