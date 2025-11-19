/**
 * Test the fixed deploy parser with incorrect transactions
 */

import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { DeployETL } from './src/etl/deploy-etl';
import { MongoManager } from './src/database/mongo-manager';
import { RawTransaction } from './src/types/schemas';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

async function testFixedParser() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const mongoManager = new MongoManager();
    await mongoManager.connect();
    
    const deployETL = new DeployETL(mongoManager);
    
    // Load exported incorrect transactions
    const exportDir = path.join(process.cwd(), 'incorrect-deploys-export');
    const files = fs.readdirSync(exportDir)
      .filter(f => f.startsWith('incorrect-deploys-') && f.endsWith('.json'))
      .sort()
      .reverse(); // Get latest files
    
    if (files.length === 0) {
      console.error('No exported files found');
      return;
    }
    
    // Test with first few transactions from each file
    for (const file of files.slice(0, 2)) {
      const filePath = path.join(exportDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      
      console.log(`\n=== Testing with ${file} ===`);
      console.log(`Total records: ${data.length}`);
      
      // Test first 3 transactions
      const testTransactions = data.slice(0, 3);
      
      for (const item of testTransactions) {
        if (!item.rawTransaction) {
          console.log(`Skipping ${item.deploy.signature} - no raw transaction`);
          continue;
        }
        
        const tx = item.rawTransaction as RawTransaction;
        const originalDeploy = item.deploy;
        
        console.log(`\n--- Testing transaction: ${tx.signature} ---`);
        console.log(`Original: numSquares=${originalDeploy.numSquares}, squares.length=${originalDeploy.squares?.length || 0}`);
        
        try {
          const parsed = await deployETL.processTransaction(tx);
          
          if (parsed) {
            console.log(`Parsed: numSquares=${parsed.numSquares}, squares.length=${parsed.squares?.length || 0}`);
            console.log(`Squares: ${JSON.stringify(parsed.squares)}`);
            
            // Check if it's now correct
            const squaresLength = parsed.squares?.length || 0;
            const isCorrect1 = parsed.numSquares < 25 && parsed.numSquares === squaresLength;
            const isCorrect2 = parsed.numSquares === 25 && squaresLength === 0;
            const isCorrect = isCorrect1 || isCorrect2;
            
            console.log(`Status: ${isCorrect ? '✅ CORRECT' : '❌ STILL INCORRECT'}`);
            
            if (!isCorrect) {
              console.log(`  - numSquares: ${parsed.numSquares}`);
              console.log(`  - squares.length: ${squaresLength}`);
              console.log(`  - squaresMask: ${parsed.squaresMask}`);
            }
          } else {
            console.log('❌ Failed to parse transaction');
          }
        } catch (error) {
          console.error(`Error parsing: ${error}`);
        }
      }
    }
    
    await mongoManager.disconnect();
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run if executed directly
if (require.main === module) {
  testFixedParser()
    .then(() => {
      console.log('\nTest completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testFixedParser };

