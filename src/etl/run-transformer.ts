import { MongoManager } from '../database/mongo-manager';
import { TransactionTransformer } from './transaction-transformer';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();
  const force = process.argv.includes('--force');

  try {
    await mongoManager.connect();
    const transformer = new TransactionTransformer(mongoManager, { forceReinitialize: force });
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


