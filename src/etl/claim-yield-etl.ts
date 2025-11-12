import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser, ClaimORELog } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { ClaimYieldActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';

const GRAMS_PER_ORE = 100_000_000_000;

export class ClaimYieldETL {
  constructor(private readonly mongoManager: MongoManager) {}

  async run(): Promise<void> {
    logger.info('Starting Claim Yield ETL...');

    try {
      const state = await this.mongoManager.getETLState('claim_yield');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot (Claim Yield): ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'claim_yield',
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
          logger.info('No more Claim Yield transactions to process');
          break;
        }

        const claims = await this.processBatch(batch);

        if (claims.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getClaimYieldsCollection(),
            claims
          );
        }

        processed += claims.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${claims.length} Claim Yield txs, total: ${processed}`);

        await this.mongoManager.updateETLState({
          type: 'claim_yield',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + processed,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'claim_yield',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Claim Yield ETL completed. Processed ${processed} new transactions`);
    } catch (error) {
      logger.error('Error in Claim Yield ETL', error);

      const state = await this.mongoManager.getETLState('claim_yield');
      await this.mongoManager.updateETLState({
        type: 'claim_yield',
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
        'parsedData.meta.logMessages': { $regex: 'Claiming.*ORE$' },
        'parsedData.transaction.message.instructions': { $elemMatch: { data: 'D' } },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<ClaimYieldActivity[]> {
    const claims: ClaimYieldActivity[] = [];

    for (const tx of transactions) {
      try {
        const claim = await this.processTransaction(tx);
        if (claim) {
          claims.push(claim);
        }
      } catch (error) {
        logger.error(`Error processing Claim Yield transaction ${tx.signature}`, error);
      }
    }

    return claims;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<ClaimYieldActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      const hasClaimYieldInstruction = instructions.some(
        (ix: any) => InstructionParser.getInstructionType(ix.data) === 12
      );

      if (!hasClaimYieldInstruction) {
        return null;
      }

      const parsedLogs = LogParser.parseAll(logs);
      const claimLogs = parsedLogs.filter(
        (log): log is ClaimORELog => log.type === 'claim_ore'
      );

      if (claimLogs.length === 0) {
        return null;
      }

      const claimLog = claimLogs[0];

      let authority = 'unknown';

      for (const ix of instructions) {
        const instructionType = InstructionParser.getInstructionType(ix.data);
        if (instructionType === 12) {
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

      const activity: ClaimYieldActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        amount: Math.round(claimLog.amountORE * GRAMS_PER_ORE),
        amountORE: claimLog.amountORE,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing Claim Yield transaction ${tx.signature}`, error);
      return null;
    }
  }
}

