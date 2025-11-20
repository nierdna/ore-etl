import { MongoManager } from '../database/mongo-manager';
import { TransactionTransformer } from './transaction-transformer';
import { logger } from '../utils/logger';
import { config } from '../config';
import { PostgresTransactionSource } from '../datasource/postgres';
import { MongoTransactionSource } from '../datasource/mongo';

async function main() {
  const mongoManager = new MongoManager();
  const force = process.argv.includes('--force');

  // Init source based on config
  let source;
  if (config.dataSource === 'postgres') {
      source = new PostgresTransactionSource();
  } else {
      source = new MongoTransactionSource(mongoManager);
  }

  try {
    await mongoManager.connect();
    const transformer = new TransactionTransformer(mongoManager, source, { forceReinitialize: force });
    await transformer.run();
    await mongoManager.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Transaction transformer failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();


