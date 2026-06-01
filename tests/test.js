import supertest from 'supertest';
import { app } from '../app/app.js';
import assert from 'assert';
import { initDb } from '../app/database/sqlite-service.js';

const request = supertest(app);

describe('Testing our Application', function () {

    it('GET /healthz end point of the application to test sequelize', (done) => {
        supertest(app)
            .get('/health')//check
            .expect(200)
            .end((err, response) => {
                if (err) return done(err)
                return done()
            })
    })

});

describe('Dashboard endpoints', function () {
    before(function () {
        initDb();
    });

    it('GET /jobs returns 200 with an array', async function () {
        const res = await request.get('/jobs');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
    });

    it('PATCH /jobs/status rejects missing fields with 400', async function () {
        const res = await request
            .patch('/jobs/status')
            .send({ job_link: 'http://example.com' }); // no status
        assert.strictEqual(res.status, 400);
    });

    it('PATCH /jobs/status rejects invalid status with 400', async function () {
        const res = await request
            .patch('/jobs/status')
            .send({ job_link: 'http://example.com', status: 'nope' });
        assert.strictEqual(res.status, 400);
    });

    it('PATCH /jobs/status returns 200 for valid status', async function () {
        const res = await request
            .patch('/jobs/status')
            .send({ job_link: 'http://nonexistent.example.com', status: 'interested' });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
    });
});