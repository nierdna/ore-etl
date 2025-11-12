import { MongoManager } from '../database/mongo-manager';
import { DeployETL } from './deploy-etl';
import { CheckpointETL } from './checkpoint-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    // Run Deploy ETL
    logger.info('='.repeat(50));
    logger.info('Starting Deploy ETL');
    logger.info('='.repeat(50));
    const deployETL = new DeployETL(mongoManager);
    await deployETL.run();

    // Run Checkpoint ETL
    logger.info('='.repeat(50));
    logger.info('Starting Checkpoint ETL');
    logger.info('='.repeat(50));
    const checkpointETL = new CheckpointETL(mongoManager);
    await checkpointETL.run();

    await mongoManager.disconnect();
    logger.info('='.repeat(50));
    logger.info('All ETL processes completed successfully');
    logger.info('='.repeat(50));
    process.exit(0);
  } catch (error) {
    logger.error('ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

