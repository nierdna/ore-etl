import amqp from 'amqplib';
import dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

async function purgeDLQ() {
  const rabbitmqUrl = process.env.RABBITMQ_URL;
  if (!rabbitmqUrl) {
    console.error('❌ RABBITMQ_URL environment variable is required');
    process.exit(1);
  }

  const DLQ = 'transaction-etl-dlq';
  const backupFirst = process.env.BACKUP !== 'false'; // Default: backup first

  console.log('🗑️  Purge Dead Letter Queue');
  console.log(`   Queue: ${DLQ}`);
  console.log(`   Backup first: ${backupFirst}\n`);

  let connection: amqp.ChannelModel | null = null;
  let channel: amqp.Channel | null = null;

  try {
    // Connect to RabbitMQ
    console.log('📡 Connecting to RabbitMQ...');
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    // Check queue info
    const queueInfo = await channel.checkQueue(DLQ);
    console.log(`\n📊 Current Queue Status:`);
    console.log(`   Total messages: ${queueInfo.messageCount.toLocaleString()}`);
    console.log(`   Consumers: ${queueInfo.consumerCount}\n`);

    if (queueInfo.messageCount === 0) {
      console.log('✅ DLQ is already empty!');
      return;
    }

    // Safety confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `⚠️  WARNING: This will DELETE ${queueInfo.messageCount.toLocaleString()} messages from DLQ!\n` +
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
        const msg = await channel.get(DLQ, { noAck: false });
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
          console.error(`Error backing up message ${i + 1}:`, error);
        }

        // Nack to requeue
        channel.nack(msg, false, true);
      }

      if (samples.length > 0) {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(process.cwd(), 'dlq-backup');
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `dlq-backup-${timestamp}.json`);
        fs.writeFileSync(
          backupFile,
          JSON.stringify(
            {
              backedUpAt: new Date().toISOString(),
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
    console.log('\n🗑️  Purging DLQ...');
    const purgeResult = await channel.purgeQueue(DLQ);
    console.log(`✅ Purged ${purgeResult.messageCount.toLocaleString()} messages`);

    // Verify
    const verifyInfo = await channel.checkQueue(DLQ);
    console.log(`\n✅ Verification:`);
    console.log(`   Remaining messages: ${verifyInfo.messageCount}`);
    console.log(`   Status: ${verifyInfo.messageCount === 0 ? '✅ Empty' : '⚠️  Still has messages'}`);

    console.log('\n✅ Purge complete!');
  } catch (error) {
    console.error('❌ Error purging DLQ:', error);
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
purgeDLQ().catch(console.error);

