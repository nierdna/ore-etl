import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, DepositLog } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { DepositActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';

const GRAMS_PER_ORE = 100_000_000_000;

export class DepositETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Deposit ETL...');

    try {
      const state = await this.mongoManager.getETLState('deposit');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Deposit): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'deposit',
        lastProcessedSlot: lastSlot,
        lastProcessedSignature: state?.lastProcessedSignature || '',
        totalProcessed: state?.totalProcessed || 0,
        lastRunAt: new Date(),
        status: 'running',
      });

      let processed = 0;
      let currentSlot = lastSlot;

      while (true) {
        const batch = await this.fetchBatch(currentSlot);

        if (batch.length === 0) {
          logger.info('No more Deposit transactions to process');
          break;
        }

        const deposits = await this.processBatch(batch);

        if (deposits.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getDepositsCollection(),
            deposits
          );
        }

        processed += deposits.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${deposits.length} Deposit txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'deposit',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'deposit',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Deposit ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Deposit ETL', error);

      const state = await this.mongoManager.getETLState('deposit');
      await this.mongoManager.updateETLState({
        type: 'deposit',
        lastProcessedSlot: state?.lastProcessedSlot || 0,
        lastProcessedSignature: state?.lastProcessedSignature || '',
        totalProcessed: state?.totalProcessed || 0,
        lastRunAt: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  private async fetchBatch(afterSlot: number): Promise<RawTransaction[]> {
    const collection = this.mongoManager.getRawTransactionsCollection();

    return await collection
      .find({
        slot: { $gt: afterSlot },
        'parsedData.meta.logMessages': { $regex: 'Depositing.*ORE' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<DepositActivity[]> {
    const deposits: DepositActivity[] = [];

    for (const tx of transactions) {
      try {
        const deposit = await this.processTransaction(tx);
        if (deposit) {
          deposits.push(deposit);
        }
      } catch (error) {
        logger.error(`Error processing Deposit transaction ${tx.signature}`, error);
      }
    }

    return deposits;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<DepositActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      const parsedLogs = LogParser.parseAll(logs);
      const depositLogs = parsedLogs.filter(
        (log): log is DepositLog => log.type === 'deposit'
      );

      if (depositLogs.length === 0) {
        return null;
      }

      const depositLog = depositLogs[0];

      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      let authority = 'unknown';

      for (const ix of instructions) {
        const instructionType = InstructionParser.getInstructionType(ix.data);
        if (instructionType === 10) {
          const accounts = InstructionParser.extractAccounts(ix);
          if (accounts.authority || accounts.signer) {
            authority = accounts.authority || accounts.signer || 'unknown';
            break;
          }
        }
      }

      if (authority === 'unknown') {
        const accountKeys = tx.parsedData?.transaction?.message?.accountKeys || [];
        if (accountKeys.length > 0) {
          const signerAccount = accountKeys[0];
          authority = extractPubkey(signerAccount?.pubkey) || 'unknown';
        }
      }

      const activity: DepositActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        amount: Math.round(depositLog.amountORE * GRAMS_PER_ORE),
        amountORE: depositLog.amountORE,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Deposit transaction ${tx.signature}`, error);
      return null;
    }
  }
}

