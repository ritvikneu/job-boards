import amqp from 'amqplib';

const QUEUE_NAME = "workday-queue-1";
const EXCHANGE_NAME = "boards-exchange";
const ROUTING_KEY = "boards";

let connection;
let channel;

async function setupRabbitMQ() {
  try {
    connection = await amqp.connect('amqp://guest:guest@localhost:5672');
    channel = await connection.createChannel();
    
    await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
    
    console.log('RabbitMQ connection established successfully');
  } catch (error) {
    console.error('Error setting up RabbitMQ:', error);
    setTimeout(setupRabbitMQ, 5000);
  }
}

setupRabbitMQ();

export const producer = async (sublinks) => {
  try {
    for (const link of sublinks) {
      await channel.publish(EXCHANGE_NAME, ROUTING_KEY, Buffer.from(JSON.stringify(link)));
      setInterval(() => {
    }, 1000);
    }
    console.log(`Sent ${sublinks.length} sublinks to the queue`);
  } catch (error) {
    console.error('Error in producer:', error);
  }
};

export const startConsumer = async (callback) => {
    try {
      await channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
          const messageContent = msg.content.toString();
          await callback(messageContent);
          channel.ack(msg);
        }
      });
      console.log('Consumer is running and waiting for messages');
    } catch (error) {
      console.error('Error in consumer:', error);
      throw error;  // Propagate the error
    }
  };
  export const getNextMessage = async () => {
    try {
      if (!channel) await setupRabbitMQ();
      const message = await channel.get(QUEUE_NAME, { noAck: false });
      if (message) {
        const content = JSON.parse(message.content.toString());
        return { 
          content, 
          ack: () => channel.ack(message) 
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting message:', error);
      throw error;
    }
  };

  export const consusmerBatch = async (batchSize) => {
    try {
      if (!channel) await setupRabbitMQ();
      const messages = [];
      for (let i = 0; i < batchSize; i++) {
        const message = await channel.get(QUEUE_NAME, { noAck: false });
        if (message) {
          const content = JSON.parse(message.content.toString());
          messages.push({ 
            content, 
            ack: () => channel.ack(message) 
          });
        } else {
          break;
        }
      }
      return messages;
    } catch (error) {
      console.error('Error getting messages:', error);
      throw error;
    }
  };

export const consumer = async (filterFunction) => {
  try {
    await channel.consume(QUEUE_NAME, async (message) => {
      if (message !== null) {
        const { url, companyName } = message;
        const shouldProcess = await filterFunction(url);
        
        if (shouldProcess) {
          // Process the link (e.g., scrape data, store in database, etc.)
          console.log(`Processing link: ${url}`);
          // Add your processing logic here
        }
        
        channel.ack(message);
      }
    });
    console.log('Consumer is running and waiting for messages');
  } catch (error) {
    console.error('Error in consumer:', error);
  }
};

export const closeConnection = async () => {
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
      console.log('RabbitMQ connection closed');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  };