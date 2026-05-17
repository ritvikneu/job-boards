import amqp from 'amqplib';
import { createCustomLogger } from '../middleware/logger.js';

const logger = createCustomLogger('rabbitmq');

let QUEUE_NAME;
const EXCHANGE_NAME = 'boards-exchange';
const ROUTING_KEY   = 'boards';

let connection;
let channel;

// Resolves once the channel is ready for the first time.
// Callers await this before using the channel.
let channelReady;
const channelReadyPromise = new Promise((resolve) => { channelReady = resolve; });

async function setupRabbitMQ() {
    try {
        const url = process.env.RABBITMQ_URL || 'amqp://localhost';
        connection = await amqp.connect(url);
        channel    = await connection.createChannel();

        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });

        channel.on('error', (err) => {
            logger.error(`RabbitMQ channel error: ${err.message}`);
            setTimeout(setupRabbitMQ, 5000);
        });

        channel.on('close', () => {
            logger.warn('RabbitMQ channel closed — reconnecting in 5s');
            channel = null;
            setTimeout(setupRabbitMQ, 5000);
        });

        logger.info('RabbitMQ connection established');
        channelReady();
    } catch (error) {
        logger.error(`RabbitMQ setup failed: ${error.message} — retrying in 5s`);
        setTimeout(setupRabbitMQ, 5000);
    }
}

setupRabbitMQ();

export const producer = async (sublinks, qname) => {
    await channelReadyPromise;
    QUEUE_NAME = qname;
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

    try {
        for (const link of sublinks) {
            await channel.publish(EXCHANGE_NAME, ROUTING_KEY, Buffer.from(JSON.stringify(link)));
        }
        logger.info(`Producer sent ${sublinks.length} messages to ${qname}`);
    } catch (error) {
        logger.error(`Producer error: ${error.message}`);
        throw error;
    }
};

export const getNextMessages = async (batchSize, qname) => {
    await channelReadyPromise;
    try {
        QUEUE_NAME = qname;
        const messages = [];
        for (let i = 0; i < batchSize; i++) {
            const message = await channel.get(QUEUE_NAME, { noAck: false });
            if (!message) break;
            let content;
            try {
                content = JSON.parse(message.content.toString());
            } catch {
                logger.warn('Skipping malformed message from queue');
                channel.ack(message);
                continue;
            }
            messages.push({ content, ack: () => channel.ack(message) });
        }
        return messages;
    } catch (error) {
        logger.error(`getNextMessages error: ${error.message}`);
        return [];
    }
};

export const consusmerBatch = async (batchSize, qname) => {
    await channelReadyPromise;
    try {
        QUEUE_NAME = qname;
        const messages = [];
        for (let i = 0; i < batchSize; i++) {
            const message = await channel.get(QUEUE_NAME, { noAck: false });
            if (!message) break;
            let content;
            try {
                content = JSON.parse(message.content.toString());
            } catch {
                logger.warn('Skipping malformed message from queue');
                channel.ack(message);
                continue;
            }
            messages.push({ content, ack: () => channel.ack(message) });
        }
        return messages;
    } catch (error) {
        logger.error(`consusmerBatch error: ${error.message}`);
        throw error;
    }
};

export const consumer = async (filterFunction, qname) => {
    await channelReadyPromise;
    try {
        QUEUE_NAME = qname;
        await channel.consume(QUEUE_NAME, async (message) => {
            if (message !== null) {
                const { url } = message;
                const shouldProcess = await filterFunction(url);
                if (shouldProcess) logger.info(`Processing link: ${url}`);
                channel.ack(message);
            }
        });
        logger.info('Consumer running and waiting for messages');
    } catch (error) {
        logger.error(`Consumer error: ${error.message}`);
    }
};

export const closeConnection = async (qname) => {
    try {
        if (channel) {
            await channel.deleteQueue(qname);
            await channel.close();
        }
        if (connection) await connection.close();
        logger.info('RabbitMQ connection closed');
    } catch (error) {
        logger.error(`closeConnection error: ${error.message}`);
    }
};
