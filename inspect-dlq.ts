import amqp from 'amqplib';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

interface MessageInfo {
  signature: string;
  slot: number;
  blockTime: number;
  error?: string;
  retryCount?: number;
  timestamp?: number;
  rawContent: string;
}

async function inspectDLQ() {
  const rabbitmqUrl = process.env.RABBITMQ_URL;
  if (!rabbitmqUrl) {
    console.error('❌ RABBITMQ_URL environment variable is required');
    process.exit(1);
  }

  const DLQ = 'transaction-etl-dlq';
  const limit = parseInt(process.env.LIMIT || '10', 10);
  const saveToFile = process.env.SAVE === 'true';

  console.log('🔍 Inspecting Dead Letter Queue...');
  console.log(`   Queue: ${DLQ}`);
  console.log(`   Limit: ${limit} messages`);
  console.log(`   RabbitMQ: ${rabbitmqUrl.replace(/\/\/.*@/, '//*****@')}\n`);

  let connection: amqp.ChannelModel | null = null;
  let channel: amqp.Channel | null = null;

  try {
    // Connect to RabbitMQ
    console.log('📡 Connecting to RabbitMQ...');
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    // Check queue info first
    const queueInfo = await channel.checkQueue(DLQ);
    console.log(`\n📊 Queue Status:`);
    console.log(`   Total messages: ${queueInfo.messageCount.toLocaleString()}`);
    console.log(`   Consumers: ${queueInfo.consumerCount}`);
    console.log(`   Ready: ${queueInfo.messageCount} messages\n`);

    if (queueInfo.messageCount === 0) {
      console.log('✅ DLQ is empty!');
      return;
    }

    const messages: MessageInfo[] = [];
    const actualLimit = Math.min(limit, queueInfo.messageCount);

    console.log(`📥 Fetching ${actualLimit} messages...\n`);

    // Get messages (without ack to keep them in queue)
    for (let i = 0; i < actualLimit; i++) {
      const msg = await channel.get(DLQ, { noAck: false });

      if (!msg) {
        console.log(`⚠️  No more messages available (got ${i} messages)`);
        break;
      }

      try {
        const content = msg.content.toString();
        const payload = JSON.parse(content);

        const messageInfo: MessageInfo = {
          signature: payload.signature || 'unknown',
          slot: payload.slot || 0,
          blockTime: payload.blockTime || 0,
          rawContent: content,
        };

        // Extract retry count if available
        if (msg.properties.headers?.['x-retry-count']) {
          messageInfo.retryCount = msg.properties.headers['x-retry-count'];
        }

        // Extract timestamp
        if (msg.properties.timestamp) {
          messageInfo.timestamp = msg.properties.timestamp;
        }

        // Try to extract error info from message if available
        if (payload.err) {
          messageInfo.error = JSON.stringify(payload.err);
        }

        messages.push(messageInfo);

        // Display message
        console.log(`\n📨 Message ${i + 1}/${actualLimit}:`);
        console.log(`   Signature: ${messageInfo.signature}`);
        console.log(`   Slot: ${messageInfo.slot}`);
        console.log(`   Block Time: ${new Date(messageInfo.blockTime * 1000).toISOString()}`);
        if (messageInfo.retryCount !== undefined) {
          console.log(`   Retry Count: ${messageInfo.retryCount}`);
        }
        if (messageInfo.error) {
          console.log(`   Error: ${messageInfo.error.substring(0, 200)}...`);
        }
        console.log(`   Timestamp: ${messageInfo.timestamp ? new Date(messageInfo.timestamp).toISOString() : 'N/A'}`);

        // Show sample of parsed data
        if (payload.parsedData) {
          console.log(`   Has Parsed Data: Yes`);
          const parsedDataKeys = Object.keys(payload.parsedData);
          console.log(`   Parsed Data Keys: ${parsedDataKeys.join(', ')}`);
        }

        // Nack to requeue (keep message in DLQ)
        channel.nack(msg, false, true);
      } catch (error) {
        console.error(`❌ Error parsing message ${i + 1}:`, error);
        // Still nack to requeue
        if (msg && channel) {
          channel.nack(msg, false, true);
        }
      }
    }

    // Summary
    console.log(`\n\n📈 Summary:`);
    console.log(`   Messages inspected: ${messages.length}`);
    console.log(`   Remaining in DLQ: ${(queueInfo.messageCount - messages.length).toLocaleString()}`);

    // Analyze patterns
    if (messages.length > 0) {
      const signatures = messages.map(m => m.signature);
      const uniqueSignatures = new Set(signatures);
      console.log(`   Unique signatures: ${uniqueSignatures.size}/${messages.length}`);

      const retryCounts = messages
        .map(m => m.retryCount ?? 0)
        .filter(c => c > 0);
      if (retryCounts.length > 0) {
        const avgRetries = retryCounts.reduce((a, b) => a + b, 0) / retryCounts.length;
        console.log(`   Average retry count: ${avgRetries.toFixed(1)}`);
      }

      const slots = messages.map(m => m.slot);
      if (slots.length > 0) {
        const minSlot = Math.min(...slots);
        const maxSlot = Math.max(...slots);
        console.log(`   Slot range: ${minSlot} - ${maxSlot}`);
      }
    }

    // Save to file if requested
    if (saveToFile && messages.length > 0) {
      const outputDir = path.join(process.cwd(), 'dlq-inspection');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = path.join(outputDir, `dlq-messages-${timestamp}.json`);

      const output = {
        inspectedAt: new Date().toISOString(),
        totalMessages: queueInfo.messageCount,
        inspectedCount: messages.length,
        messages: messages.map(m => ({
          signature: m.signature,
          slot: m.slot,
          blockTime: m.blockTime,
          retryCount: m.retryCount,
          timestamp: m.timestamp,
          error: m.error,
          content: JSON.parse(m.rawContent),
        })),
      };

      fs.writeFileSync(filename, JSON.stringify(output, null, 2));
      console.log(`\n💾 Saved to: ${filename}`);
    }

    console.log('\n✅ Inspection complete!');
  } catch (error) {
    console.error('❌ Error inspecting DLQ:', error);
    process.exit(1);
  } finally {
    try {
      if (channel) {
        await channel.close();
      }
      if (connection) {
        await connection.close();
      }
    } catch (error) {
      console.error('Error closing connection:', error);
    }
  }
}

// Run inspection
inspectDLQ().catch(console.error);

