import dotenv from 'dotenv';

dotenv.config();

export const config = {
  dataSource: (process.env.DATA_SOURCE || 'mongo') as 'mongo' | 'postgres',
  postgres: {
    uri: process.env.POSTGRES_URI || 'postgresql://localhost:5432/postgres',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    sourceDatabase: process.env.SOURCE_DATABASE || 'ore',
    targetDatabase: process.env.TARGET_DATABASE || 'ore_transformed',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL,
    prefetch: parseInt(process.env.CONSUMER_PREFETCH || '10', 10),
    maxRetries: parseInt(process.env.CONSUMER_MAX_RETRIES || '3', 10),
  },
  etl: {
    batchSize: parseInt(process.env.BATCH_SIZE || '1000', 10),
    continuousMode: process.env.CONTINUOUS_MODE === 'true',
  },
  transformer: {
    chunkSize: parseInt(process.env.TRANSFORMER_CHUNK_SIZE || '5000', 10),
    batchSize: parseInt(process.env.TRANSFORMER_BATCH_SIZE || process.env.BATCH_SIZE || '500', 10),
    concurrency: parseInt(process.env.TRANSFORMER_CONCURRENCY || '4', 10),
  },
  program: {
    id: process.env.PROGRAM_ID || 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
