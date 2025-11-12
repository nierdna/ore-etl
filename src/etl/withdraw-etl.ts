import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, WithdrawLog } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { RawTransaction, WithdrawActivity } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';

const GRAMS_PER_ORE = 100_000_000_000;

export class WithdrawETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Withdraw ETL...');

    try {
      const state = await this.mongoManager.getETLState('withdraw');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Withdraw): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'withdraw',
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
          logger.info('No more Withdraw transactions to process');
          break;
        }

        const withdraws = await this.processBatch(batch);

        if (withdraws.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getWithdrawsCollection(),
            withdraws
          );
        }

        processed += withdraws.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${withdraws.length} Withdraw txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'withdraw',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'withdraw',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Withdraw ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Withdraw ETL', error);

      const state = await this.mongoManager.getETLState('withdraw');
      await this.mongoManager.updateETLState({
        type: 'withdraw',
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
        'parsedData.meta.logMessages': { $regex: 'Withdrawing.*ORE' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<WithdrawActivity[]> {
    const withdraws: WithdrawActivity[] = [];

    for (const tx of transactions) {
      try {
        const withdraw = await this.processTransaction(tx);
        if (withdraw) {
          withdraws.push(withdraw);
        }
      } catch (error) {
        logger.error(`Error processing Withdraw transaction ${tx.signature}`, error);
      }
    }

    return withdraws;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<WithdrawActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      const parsedLogs = LogParser.parseAll(logs);
      const withdrawLogs = parsedLogs.filter(
        (log): log is WithdrawLog => log.type === 'withdraw'
      );

      if (withdrawLogs.length === 0) {
        return null;
      }

      const withdrawLog = withdrawLogs[0];

      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      let authority = 'unknown';

      for (const ix of instructions) {
        const instructionType = InstructionParser.getInstructionType(ix.data);
        if (instructionType === 11) {
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

      const activity: WithdrawActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        amount: Math.round(withdrawLog.amountORE * GRAMS_PER_ORE),
        amountORE: withdrawLog.amountORE,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Withdraw transaction ${tx.signature}`, error);
      return null;
    }
  }
}

