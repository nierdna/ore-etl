import amqp from 'amqplib';
import { logger } from '../utils/logger';
import { ActivityType, ParsedActivity } from '../etl/activity-parser';

interface ActivityEventMessage {
  activityType: ActivityType;
  activity: any; // Activity data without activityType field
  timestamp: string; // ISO string
  signature: string;
  slot: number;
}

export class ActivityPublisher {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly EXCHANGE = 'activity-events';
  private readonly EXCHANGE_TYPE = 'topic';
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly rabbitmqUrl: string) {}

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.rabbitmqUrl);
      if (!this.connection) {
        throw new Error('Failed to establish RabbitMQ connection');
      }

      this.channel = await this.connection.createChannel();
      if (!this.channel) {
        throw new Error('Failed to create RabbitMQ channel');
      }

      // Handle connection errors
      this.connection.on('error', (err) => {
        logger.error('ActivityPublisher: RabbitMQ connection error', err);
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        logger.warn('ActivityPublisher: RabbitMQ connection closed');
        this.handleDisconnect();
      });

      // Declare Topic Exchange
      await this.channel.assertExchange(this.EXCHANGE, this.EXCHANGE_TYPE, {
        durable: true,
      });

      this.isConnected = true;
      logger.info('ActivityPublisher: Connected to RabbitMQ successfully');
    } catch (error) {
      logger.error('ActivityPublisher: Failed to connect to RabbitMQ', error);
      this.handleDisconnect();
      throw error;
    }
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    this.channel = null;
    this.connection = null;

    // Auto reconnect after 5 seconds
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        logger.info('ActivityPublisher: Attempting to reconnect to RabbitMQ...');
        this.reconnectTimer = null;
        this.connect().catch((err) => {
          logger.error('ActivityPublisher: Reconnect failed', err);
        });
      }, 5000);
    }
  }

  /**
   * Get routing key for activity type
   */
  private getRoutingKey(activityType: ActivityType): string {
    return `activity.${activityType}`;
  }

  /**
   * Publish single activity event
   */
  async publishActivity(activityType: ActivityType, activity: any): Promise<boolean> {
    if (!this.isConnected || !this.channel) {
      logger.warn('ActivityPublisher: Not connected, skipping publish');
      return false;
    }

    try {
      // Extract signature and slot from activity
      const signature = activity.signature || 'unknown';
      const slot = activity.slot || 0;

      // Create message (remove activityType from activity object if present)
      const { activityType: _, ...activityData } = activity;
      const message: ActivityEventMessage = {
        activityType,
        activity: activityData,
        timestamp: new Date().toISOString(),
        signature,
        slot,
      };

      const routingKey = this.getRoutingKey(activityType);
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = this.channel.publish(
        this.EXCHANGE,
        routingKey,
        messageBuffer,
        {
          persistent: true, // Persist to disk
          contentType: 'application/json',
          timestamp: Date.now(),
        }
      );

      if (!published) {
        logger.warn('ActivityPublisher: Message buffer full, waiting...');
        await new Promise((resolve) => this.channel!.once('drain', resolve));
        return this.publishActivity(activityType, activity); // Retry
      }

      logger.debug(
        `ActivityPublisher: Published ${activityType} event: ${signature} (slot: ${slot})`
      );
      return true;
    } catch (error) {
      logger.error(`ActivityPublisher: Failed to publish ${activityType} activity:`, error);
      return false;
    }
  }

  /**
   * Publish multiple activities (batch)
   */
  async publishBatch(activities: ParsedActivity[]): Promise<void> {
    if (!this.isConnected || !this.channel) {
      logger.warn('ActivityPublisher: Not connected, skipping batch publish');
      return;
    }

    const results = await Promise.allSettled(
      activities.map((activity) => {
        const { activityType, ...activityData } = activity;
        return this.publishActivity(activityType, activityData);
      })
    );

    const successful = results.filter(
      (r) => r.status === 'fulfilled' && r.value
    ).length;
    const failed = results.length - successful;

    if (failed > 0) {
      logger.warn(
        `ActivityPublisher: Batch publish: ${successful} success, ${failed} failed`
      );
    } else {
      logger.debug(`ActivityPublisher: Batch publish: ${successful} success`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      this.channel = null;
      this.connection = null;
      logger.info('ActivityPublisher: Disconnected from RabbitMQ');
    } catch (error) {
      logger.error('ActivityPublisher: Error during disconnect', error);
    }
  }

  isConnectionActive(): boolean {
    return this.isConnected;
  }
}

