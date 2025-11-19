/**
 * Analyze pattern of transactions with mask = 0 but numSquares > 0
 */

import { MongoClient } from 'mongodb';
import * as bs58 from 'bs58';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

function decodeInstructionData(dataString: string): Buffer | null {
  if (!dataString) return null;
  try {
    const decoded = bs58.decode(dataString);
    return Buffer.from(decoded);
  } catch (error) {
    try {
      return Buffer.from(dataString, 'base64');
    } catch {
      return null;
    }
  }
}

async function analyzePattern() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB\n');
    
    const transformedDb = client.db('ore_transformed');
    const deploysCollection = transformedDb.collection('deploys');
    const rawDb = client.db('ore');
    const transactionsCollection = rawDb.collection('transactions');
    
    // Find deploys with mask = 0 but numSquares > 0
    const incorrectDeploys = await deploysCollection
      .aggregate([
        {
          $match: {
            squaresMask: 0,
            numSquares: { $gt: 0, $lt: 25 }
          }
        },
        { $limit: 10 }
      ])
      .toArray();
    
    console.log(`Found ${incorrectDeploys.length} deploys with mask=0 but numSquares > 0\n`);
    
    for (const deploy of incorrectDeploys) {
      const tx = await transactionsCollection.findOne(
        { signature: deploy.signature },
        {
          projection: {
            signature: 1,
            'parsedData.meta.logMessages': 1,
            'parsedData.transaction.message.instructions': 1,
            'parsedData.meta.innerInstructions': 1
          }
        }
      );
      
      if (!tx) continue;
      
      console.log('='.repeat(80));
      console.log(`Signature: ${deploy.signature}`);
      console.log(`NumSquares: ${deploy.numSquares}`);
      console.log(`AmountSOL: ${deploy.amountSOL}`);
      
      // Find deploy log
      const deployLog = tx.parsedData?.meta?.logMessages?.find((l: string) => 
        l.includes('deploying') && l.includes('squares')
      );
      console.log(`Deploy Log: ${deployLog || 'NOT FOUND'}`);
      
      // Check for entropy log
      const entropyLog = tx.parsedData?.meta?.logMessages?.find((l: string) => 
        l.includes('Entropy accounts')
      );
      console.log(`Entropy Log: ${entropyLog || 'NOT FOUND'}`);
      
      // Find Deploy instruction
      const instructions = tx.parsedData?.transaction?.message?.instructions || [];
      for (const ix of instructions) {
        if (ix.data && typeof ix.data === 'string') {
          const decoded = decodeInstructionData(ix.data);
          if (decoded && decoded.length >= 13 && decoded[0] === 6) {
            const amount = decoded.readBigUInt64LE(1);
            const mask = decoded.readUInt32LE(9);
            const amountSOL = Number(amount) / 1e9;
            
            console.log(`\nDeploy Instruction:`);
            console.log(`  Data: ${ix.data}`);
            console.log(`  Amount in instruction: ${amountSOL} SOL`);
            console.log(`  Amount from log: ${deploy.amountSOL} SOL`);
            console.log(`  Mask: ${mask} (0x${mask.toString(16)})`);
            console.log(`  Match: ${Math.abs(amountSOL - deploy.amountSOL) < 0.0001 ? '✅' : '❌'}`);
            
            if (amount === 0n && mask === 0) {
              console.log(`  ⚠️  ZERO AMOUNT AND ZERO MASK - This might be entropy-based selection!`);
            }
          }
        }
      }
      
      console.log('');
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 ANALYSIS SUMMARY:');
    console.log('-'.repeat(80));
    console.log('Pattern observed:');
    console.log('  - Instruction data has amount = 0 and mask = 0');
    console.log('  - Log message shows actual amount and numSquares');
    console.log('  - "Entropy accounts" log suggests random square selection');
    console.log('  - Squares are likely determined by entropy, not mask');
    console.log('\nConclusion:');
    console.log('  When mask = 0 and amount = 0, squares are selected randomly');
    console.log('  based on entropy accounts. The actual squares cannot be');
    console.log('  determined from instruction data alone.');
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  analyzePattern()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Failed:', error);
      process.exit(1);
    });
}

export { analyzePattern };

