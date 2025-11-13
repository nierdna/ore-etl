import { MongoManager } from '../database/mongo-manager';
import { TransactionConsumer } from '../queue/transaction-consumer';
import { logger } from '../utils/logger';
import { config } from '../config';

export class RealtimeListener {
  private mongoManager: MongoManager;
  private consumer: TransactionConsumer | null = null;
  private isRunning = false;

  constructor() {
    this.mongoManager = new MongoManager();
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Realtime ETL Listener...');

      // Connect to MongoDB
      await this.mongoManager.connect();
      logger.info('Connected to MongoDB');

      // Get RabbitMQ URL from environment
      const rabbitmqUrl = process.env.RABBITMQ_URL;
      if (!rabbitmqUrl) {
        throw new Error('RABBITMQ_URL environment variable is required');
      }

      // Create and start consumer
      this.consumer = new TransactionConsumer(
        this.mongoManager,
        rabbitmqUrl,
        parseInt(process.env.CONSUMER_PREFETCH || '10', 10),
        parseInt(process.env.CONSUMER_MAX_RETRIES || '3', 10)
      );

      await this.consumer.start();
      this.isRunning = true;

      logger.info('Realtime ETL Listener is running');
      logger.info('Waiting for transactions from RabbitMQ...');

      // Setup graceful shutdown
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error('Failed to start Realtime Listener', error);
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      if (this.isRunning) {
        this.isRunning = false;

        // Stop consumer
        if (this.consumer) {
          await this.consumer.stop();
        }

        // Disconnect from MongoDB
        await this.mongoManager.disconnect();

        logger.info('Shutdown complete');
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.stop();
    }
    await this.mongoManager.disconnect();
    this.isRunning = false;
  }
}

