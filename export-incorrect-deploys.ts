/**
 * Export incorrect deploy records to JSON files for analysis
 */

import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

interface DeployRecord {
  signature: string;
  numSquares: number;
  squares: number[];
  squaresLength: number;
  squaresMask?: number;
  amountSOL: number;
  roundId: number;
}

async function exportIncorrectDeploys() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const transformedDb = client.db('ore_transformed');
    const deploysCollection = transformedDb.collection('deploys');
    const rawDb = client.db('ore');
    const transactionsCollection = rawDb.collection('transactions');
    
    // Find incorrect deploys: numSquares < 25 but squares = []
    const incorrectDeploys1 = await deploysCollection
      .aggregate([
        {
          $addFields: {
            squaresLength: { $size: { $ifNull: ['$squares', []] } }
          }
        },
        {
          $addFields: {
            isCorrect1: {
              $and: [
                { $lt: ['$numSquares', 25] },
                { $eq: ['$numSquares', '$squaresLength'] }
              ]
            },
            isCorrect2: {
              $and: [
                { $eq: ['$numSquares', 25] },
                { $eq: ['$squaresLength', 0] }
              ]
            }
          }
        },
        {
          $addFields: {
            isCorrect: { $or: ['$isCorrect1', '$isCorrect2'] }
          }
        },
        {
          $match: {
            isCorrect: false,
            numSquares: { $lt: 25 },
            $expr: { $eq: [{ $size: { $ifNull: ['$squares', []] } }, 0] }
          }
        },
        {
          $project: {
            signature: 1,
            numSquares: 1,
            squares: 1,
            squaresMask: 1,
            amountSOL: 1,
            roundId: 1
          }
        },
        { $limit: 50 }
      ])
      .toArray();
    
    console.log(`Found ${incorrectDeploys1.length} incorrect deploys (numSquares < 25, squares = [])`);
    
    // Find incorrect deploys: numSquares = 25 but squares.length = 25
    const incorrectDeploys2 = await deploysCollection
      .aggregate([
        {
          $addFields: {
            squaresLength: { $size: { $ifNull: ['$squares', []] } }
          }
        },
        {
          $match: {
            numSquares: 25,
            $expr: { $eq: [{ $size: { $ifNull: ['$squares', []] } }, 25] }
          }
        },
        {
          $project: {
            signature: 1,
            numSquares: 1,
            squares: 1,
            squaresMask: 1,
            amountSOL: 1,
            roundId: 1
          }
        },
        { $limit: 20 }
      ])
      .toArray();
    
    console.log(`Found ${incorrectDeploys2.length} incorrect deploys (numSquares = 25, squares.length = 25)`);
    
    // Fetch raw transaction data for incorrect deploys
    const signatures1 = incorrectDeploys1.map((d: any) => d.signature);
    const signatures2 = incorrectDeploys2.map((d: any) => d.signature);
    
    const rawTransactions1 = await transactionsCollection
      .find({ signature: { $in: signatures1 } })
      .project({
        signature: 1,
        slot: 1,
        blockTime: 1,
        err: 1,
        'parsedData.meta.logMessages': 1,
        'parsedData.meta.innerInstructions': 1,
        'parsedData.transaction.message.instructions': 1,
        'parsedData.transaction.message.accountKeys': 1
      })
      .toArray();
    
    const rawTransactions2 = await transactionsCollection
      .find({ signature: { $in: signatures2 } })
      .project({
        signature: 1,
        slot: 1,
        blockTime: 1,
        err: 1,
        'parsedData.meta.logMessages': 1,
        'parsedData.meta.innerInstructions': 1,
        'parsedData.transaction.message.instructions': 1,
        'parsedData.transaction.message.accountKeys': 1
      })
      .toArray();
    
    // Combine deploy records with raw transactions
    const combined1 = incorrectDeploys1.map((deploy: any) => {
      const tx = rawTransactions1.find((t: any) => t.signature === deploy.signature);
      return {
        deploy,
        rawTransaction: tx
      };
    });
    
    const combined2 = incorrectDeploys2.map((deploy: any) => {
      const tx = rawTransactions2.find((t: any) => t.signature === deploy.signature);
      return {
        deploy,
        rawTransaction: tx
      };
    });
    
    // Save to JSON files
    const outputDir = path.join(process.cwd(), 'incorrect-deploys-export');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    const file1 = path.join(outputDir, `incorrect-deploys-numSquares-lt-25-squares-empty-${timestamp}.json`);
    fs.writeFileSync(file1, JSON.stringify(combined1, null, 2));
    console.log(`Saved ${combined1.length} records to ${file1}`);
    
    const file2 = path.join(outputDir, `incorrect-deploys-numSquares-25-squares-25-${timestamp}.json`);
    fs.writeFileSync(file2, JSON.stringify(combined2, null, 2));
    console.log(`Saved ${combined2.length} records to ${file2}`);
    
    // Create summary
    const summary = {
      timestamp: new Date().toISOString(),
      incorrectDeploys1: {
        count: incorrectDeploys1.length,
        description: 'numSquares < 25 but squares = []',
        file: path.basename(file1)
      },
      incorrectDeploys2: {
        count: incorrectDeploys2.length,
        description: 'numSquares = 25 but squares.length = 25',
        file: path.basename(file2)
      }
    };
    
    const summaryFile = path.join(outputDir, `summary-${timestamp}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`Saved summary to ${summaryFile}`);
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run if executed directly
if (require.main === module) {
  exportIncorrectDeploys()
    .then(() => {
      console.log('Export completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Export failed:', error);
      process.exit(1);
    });
}

export { exportIncorrectDeploys };

