/**
 * Script to fix squares for automation transactions with mask=0
 * Reconstructs squares using reconstructSquaresForAutomation() and updates database
 */

import { MongoClient } from 'mongodb';
import { config } from '../config';
import { reconstructSquaresForAutomation } from '../utils/squares-reconstructor';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

const BATCH_SIZE = 1000; // Process in batches to avoid memory issues

// Check for dry-run mode
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

interface DeployRecord {
  _id: any;
  signature: string;
  authority: string;
  roundId: number;
  numSquares: number;
  squares: number[];
  squaresMask: number;
  isAutomation: boolean;
}

async function fixSquares() {
  const client = new MongoClient(config.mongodb.uri);
  
  try {
    await client.connect();
    logger.info('Connected to MongoDB');

    const db = client.db(config.mongodb.targetDatabase);
    const collection = db.collection<DeployRecord>('deploys');

    // Count total records to fix
    const totalCount = await collection.countDocuments({
      isAutomation: true,
      squaresMask: 0,
      numSquares: { $gt: 0, $lt: 25 },
      $or: [
        { squares: { $exists: false } },
        { squares: { $size: 0 } }
      ],
      authority: { $ne: 'unknown' }
    });

    logger.info(`Found ${totalCount} records to fix`);
    
    if (DRY_RUN) {
      logger.warn('⚠️  DRY-RUN MODE: No changes will be made to database');
    }

    if (totalCount === 0) {
      logger.info('No records to fix. Exiting.');
      return;
    }

    let processed = 0;
    let fixed = 0;
    let errors = 0;
    let skipped = 0;

    // Process in batches
    let skip = 0;
    while (skip < totalCount) {
      const batch = await collection
        .find({
          isAutomation: true,
          squaresMask: 0,
          numSquares: { $gt: 0, $lt: 25 },
          $or: [
            { squares: { $exists: false } },
            { squares: { $size: 0 } }
          ],
          authority: { $ne: 'unknown' }
        })
        .skip(skip)
        .limit(BATCH_SIZE)
        .toArray();

      if (batch.length === 0) {
        break;
      }

      logger.info(`Processing batch: ${skip + 1} - ${skip + batch.length} of ${totalCount}`);

      // Process each record
      const updateOps: any[] = [];
      const processedRecords: Array<{ record: DeployRecord; squares: number[] }> = [];

      for (const record of batch) {
        try {
          // Reconstruct squares
          const squares = reconstructSquaresForAutomation(
            record.authority,
            record.roundId,
            record.numSquares
          );

          // Verify squares are valid
          if (squares.length !== record.numSquares) {
            logger.warn(
              `Record ${record.signature}: Expected ${record.numSquares} squares, got ${squares.length}. Skipping.`
            );
            skipped++;
            continue;
          }

          // Store for dry-run logging
          processedRecords.push({ record, squares });

          // Add to update operations
          updateOps.push({
            updateOne: {
              filter: { _id: record._id },
              update: {
                $set: {
                  squares: squares,
                  fixedAt: new Date()
                }
              }
            }
          });

          fixed++;
        } catch (error) {
          logger.error(
            `Error processing record ${record.signature}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          errors++;
        }
      }

      // Bulk update
      if (updateOps.length > 0) {
        if (DRY_RUN) {
          logger.info(`[DRY-RUN] Would update ${updateOps.length} records in this batch`);
          // Log first few updates as examples
          for (let i = 0; i < Math.min(3, processedRecords.length); i++) {
            const { record, squares } = processedRecords[i];
            logger.info(
              `[DRY-RUN] Example: ${record.signature} -> squares: [${squares.slice(0, 5).join(',')}...] (${squares.length} total)`
            );
          }
        } else {
          await collection.bulkWrite(updateOps, { ordered: false });
          logger.info(`Updated ${updateOps.length} records in this batch`);
        }
      }

      processed += batch.length;
      skip += BATCH_SIZE;

      // Log progress
      logger.info(
        `Progress: ${processed}/${totalCount} processed, ${fixed} fixed, ${errors} errors, ${skipped} skipped`
      );
    }

    logger.info('\n=== Fix Summary ===');
    if (DRY_RUN) {
      logger.info('⚠️  DRY-RUN MODE: No changes were made');
    }
    logger.info(`Total records processed: ${processed}`);
    logger.info(`Successfully fixed: ${fixed}`);
    logger.info(`Errors: ${errors}`);
    logger.info(`Skipped: ${skipped}`);

  } catch (error) {
    logger.error('Error in fix-squares script:', error);
    throw error;
  } finally {
    await client.close();
    logger.info('Disconnected from MongoDB');
  }
}

// Run if executed directly
if (require.main === module) {
  fixSquares()
    .then(() => {
      logger.info('Fix completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Fix failed:', error);
      process.exit(1);
    });
}

export { fixSquares };

