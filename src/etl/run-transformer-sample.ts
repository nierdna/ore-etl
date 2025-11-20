import { MongoManager } from '../database/mongo-manager';
import { TransactionTransformer } from './transaction-transformer';
import { logger } from '../utils/logger';
import { config } from '../config';
import { PostgresTransactionSource } from '../datasource/postgres';
import { MongoTransactionSource } from '../datasource/mongo';

async function main() {
  const limitArgIndex = process.argv.findIndex(arg => arg === '--limit');
  const limit = limitArgIndex !== -1 ? parseInt(process.argv[limitArgIndex + 1] || '100', 10) : 100;

  if (Number.isNaN(limit) || limit <= 0) {
    logger.error('Invalid --limit value. Please provide a positive integer.');
    process.exit(1);
  }

  const mongoManager = new MongoManager();
  
  // Init source based on config
  let source;
  if (config.dataSource === 'postgres') {
      source = new PostgresTransactionSource();
  } else {
      source = new MongoTransactionSource(mongoManager);
  }

  try {
    await mongoManager.connect();
    const transformer = new TransactionTransformer(mongoManager, source, { chunkSize: limit, batchSize: limit, concurrency: 1 });
    const result = await transformer.runSample(limit);
    logger.info(
      `Sample run completed: ${result.processedTransactions} transactions, ${result.processedActivities} activities, ${(result.durationMs / 1000).toFixed(2)}s`
    );
    await mongoManager.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Sample transformer run failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();


