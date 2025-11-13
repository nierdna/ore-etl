import amqp from 'amqplib';
import { MongoManager } from '../database/mongo-manager';
import { parseRawTransaction } from '../etl/activity-parser';
import { logger } from '../utils/logger';
import { RawTransaction } from '../types/schemas';
import { ObjectId } from 'mongodb';

export interface ConsumerMetrics {
  processed: number;
  failed: number;
  retried: number;
  dlq: number;
  startTime: number;
}

export class TransactionConsumer {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly QUEUE = 'transaction-etl-v3';
  private readonly DLQ = 'transaction-etl-dlq';
  private readonly EXCHANGE = 'ore-transactions';
  private isConsuming = false;
  private metrics: ConsumerMetrics;

  constructor(
    private readonly mongoManager: MongoManager,
    private readonly rabbitmqUrl: string,
    private readonly prefetchCount: number = 10,
    private readonly maxRetries: number = 3
  ) {
    this.metrics = {
      processed: 0,
      failed: 0,
      retried: 0,
      dlq: 0,
      startTime: Date.now(),
    };
  }

  async start(): Promise<void> {
    try {
      // Connect to RabbitMQ
      logger.info(`Connecting to RabbitMQ: ${this.rabbitmqUrl.replace(/\/\/.*@/, '//*****@')}`);
      this.connection = await amqp.connect(this.rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      // Handle connection errors
      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', err);
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.isConsuming = false;
      });

      // Setup Dead Letter Queue
      await this.channel.assertQueue(this.DLQ, {
        durable: true,
      });

      // Setup main queue with DLQ
      await this.channel.assertQueue(this.QUEUE, {
        durable: true,
        deadLetterExchange: '',
        deadLetterRoutingKey: this.DLQ,
        maxLength: 100000, // Max 100k messages in queue (match with publisher)
      });

      // Set prefetch (concurrent processing limit)
      await this.channel.prefetch(this.prefetchCount);

      logger.info('Transaction consumer started');
      logger.info(`  Queue: ${this.QUEUE}`);
      logger.info(`  Prefetch: ${this.prefetchCount}`);
      logger.info(`  Max retries: ${this.maxRetries}`);

      this.isConsuming = true;

      // Start consuming messages
      await this.channel.consume(
        this.QUEUE,
        async (msg) => {
          if (msg) {
            await this.handleMessage(msg);
          }
        },
        { noAck: false }
      );

      // Log metrics every 30 seconds
      this.startMetricsLogger();
    } catch (error) {
      logger.error('Failed to start consumer', error);
      throw error;
    }
  }

  private async handleMessage(msg: amqp.Message): Promise<void> {
    const startTime = Date.now();
    let tx: RawTransaction | null = null;

    try {
      // Parse message
      const payload = JSON.parse(msg.content.toString());
      
      // Convert to RawTransaction format
      tx = {
        _id: new ObjectId(),
        signature: payload.signature,
        slot: payload.slot,
        blockTime: payload.blockTime,
        err: payload.err,
        parsedData: payload.parsedData,
        createdAt: new Date(payload.createdAt),
      };

      logger.info(`Processing transaction: ${tx.signature} (slot: ${tx.slot})`);

      // Parse and save using existing activity parser
      const activities = await parseRawTransaction(tx, {
        mongoManager: this.mongoManager,
      });

      // Acknowledge message (success)
      this.channel!.ack(msg);
      this.metrics.processed++;

      const duration = Date.now() - startTime;
      logger.info(
        `Processed ${tx.signature}: ${activities.length} activities in ${duration}ms`
      );
    } catch (error) {
      const signature = tx?.signature || 'unknown';
      logger.error(`Failed to process transaction ${signature}`, error);

      // Handle retry logic
      await this.handleFailure(msg, error);
    }
  }

  private async handleFailure(msg: amqp.Message, error: any): Promise<void> {
    const retryCount = (msg.properties.headers?.['x-retry-count'] || 0) + 1;
    const signature = this.getSignatureFromMessage(msg);

    if (retryCount <= this.maxRetries) {
      // Retry: nack and requeue with retry count
      logger.warn(`Retrying transaction ${signature} (attempt ${retryCount}/${this.maxRetries})`);

      this.channel!.nack(msg, false, false);
      this.metrics.retried++;

      // Republish with updated retry count and delay
      await this.channel!.sendToQueue(this.QUEUE, msg.content, {
        ...msg.properties,
        headers: {
          ...msg.properties.headers,
          'x-retry-count': retryCount,
        },
      });
    } else {
      // Max retries reached → send to DLQ
      logger.error(
        `Max retries reached for ${signature}, sending to DLQ. Error: ${error.message}`
      );

      this.channel!.nack(msg, false, false);
      this.metrics.failed++;
      this.metrics.dlq++;
    }
  }

  private getSignatureFromMessage(msg: amqp.Message): string {
    try {
      const payload = JSON.parse(msg.content.toString());
      return payload.signature || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private startMetricsLogger(): void {
    setInterval(() => {
      const uptime = (Date.now() - this.metrics.startTime) / 1000;
      const rate = this.metrics.processed / uptime;

      logger.info('Consumer Metrics:', {
        processed: this.metrics.processed,
        failed: this.metrics.failed,
        retried: this.metrics.retried,
        dlq: this.metrics.dlq,
        rate: `${rate.toFixed(2)} tx/s`,
        uptime: `${uptime.toFixed(0)}s`,
      });
    }, 30000);
  }

  async stop(): Promise<void> {
    try {
      this.isConsuming = false;
      await this.channel?.close();
      await this.connection?.close();
      logger.info('Transaction consumer stopped');
    } catch (error) {
      logger.error('Error stopping consumer', error);
    }
  }

  getMetrics(): ConsumerMetrics {
    return { ...this.metrics };
  }
}

