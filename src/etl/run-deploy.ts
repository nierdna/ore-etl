import { MongoManager } from '../database/mongo-manager';
import { DeployETL } from './deploy-etl';
import { logger } from '../utils/logger';

async function main() {
  const mongoManager = new MongoManager();

  try {
    await mongoManager.connect();

    const deployETL = new DeployETL(mongoManager);
    await deployETL.run();

    await mongoManager.disconnect();
    logger.info('Deploy ETL completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Deploy ETL failed', error);
    await mongoManager.disconnect();
    process.exit(1);
  }
}

main();

