import winston from 'winston';
import { createLogger, format } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from 'dotenv';
config();

// ─── Sensitive data redaction ─────────────────────────────────────────────────

const SENSITIVE_KEYS = /token|key|secret|password|authorization|auth/i;

const redactSensitive = format((info) => {
    const redact = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        for (const key of Object.keys(obj)) {
            if (SENSITIVE_KEYS.test(key)) {
                obj[key] = '[REDACTED]';
            } else if (typeof obj[key] === 'object') {
                redact(obj[key]);
            }
        }
        return obj;
    };
    return redact({ ...info });
});

// ─── Logger factory ───────────────────────────────────────────────────────────

/**
 * Creates a named Winston logger with:
 * - Daily log rotation (14-day retention, gzip compression)
 * - Sensitive field redaction before writing
 * - Separate info and error log files
 */
export const createCustomLogger = (file_name) => {
    return createLogger({
        level: 'http',
        format: format.combine(
            redactSensitive(),
            format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format.json(),
        ),
        transports: [
            new winston.transports.Console({
                level: 'http',
                format: format.combine(
                    format.colorize(),
                    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                    format.printf(({ timestamp, level, message }) => {
                        return `${timestamp} [${file_name}] ${level}: ${message}`;
                    }),
                ),
            }),
            new DailyRotateFile({
                filename: `logs/${file_name}_info-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                level: 'info',
                maxFiles: 14,
                zippedArchive: true,
                auditFile: `logs/.${file_name}_info-audit.json`,
            }),
            new DailyRotateFile({
                filename: `logs/${file_name}_error-%DATE%.log`,
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                maxFiles: 14,
                zippedArchive: true,
                auditFile: `logs/.${file_name}_error-audit.json`,
            }),
        ],
    });
};

// Export a default logger for backward compatibility
export const logger = createCustomLogger('default');
