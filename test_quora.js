import axios from 'axios';
import jsdom from 'jsdom';

async function test() {
    // 1. Get from HTML (ash2)
    const htmlRes = await axios.get('https://jobs.ashbyhq.com/quora');
    const dom = new jsdom.JSDOM(htmlRes.data);
    const script = Array.from(dom.window.document.querySelectorAll('script')).find(s => s.textContent.includes('window.__appData'));
    const match = script.textContent.match(/window\.__appData\s*=\s*({[\s\S]*?});/);
    const appData = JSON.parse(match[1]);
    const htmlJobs = appData.jobBoard.jobPostings;

    // 2. Get from API (ash3)
    const apiRes = await axios.get('https://api.ashbyhq.com/posting-api/job-board/quora');
    const apiJobs = apiRes.data.jobs;

    console.log(`HTML jobs: ${htmlJobs.length}`);
    console.log(`API jobs: ${apiJobs.length}`);

    if (htmlJobs.length > 0 && apiJobs.length > 0) {
        console.log('\nHTML Job 0:');
        console.log(`Title: ${htmlJobs[0].title}`);
        console.log(`UpdatedAt: ${htmlJobs[0].updatedAt}`);
        console.log(`PublishedAt: ${htmlJobs[0].publishedAt}`);

        console.log('\nAPI Job 0 (matching title if possible):');
        const apiJob = apiJobs.find(j => j.title === htmlJobs[0].title) || apiJobs[0];
        console.log(`Title: ${apiJob.title}`);
        console.log(`UpdatedAt: ${apiJob.updatedAt}`);
        console.log(`PublishedAt: ${apiJob.publishedAt}`);
    }
}
test().catch(console.error);
