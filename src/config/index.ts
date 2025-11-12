import dotenv from 'dotenv';

dotenv.config();

export const config = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    sourceDatabase: process.env.SOURCE_DATABASE || 'ore',
    targetDatabase: process.env.TARGET_DATABASE || 'ore_transformed',
  },
  etl: {
    batchSize: parseInt(process.env.BATCH_SIZE || '1000', 10),
  },
  program: {
    id: process.env.PROGRAM_ID || 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

