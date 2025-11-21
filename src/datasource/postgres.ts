import { Pool } from 'pg';
import { TransactionSource } from './interface';
import { RawTransaction } from '../types/schemas';
import { config } from '../config';
import { logger } from '../utils/logger';

interface PostgresRow {
  from_block_number: string; // BigInt returns as string
  to_block_number: string;
  data: any[]; // JSONB array of transactions
}

export class PostgresTransactionSource implements TransactionSource {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.postgres.uri,
    });
  }

  async connect(): Promise<void> {
    try {
      await this.pool.query('SELECT NOW()');
      logger.info('Connected to Postgres');
    } catch (error) {
      logger.error('Failed to connect to Postgres', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    logger.info('Disconnected from Postgres');
  }

  async getSlotRange(): Promise<{ min: number; max: number }> {
    // Using to_block_number as the slot reference
    const query = `
      SELECT 
        MIN(from_block_number) as min_slot, 
        MAX(to_block_number) as max_slot 
      FROM public.ore
    `;
    
    const result = await this.pool.query(query);
    const row = result.rows[0];
    
    if (!row.min_slot || !row.max_slot) {
      return { min: 0, max: 0 };
    }

    return {
      min: Number(row.min_slot),
      max: Number(row.max_slot),
    };
  }

  async getTransactions(startSlot: number, endSlot: number): Promise<RawTransaction[]> {
    const query = `
      SELECT from_block_number, data 
      FROM public.ore 
      WHERE from_block_number >= $1 AND from_block_number <= $2
      ORDER BY from_block_number ASC
    `;

    const result = await this.pool.query<PostgresRow>(query, [startSlot, endSlot]);
    const transactions: RawTransaction[] = [];

    for (const row of result.rows) {
      const slot = Number(row.from_block_number);
      
      // Flatten the 'data' array which contains multiple transactions per block
      if (Array.isArray(row.data)) {
        for (const txData of row.data) {
          // Try to extract signature safely
          const signature = txData?.transaction?.signatures?.[0] || 'unknown';
          
          const rawTx: RawTransaction = {
            // Postgres doesn't provide MongoDB _id, leaving it undefined or could generate one if needed
            _id: undefined as any, 
            signature,
            slot,
            blockTime: txData?.blockTime || 0, // Block time not available in current schema, defaulting to 0
            err: txData?.meta?.err || null,
            parsedData: txData, // Keeping the full structure as parsedData
            createdAt: new Date(), // Use current time as sync time
          };

          transactions.push(rawTx);
        }
      }
    }

    return transactions;
  }
}

