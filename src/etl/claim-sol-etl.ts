import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, ClaimSOLLog } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { ClaimSOLActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';

const LAMPORTS_PER_SOL = 1_000_000_000;

export class ClaimSOLETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Claim SOL ETL...');

    try {
      const state = await this.mongoManager.getETLState('claim_sol');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Claim SOL): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'claim_sol',
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
          logger.info('No more Claim SOL transactions to process');
          break;
        }

        const claims = await this.processBatch(batch);

        if (claims.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getClaimSOLCollection(),
            claims
          );
        }

        processed += claims.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${claims.length} Claim SOL txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'claim_sol',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'claim_sol',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Claim SOL ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Claim SOL ETL', error);

      const state = await this.mongoManager.getETLState('claim_sol');
      await this.mongoManager.updateETLState({
        type: 'claim_sol',
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
        'parsedData.meta.logMessages': { $regex: 'Claiming.*SOL$' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<ClaimSOLActivity[]> {
    const claims: ClaimSOLActivity[] = [];

    for (const tx of transactions) {
      try {
        const claim = await this.processTransaction(tx);
        if (claim) {
          claims.push(claim);
        }
      } catch (error) {
        logger.error(`Error processing Claim SOL transaction ${tx.signature}`, error);
      }
    }

    return claims;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<ClaimSOLActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      const parsedLogs = LogParser.parseAll(logs);
      const claimLogs = parsedLogs.filter(
        (log): log is ClaimSOLLog => log.type === 'claim_sol'
      );

      if (claimLogs.length === 0) {
        return null;
      }

      const claimLog = claimLogs[0];

      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      let authority = 'unknown';

      for (const ix of instructions) {
        const instructionType = InstructionParser.getInstructionType(ix.data);
        if (instructionType === 3) {
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

      const activity: ClaimSOLActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        amount: Math.round(claimLog.amountSOL * LAMPORTS_PER_SOL),
        amountSOL: claimLog.amountSOL,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Claim SOL transaction ${tx.signature}`, error);
      return null;
    }
  }
}

