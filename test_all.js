import axios from 'axios';
import jsdom from 'jsdom';
import fs from 'fs';

const ASHBY_BASE_URL = 'https://jobs.ashbyhq.com/';
const ASHBY_API_BASE = 'https://api.ashbyhq.com/posting-api/job-board';

const csvFilePath = 'app/companies/ashbyhq/ash.csv';
const rows = fs.readFileSync(csvFilePath, 'utf8')
    .split('\n')
    .map((row) => row.toLowerCase().trim())
    .filter(Boolean);

const companies = [...new Set(rows)];

async function checkCompany(company) {
    let htmlCount = 0;
    let apiCount = 0;

    // HTML
    try {
        const htmlRes = await axios.get(ASHBY_BASE_URL + company, { timeout: 15000 });
        const dom = new jsdom.JSDOM(htmlRes.data);
        const script = Array.from(dom.window.document.querySelectorAll('script')).find(s => s.textContent.includes('window.__appData'));
        if (script) {
            const match = script.textContent.match(/window\.__appData\s*=\s*({[\s\S]*?});/);
            if (match) {
                const appData = JSON.parse(match[1]);
                if (appData && appData.jobBoard && appData.jobBoard.jobPostings) {
                    htmlCount = appData.jobBoard.jobPostings.length;
                }
            }
        }
    } catch (e) {
        htmlCount = 'Error';
    }

    // API
    try {
        const apiRes = await axios.post(`${ASHBY_API_BASE}/${company}`, {}, { timeout: 15000, headers: { Accept: 'application/json' } });
        if (apiRes.data && apiRes.data.jobs) {
            apiCount = apiRes.data.jobs.length;
        }
    } catch (e) {
        try {
            const apiResGet = await axios.get(`${ASHBY_API_BASE}/${company}`, { timeout: 15000, headers: { Accept: 'application/json' } });
            if (apiResGet.data && apiResGet.data.jobs) {
                apiCount = apiResGet.data.jobs.length;
            }
        } catch (e2) {
            apiCount = 'Error';
        }
    }

    console.log(`Company: ${company.padEnd(20)} | HTML: ${String(htmlCount).padEnd(5)} | API: ${String(apiCount).padEnd(5)}`);
}

async function run() {
    for (const c of companies) {
        await checkCompany(c);
    }
}
run();
