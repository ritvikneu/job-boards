import axios from 'axios';
import fs from 'fs';

const ASHBY_API_BASE = 'https://api.ashbyhq.com/posting-api/job-board'\;
const rows = fs.readFileSync('app/companies/ashbyhq/ash.csv', 'utf8').split('\n').map(r => r.toLowerCase().trim()).filter(Boolean);

async function run() {
    for (const c of [...new Set(rows)]) {
        let postSuccess = false, getSuccess = false;
        try {
            await axios.post(`${ASHBY_API_BASE}/${c}`, {}, { timeout: 5000 });
            postSuccess = true;
        } catch(e) {}
        try {
            await axios.get(`${ASHBY_API_BASE}/${c}`, { timeout: 5000 });
            getSuccess = true;
        } catch(e) {}
        if (postSuccess !== getSuccess) {
            console.log(`${c} - POST: ${postSuccess}, GET: ${getSuccess}`);
        }
    }
}
run();
