import jobsRouter from './jobs-router.js';

const route = (app) => {
    app.use('/get_jobs',jobsRouter);
}
export default route;