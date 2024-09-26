// StatsD middleware for logging metrics to StatsD
import StatsD from 'node-statsd';
const statsd = new StatsD();

export const statsD = (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        statsd.timing('request.duration', duration);
    });

    next();
};