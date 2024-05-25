// import { winston } from 'winston';
import winston from 'winston';

import { createLogger, format, transports } from 'winston';
import { config } from 'dotenv';
config();

export const logger = createLogger({
    level: 'http',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),

        format.json(),
    ),
    // defaultMeta: { service: 'webapp.service' },
    transports: [
        new winston.transports.File({ filename: 'logs/info.log', level: 'info' }),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    ],
});