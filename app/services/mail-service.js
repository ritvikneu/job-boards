import { MailtrapClient } from "mailtrap";
import { readFileSync } from "fs";
import path from "path";
import { config } from "dotenv";
import { createCustomLogger } from '../middleware/logger.js';
config();

const logger = createCustomLogger('mail');

const TOKEN = process.env.MAILTRAP_TOKEN;
const ENDPOINT = "https://send.api.mailtrap.io/";

if (!process.env.EMAIL_RECIPIENT) {
    logger.warn('[mail-service] WARNING: EMAIL_RECIPIENT is not set. Email sending will fail.');
}

const RECIPIENT_EMAIL = process.env.EMAIL_RECIPIENT;

const SENDER = {
    email: process.env.MAIL_FROM_EMAIL || 'mailtrap@demomailtrap.com',
    name:  process.env.MAIL_FROM_NAME  || 'Job Alerts',
};

// ─── Path traversal guard ─────────────────────────────────────────────────────

const ALLOWED_ATTACHMENT_DIR = path.resolve(process.cwd(), 'app', 'data');

const safeReadFile = (filePath) => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(ALLOWED_ATTACHMENT_DIR)) {
        throw new Error(`Attachment path is outside the allowed directory: ${filePath}`);
    }
    return readFileSync(resolved);
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const sendMailAttachment = async (subject, content, filePath, fileName) => {
    const client = new MailtrapClient({ endpoint: ENDPOINT, token: TOKEN });
    const recipients = [{ email: RECIPIENT_EMAIL }];
    const fileContent = safeReadFile(filePath);
    const attachment = {
        filename: fileName,
        content: fileContent.toString("base64"),
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        disposition: "attachment",
    };

    try {
        const response = await client.send({
            from: SENDER,
            to: recipients,
            subject,
            text: content,
            category: "Integration Test",
            attachments: [attachment],
        });
        logger.info(`Email sent: ${subject}`, { messageId: response?.messageId });
    } catch (error) {
        logger.error(`Failed to send email: ${error.message}`);
        throw error;
    }
};

export const sendMail = async (subject, content) => {
    const client = new MailtrapClient({ endpoint: ENDPOINT, token: TOKEN });
    const recipients = [{ email: RECIPIENT_EMAIL }];

    try {
        await client.send({
            from: SENDER,
            to: recipients,
            subject,
            text: content,
            category: "Integration Test",
        });
        logger.info(`Email sent: ${subject}`);
    } catch (e) {
        logger.error(`Failed to send email: ${e.message}`);
        throw e;
    }
};
