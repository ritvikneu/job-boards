import winston from 'winston';
import { createLogger, format, transports } from 'winston';
import { config } from 'dotenv';
config();

export const createCustomLogger = (file_name) => {
  return createLogger({
    level: 'http',
    format: format.combine(
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      format.json(),
    ),
    transports: [
      new winston.transports.File({ filename: `logs/${file_name}_info.log`, level: 'info' }),
      new winston.transports.File({ filename: `logs/${file_name}_error.log`, level: 'error' }),
    ],
  });
};

// Export a default logger for backward compatibility
export const logger = createCustomLogger('default');