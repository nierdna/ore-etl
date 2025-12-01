const amqp = require('amqplib');
require('dotenv').config();

const EXCHANGE = 'activity-events';
const QUEUE = 'activity-consumer-all';
const ROUTING_KEY = 'activity.*'; // Subscribe tất cả activity types

async function startConsumer() {
  let connection;
  let channel;

  try {
    // Connect to RabbitMQ
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    console.log(`Connecting to RabbitMQ: ${rabbitmqUrl.replace(/\/\/.*@/, '//*****@')}`);
    
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    // Handle connection errors
    connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err);
    });

    connection.on('close', () => {
      console.warn('RabbitMQ connection closed');
    });

    // Declare exchange (should already exist, but declare to be safe)
    await channel.assertExchange(EXCHANGE, 'topic', {
      durable: true,
    });

    // Declare queue
    await channel.assertQueue(QUEUE, {
      durable: true,
    });

    // Bind queue to exchange with pattern to receive ALL activity types
    await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
    console.log(`Queue "${QUEUE}" bound to exchange "${EXCHANGE}" with pattern "${ROUTING_KEY}"`);

    // Set prefetch (process max 10 messages concurrently)
    await channel.prefetch(10);

    console.log('✅ Activity consumer started');
    console.log('📡 Waiting for activity events...\n');

    // Consume messages
    await channel.consume(
      QUEUE,
      async (msg) => {
        if (msg) {
          try {
            const event = JSON.parse(msg.content.toString());
            
            // Log received activity
            console.log('📨 Received activity event:');
            console.log(`   Type: ${event.activityType}`);
            console.log(`   Signature: ${event.signature}`);
            console.log(`   Slot: ${event.slot}`);
            console.log(`   Timestamp: ${event.timestamp}`);
            console.log(`   Activity data:`, JSON.stringify(event.activity, null, 2));
            console.log('---\n');

            // TODO: Add your custom processing logic here
            // Example:
            // if (event.activityType === 'deploy') {
            //   await handleDeploy(event);
            // } else if (event.activityType === 'checkpoint') {
            //   await handleCheckpoint(event);
            // }

            // Acknowledge message
            channel.ack(msg);
          } catch (error) {
            console.error('❌ Error processing message:', error);
            console.error('Message content:', msg.content.toString());
            
            // Reject message (don't requeue to avoid infinite loop)
            channel.nack(msg, false, false);
          }
        }
      },
      { noAck: false } // Manual acknowledgment
    );

    // Setup graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      
      if (channel) {
        await channel.close();
      }
      if (connection) {
        await connection.close();
      }
      
      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start consumer:', error);
    
    if (channel) await channel.close();
    if (connection) await connection.close();
    
    process.exit(1);
  }
}

// Start consumer
startConsumer().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

