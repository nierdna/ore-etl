import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { DeployActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';

const LAMPORTS_PER_SOL = 1_000_000_000;

export class DeployETL {
  private mongoManager: MongoManager;

  constructor(mongoManager: MongoManager) {
    this.mongoManager = mongoManager;
  }

  async run(): Promise<void> {
    logger.info('Starting Deploy ETL...');

    try {
      // Get last processed state
      const state = await this.mongoManager.getETLState('deploy');
      const lastSlot = state?.lastProcessedSlot || 0;

      logger.info(`Last processed slot: ${lastSlot}`);

      await this.mongoManager.updateETLState({
        type: 'deploy',
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
          logger.info('No more transactions to process');
          break;
        }

        const deploys = await this.processBatch(batch);
        
        if (deploys.length > 0) {
          await this.mongoManager.saveBatch(
            this.mongoManager.getDeploysCollection(),
            deploys
          );
        }

        processed += deploys.length;
        currentSlot = batch[batch.length - 1].slot;

        logger.info(`Processed ${deploys.length} deploys, total: ${processed}`);

        // Update state
        await this.mongoManager.updateETLState({
          type: 'deploy',
          lastProcessedSlot: currentSlot,
          lastProcessedSignature: batch[batch.length - 1].signature,
          totalProcessed: (state?.totalProcessed || 0) + deploys.length,
          lastRunAt: new Date(),
          status: 'running',
        });
      }

      await this.mongoManager.updateETLState({
        type: 'deploy',
        lastProcessedSlot: currentSlot,
        lastProcessedSignature: '',
        totalProcessed: (state?.totalProcessed || 0) + processed,
        lastRunAt: new Date(),
        status: 'idle',
      });

      logger.info(`Deploy ETL completed. Processed ${processed} new deploys`);
    } catch (error) {
      logger.error('Error in Deploy ETL', error);
      
      const state = await this.mongoManager.getETLState('deploy');
      await this.mongoManager.updateETLState({
        type: 'deploy',
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
        'parsedData.meta.logMessages': { $regex: 'deploying.*SOL' },
      })
      .sort({ slot: 1 })
      .limit(config.etl.batchSize)
      .toArray();
  }

  private async processBatch(transactions: RawTransaction[]): Promise<DeployActivity[]> {
    const deploys: DeployActivity[] = [];

    for (const tx of transactions) {
      try {
        const deploy = await this.processTransaction(tx);
        if (deploy) {
          deploys.push(deploy);
        }
      } catch (error) {
        logger.error(`Error processing transaction ${tx.signature}`, error);
      }
    }

    return deploys;
  }

  // Public for testing
  async processTransaction(tx: RawTransaction): Promise<DeployActivity | null> {
    try {
      const logs = tx.parsedData?.meta?.logMessages || [];
      const success = tx.err === null;

      // Parse logs
      const parsedLogs = LogParser.parseAll(logs);
      const deployLog = parsedLogs.find(l => l.type === 'deploy');
      
      if (!deployLog || deployLog.type !== 'deploy') {
        return null;
      }

      // Find Deploy instruction (usually index 3 after ComputeBudget instructions)
      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      let deployInstruction = null;
      let accounts: any = {};

      for (const ix of instructions) {
        // Check if this is ORE program instruction
        if (ix.data && typeof ix.data === 'string') {
          const parsed = InstructionParser.parseDeployInstruction(ix.data);
          if (parsed) {
            deployInstruction = parsed;
            accounts = InstructionParser.extractAccounts(ix);
            break;
          }
        }
      }

      // Extract authority from accounts or accountKeys
      let authority = accounts.authority || accounts.signer || 'unknown';
      
      // Fallback: extract from accountKeys if instruction parsing failed
      if (authority === 'unknown') {
        const accountKeys = tx.parsedData?.transaction?.message?.accountKeys || [];
        if (accountKeys.length > 0) {
          // First account is usually signer
          const signerAccount = accountKeys[0];
          authority = extractPubkey(signerAccount?.pubkey) || 'unknown';
        }
      }
      
      // Determine if automation
      const isAutomation = accounts.automation ? true : false;

      // Build activity
      const activity: DeployActivity = {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.blockTime || 0,
        authority,
        roundId: deployLog.roundId,
        amount: deployInstruction ? Number(deployInstruction.amount) : Math.round(deployLog.amountSOL * LAMPORTS_PER_SOL),
        amountSOL: deployLog.amountSOL,
        numSquares: deployLog.numSquares,
        squaresMask: deployInstruction?.mask,
        squares: deployInstruction?.squares,
        isAutomation,
        success,
        createdAt: new Date(),
      };

      return activity;
    } catch (error) {
      logger.error(`Error parsing deploy transaction ${tx.signature}`, error);
      return null;
    }
  }
}

