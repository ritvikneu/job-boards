import supertest from 'supertest';
import { app } from '../app/app.js';
import assert from 'assert';

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