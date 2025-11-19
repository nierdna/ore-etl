import { MongoManager } from '../database/mongo-manager';
import { logger } from '../utils/logger';
import { LogParser } from '../parsers/log-parser';
import { InstructionParser } from '../parsers/instruction-parser';
import { DeployActivity, RawTransaction } from '../types/schemas';
import { config } from '../config';
import { extractPubkey } from '../utils/pubkey-converter';
import { reconstructSquaresForAutomation } from '../utils/squares-reconstructor';

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

      // Find Deploy instruction - check all instructions, not just the first one
      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      const innerInstructions = tx.parsedData?.meta?.innerInstructions || [];

      let deployInstruction = null;
      let accounts: any = {};
      const allDeployInstructions: Array<{ parsed: any; accounts: any; source: string }> = [];

      // Check main instructions
      for (const ix of instructions) {
        if (ix.data && typeof ix.data === 'string') {
          const parsed = InstructionParser.parseDeployInstruction(ix.data);
          if (parsed) {
            allDeployInstructions.push({
              parsed,
              accounts: InstructionParser.extractAccounts(ix),
              source: 'main'
            });
          }
        }
      }

      // Check inner instructions
      for (const innerGroup of innerInstructions) {
        if (innerGroup.instructions) {
          for (const ix of innerGroup.instructions) {
            if (ix.data && typeof ix.data === 'string') {
              const parsed = InstructionParser.parseDeployInstruction(ix.data);
              if (parsed) {
                allDeployInstructions.push({
                  parsed,
                  accounts: InstructionParser.extractAccounts(ix),
                  source: 'inner'
                });
              }
            }
          }
        }
      }

      // Select the best Deploy instruction
      // Priority: 1) Has non-zero mask (has squares), 2) Has non-zero amount matching log
      if (allDeployInstructions.length > 0) {
        // First, try to find one with non-zero mask and matching amount
        const expectedAmount = Math.round(deployLog.amountSOL * LAMPORTS_PER_SOL);
        const withSquares = allDeployInstructions.find(
          d => d.parsed.mask !== 0 && Math.abs(Number(d.parsed.amount) - expectedAmount) < 1000
        );

        if (withSquares) {
          deployInstruction = withSquares.parsed;
          accounts = withSquares.accounts;
        } else {
          // Fallback: use first one with non-zero mask
          const withMask = allDeployInstructions.find(d => d.parsed.mask !== 0);
          if (withMask) {
            deployInstruction = withMask.parsed;
            accounts = withMask.accounts;
          } else {
            // Last resort: use first one found
            deployInstruction = allDeployInstructions[0].parsed;
            accounts = allDeployInstructions[0].accounts;
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

      // Handle special cases for squares
      let finalSquares = deployInstruction?.squares || [];
      let finalSquaresMask = deployInstruction?.mask;

      // Case 1: If mask = 0 but numSquares > 0, check if it's deploy all squares (25)
      if (deployInstruction && deployInstruction.mask === 0 && deployLog.numSquares > 0) {
        if (deployLog.numSquares === 25) {
          // Deploy all 25 squares - mask = 0 means all squares
          finalSquares = [];
          finalSquaresMask = 0;
        } else {
          // Mask = 0 but numSquares < 25 - automation random strategy
          // For automation transactions with Random strategy, squares are generated from hash
          // of authority + roundId. We can reconstruct them deterministically.
          if (isAutomation && authority !== 'unknown') {
            try {
              finalSquares = reconstructSquaresForAutomation(
                authority,
                deployLog.roundId,
                deployLog.numSquares
              );
              logger.info(`Transaction ${tx.signature}: Reconstructed ${finalSquares.length} squares for automation (authority=${authority}, roundId=${deployLog.roundId}, numSquares=${deployLog.numSquares})`);
            } catch (error) {
              logger.warn(`Transaction ${tx.signature}: Failed to reconstruct squares for automation: ${error instanceof Error ? error.message : 'Unknown error'}`);
              // Keep squares = [] if reconstruction fails
              finalSquares = [];
            }
          } else {
            // Not automation or authority unknown - cannot reconstruct
            logger.warn(`Transaction ${tx.signature}: mask=0 but numSquares=${deployLog.numSquares}, cannot reconstruct squares (isAutomation=${isAutomation}, authority=${authority})`);
            finalSquares = [];
          }
        }
      }

      // Case 2: If numSquares = 25 and squares.length = 25, set squares = [] (all squares)
      if (deployLog.numSquares === 25 && finalSquares.length === 25) {
        // All 25 squares selected - according to criteria, this should be squares = []
        finalSquares = [];
        finalSquaresMask = 0; // Or keep original mask for reference
      }

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
        squaresMask: finalSquaresMask,
        squares: finalSquares,
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

