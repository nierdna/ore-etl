import amqp from 'amqplib';
import dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

async function purgeQueue() {
  const rabbitmqUrl = process.env.RABBITMQ_URL;
  if (!rabbitmqUrl) {
    console.error('❌ RABBITMQ_URL environment variable is required');
    process.exit(1);
  }

  // Get queue name from command line or environment
  const queueName = process.argv[2] || process.env.QUEUE_NAME;
  if (!queueName) {
    console.error('❌ Queue name is required');
    console.error('Usage: ts-node purge-queue.ts <queue-name>');
    console.error('   or: QUEUE_NAME=<queue-name> npm run purge:queue');
    process.exit(1);
  }

  const backupFirst = process.env.BACKUP !== 'false'; // Default: backup first

  console.log('🗑️  Purge Queue');
  console.log(`   Queue: ${queueName}`);
  console.log(`   Backup first: ${backupFirst}\n`);

  let connection: amqp.ChannelModel | null = null;
  let channel: amqp.Channel | null = null;

  try {
    // Connect to RabbitMQ
    console.log('📡 Connecting to RabbitMQ...');
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    // Check queue info
    const queueInfo = await channel.checkQueue(queueName);
    console.log(`\n📊 Current Queue Status:`);
    console.log(`   Total messages: ${queueInfo.messageCount.toLocaleString()}`);
    console.log(`   Consumers: ${queueInfo.consumerCount}\n`);

    if (queueInfo.messageCount === 0) {
      console.log(`✅ Queue "${queueName}" is already empty!`);
      return;
    }

    // Safety confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `⚠️  WARNING: This will DELETE ${queueInfo.messageCount.toLocaleString()} messages from "${queueName}"!\n` +
        `   Are you sure you want to proceed? (yes/no): `,
        resolve
      );
    });

    rl.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Purge cancelled.');
      return;
    }

    // Backup sample if requested
    if (backupFirst) {
      console.log('\n📦 Backing up sample messages...');
      const sampleSize = Math.min(100, queueInfo.messageCount);
      const samples: any[] = [];

      for (let i = 0; i < sampleSize; i++) {
        const msg = await channel.get(queueName, { noAck: false });
        if (!msg) break;

        try {
          const content = msg.content.toString();
          const payload = JSON.parse(content);
          samples.push({
            signature: payload.signature,
            slot: payload.slot,
            blockTime: payload.blockTime,
            timestamp: msg.properties.timestamp,
            retryCount: msg.properties.headers?.['x-retry-count'],
          });
        } catch (error) {
          // If not JSON, just save raw content preview
          // samples.push({
          //   rawContent: content.substring(0, 200),
          //   timestamp: msg.properties.timestamp,
          // });
        }

        // Nack to requeue
        channel.nack(msg, false, true);
      }

      if (samples.length > 0) {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(process.cwd(), 'queue-backup');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeQueueName = queueName.replace(/[^a-zA-Z0-9]/g, '_');
        const backupFile = path.join(backupDir, `${safeQueueName}-backup-${timestamp}.json`);
        fs.writeFileSync(
          backupFile,
          JSON.stringify(
            {
              backedUpAt: new Date().toISOString(),
              queueName,
              totalMessages: queueInfo.messageCount,
              sampleSize: samples.length,
              samples,
            },
            null,
            2
          )
        );
        console.log(`✅ Sample backed up to: ${backupFile}`);
      }
    }

    // Purge queue
    console.log(`\n🗑️  Purging queue "${queueName}"...`);
    const purgeResult = await channel.purgeQueue(queueName);
    console.log(`✅ Purged ${purgeResult.messageCount.toLocaleString()} messages`);

    // Verify
    const verifyInfo = await channel.checkQueue(queueName);
    console.log(`\n✅ Verification:`);
    console.log(`   Remaining messages: ${verifyInfo.messageCount}`);
    console.log(`   Status: ${verifyInfo.messageCount === 0 ? '✅ Empty' : '⚠️  Still has messages'}`);

    console.log('\n✅ Purge complete!');
  } catch (error: any) {
    if (error.code === 404) {
      console.error(`❌ Queue "${queueName}" not found!`);
    } else {
      console.error('❌ Error purging queue:', error);
    }
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

// Run purge
purgeQueue().catch(console.error);

