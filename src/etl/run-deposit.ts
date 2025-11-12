import { MongoManager } from '../database/mongo-manager';
import { DepositETL } from './deposit-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Deposit ETL');
    logger.info('='.repeat(50));

    const depositETL = new DepositETL(mongoManager);
    await depositETL.run();

    await mongoManager.disconnect();
    logger.info('Deposit ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Deposit ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

