import { MongoManager } from '../database/mongo-manager';
import { WithdrawETL } from './withdraw-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    logger.info('='.repeat(50));
    logger.info('Starting Withdraw ETL');
    logger.info('='.repeat(50));

    const withdrawETL = new WithdrawETL(mongoManager);
    await withdrawETL.run();

    await mongoManager.disconnect();
    logger.info('Withdraw ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Withdraw ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

