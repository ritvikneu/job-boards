import amqp from 'amqplib';

let QUEUE_NAME;
const EXCHANGE_NAME = "boards-exchange";
const ROUTING_KEY = "boards";

let connection;
let channel;

async function setupRabbitMQ() {
  try {
    connection = await amqp.connect('amqp://guest:guest@localhost:5672');
    channel = await connection.createChannel();
    
    await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
    // await channel.assertQueue(QUEUE_NAME, { durable: true });
    // await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
    
    channel.on('error', (err) => {
      console.error('Channel error', err);
      setupRabbitMQ();
    });

    channel.on('close', () => {
      console.log('Channel closed, attempting to reconnect...');
      setupRabbitMQ();
    });
    
    console.log('RabbitMQ connection established successfully');
  } catch (error) {
    console.error('Error setting up RabbitMQ:', error);
    setTimeout(setupRabbitMQ, 5000);
  }
}

setupRabbitMQ();

export const producer = async (sublinks,qname) => {
  // Queue name is qname  
  QUEUE_NAME = qname;
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
  // create a new queue for each company
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


  export const getNextMessages = async (batchSize, qname) => {
    try {
      QUEUE_NAME = qname;
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
      return messages; // This will always be an array, even if empty
    } catch (error) {
      console.error('Error getting messages:', error);
      return []; // Return an empty array in case of error
    }
  };

  export const consusmerBatch = async (batchSize, qname) => {
    try {
      QUEUE_NAME = qname;
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

export const consumer = async (filterFunction, qname) => {
  try {
    QUEUE_NAME = qname;
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

export const closeConnection = async (qname) => {
    try {
      if (channel) await channel.close();
      // delete the queue
      await channel.deleteQueue(qname);
      if (connection) await connection.close();
      console.log('RabbitMQ connection closed');
    } catch (error) {
      console.error('Error closing RabbitMQ connection:', error);
    }
  };