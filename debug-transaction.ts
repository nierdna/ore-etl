/**
 * Debug specific transaction to find why squares cannot be parsed
 */

import { MongoClient } from 'mongodb';
import * as bs58 from 'bs58';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

const SIGNATURE = '3KXCsor5o9JKVGY8qg1T5Jh9A72pCYgrV9dJMNX2bDywnADp9UJHxSKvFZqpXFTmq2tpf4R726L9c3wGYL954DiN';

function decodeInstructionData(dataString: string): Buffer | null {
  if (!dataString) return null;
  
  try {
    const decoded = bs58.decode(dataString);
    return Buffer.from(decoded);
  } catch (error) {
    try {
      return Buffer.from(dataString, 'base64');
    } catch (innerError) {
      return null;
    }
  }
}

function parseDeployInstruction(dataString: string): any | null {
  try {
    const data = decodeInstructionData(dataString);
    if (!data || data.length < 13) return null;
    
    const instructionType = data[0];
    if (instructionType !== 6) return null;
    
    const amount = data.readBigUInt64LE(1);
    const amountSOL = Number(amount) / 1e9;
    const mask = data.readUInt32LE(9);
    
    const squares: number[] = [];
    for (let i = 0; i < 25; i++) {
      if (mask & (1 << i)) {
        squares.push(i);
      }
    }
    
    return {
      instructionType,
      amount: amount.toString(),
      amountSOL,
      mask,
      maskHex: '0x' + mask.toString(16),
      squares,
      squaresLength: squares.length
    };
  } catch (error) {
    return null;
  }
}

async function debugTransaction() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB\n');
    
    const db = client.db('ore');
    const collection = db.collection('transactions');
    
    const tx = await collection.findOne({ signature: SIGNATURE });
    
    if (!tx) {
      console.error('Transaction not found');
      return;
    }
    
    console.log('='.repeat(80));
    console.log(`Transaction: ${tx.signature}`);
    console.log(`Slot: ${tx.slot}`);
    console.log(`BlockTime: ${tx.blockTime}`);
    console.log(`Error: ${tx.err || 'null'}`);
    console.log('='.repeat(80));
    
    // Parse log messages
    const logMessages = tx.parsedData?.meta?.logMessages || [];
    console.log('\n📋 LOG MESSAGES:');
    console.log('-'.repeat(80));
    const deployLogs = logMessages.filter((l: string) => l.includes('deploying'));
    deployLogs.forEach((log: string) => {
      console.log(`  ${log}`);
    });
    
    // Find deploy log
    const deployLogMatch = logMessages.find((l: string) => l.match(/deploying.*SOL to \d+ squares/));
    if (deployLogMatch) {
      const match = deployLogMatch.match(/deploying ([\d.]+) SOL to (\d+) squares/);
      if (match) {
        console.log(`\n✅ Deploy Log Found:`);
        console.log(`   Amount: ${match[1]} SOL`);
        console.log(`   NumSquares: ${match[2]}`);
      }
    }
    
    // Check main instructions
    const instructions = tx.parsedData?.transaction?.message?.instructions || [];
    console.log(`\n📦 MAIN INSTRUCTIONS (${instructions.length} total):`);
    console.log('-'.repeat(80));
    
    let deployInstructionCount = 0;
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      console.log(`\n[${i}] Instruction:`);
      console.log(`    Program ID: ${JSON.stringify(ix.programId)}`);
      console.log(`    Data: "${ix.data}"`);
      console.log(`    Data length: ${ix.data?.length || 0}`);
      console.log(`    Accounts: ${ix.accounts?.length || 0}`);
      
      if (ix.data && typeof ix.data === 'string') {
        const decoded = decodeInstructionData(ix.data);
        if (decoded) {
          console.log(`    Decoded length: ${decoded.length} bytes`);
          console.log(`    Decoded hex: ${decoded.toString('hex')}`);
          console.log(`    First byte: ${decoded[0]} (type: ${decoded[0] === 6 ? 'Deploy ✅' : 'Other'})`);
          
          if (decoded.length >= 13 && decoded[0] === 6) {
            deployInstructionCount++;
            const parsed = parseDeployInstruction(ix.data);
            if (parsed) {
              console.log(`    ✅ DEPLOY INSTRUCTION FOUND!`);
              console.log(`       Amount: ${parsed.amountSOL} SOL`);
              console.log(`       Mask: ${parsed.mask} (${parsed.maskHex})`);
              console.log(`       Squares: ${JSON.stringify(parsed.squares)}`);
              console.log(`       Squares Length: ${parsed.squaresLength}`);
            }
          } else if (decoded.length > 0) {
            console.log(`    ⚠️  Not a Deploy instruction or too short`);
          }
        } else {
          console.log(`    ❌ Failed to decode data`);
        }
      }
    }
    
    // Check inner instructions
    const innerInstructions = tx.parsedData?.meta?.innerInstructions || [];
    console.log(`\n📦 INNER INSTRUCTIONS (${innerInstructions.length} groups):`);
    console.log('-'.repeat(80));
    
    let innerDeployCount = 0;
    for (let groupIdx = 0; groupIdx < innerInstructions.length; groupIdx++) {
      const group = innerInstructions[groupIdx];
      console.log(`\n[Group ${groupIdx}] Index: ${group.index}, Instructions: ${group.instructions?.length || 0}`);
      
      if (group.instructions) {
        for (let i = 0; i < group.instructions.length; i++) {
          const ix = group.instructions[i];
          console.log(`  [${i}] Instruction:`);
          console.log(`      Program: ${ix.program || 'N/A'}`);
          console.log(`      Data: "${ix.data}"`);
          
          if (ix.data && typeof ix.data === 'string') {
            const decoded = decodeInstructionData(ix.data);
            if (decoded) {
              console.log(`      Decoded length: ${decoded.length} bytes`);
              console.log(`      Decoded hex: ${decoded.toString('hex')}`);
              console.log(`      First byte: ${decoded[0]} (type: ${decoded[0] === 6 ? 'Deploy ✅' : 'Other'})`);
              
              if (decoded.length >= 13 && decoded[0] === 6) {
                innerDeployCount++;
                const parsed = parseDeployInstruction(ix.data);
                if (parsed) {
                  console.log(`      ✅ DEPLOY INSTRUCTION FOUND IN INNER!`);
                  console.log(`         Amount: ${parsed.amountSOL} SOL`);
                  console.log(`         Mask: ${parsed.mask} (${parsed.maskHex})`);
                  console.log(`         Squares: ${JSON.stringify(parsed.squares)}`);
                  console.log(`         Squares Length: ${parsed.squaresLength}`);
                }
              }
            }
          }
        }
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log('-'.repeat(80));
    console.log(`Main Deploy Instructions found: ${deployInstructionCount}`);
    console.log(`Inner Deploy Instructions found: ${innerDeployCount}`);
    console.log(`Total Deploy Instructions: ${deployInstructionCount + innerDeployCount}`);
    
    if (deployInstructionCount === 0 && innerDeployCount === 0) {
      console.log('\n❌ NO DEPLOY INSTRUCTION FOUND!');
      console.log('   This might be why squares cannot be parsed.');
    } else if (deployInstructionCount + innerDeployCount > 0) {
      console.log('\n⚠️  Deploy instruction(s) found but mask = 0 or squares = []');
      console.log('   This might be a special case where mask = 0 means all squares.');
    }
    
    // Check if there are any other clues in logs
    console.log('\n🔍 ADDITIONAL LOG ANALYSIS:');
    console.log('-'.repeat(80));
    const allLogs = logMessages.filter((l: string) => l.startsWith('Program log:'));
    allLogs.forEach((log: string) => {
      if (log.includes('square') || log.includes('Square') || log.includes('entropy') || log.includes('Entropy')) {
        console.log(`  ${log}`);
      }
    });
    
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
  debugTransaction()
    .then(() => {
      console.log('\nDebug completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Debug failed:', error);
      process.exit(1);
    });
}

export { debugTransaction };

