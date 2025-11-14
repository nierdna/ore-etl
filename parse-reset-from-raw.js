/**
 * Parse ResetEvent từ raw transaction (reconstruct)
 * Vì Steel program_log không tạo "Program data:" logs
 * Run: node parse-reset-from-raw.js
 */

const { MongoClient } = require('mongodb');
const bs58 = require('bs58');
const URI = 'mongodb://mongo:SMgVCOWRBjrAJxOvfVdkajdJjvAJRHTr@turntable.proxy.rlwy.net:56417';

/**
 * Calculate RNG từ var value (theo logic trong round.rs)
 */
function calculateRNG(varValueBase58) {
  // Decode base58 to 32-byte buffer
  const buf = Buffer.from(bs58.decode(varValueBase58));
  
  // XOR 4 chunks of 8 bytes
  const r1 = buf.readBigUInt64LE(0);
  const r2 = buf.readBigUInt64LE(8);
  const r3 = buf.readBigUInt64LE(16);
  const r4 = buf.readBigUInt64LE(24);
  
  return r1 ^ r2 ^ r3 ^ r4;
}

/**
 * Parse ResetEvent từ raw transaction
 */
function parseResetEventFromRaw(tx) {
  const logs = tx.parsedData?.meta?.logMessages || [];
  
  // 1. Verify đây là Reset transaction
  const hasVarSlothash = logs.some(l => l.includes('var slothash'));
  if (!hasVarSlothash) {
    return null;
  }
  
  // 2. Extract var value để tính winning_square
  const varValueLog = logs.find(l => l.includes('var value:'));
  if (!varValueLog) {
    console.log('Warning: No var value log found');
    return null;
  }
  
  // Parse: "Program log: var value: 7u81ZVSskPpm6ik5NkoMtjWSrchBeypKDb1qALePDTLf"
  const varValueMatch = varValueLog.match(/var value: ([A-Za-z0-9]+)/);
  if (!varValueMatch) {
    console.log('Warning: Could not parse var value');
    return null;
  }
  
  const varValue = varValueMatch[1];
  
  // 3. Calculate RNG và winning_square
  const rng = calculateRNG(varValue);
  const winningSquare = Number(rng % 25n);
  
  // 4. Extract total_minted từ token balance changes
  const preTokenBalances = tx.parsedData.meta.preTokenBalances || [];
  const postTokenBalances = tx.parsedData.meta.postTokenBalances || [];
  
  let totalMinted = 0;
  if (preTokenBalances.length > 0 && postTokenBalances.length > 0) {
    const preAmount = BigInt(preTokenBalances[0].uiTokenAmount.amount);
    const postAmount = BigInt(postTokenBalances[0].uiTokenAmount.amount);
    totalMinted = Number(postAmount - preAmount) / 1e11; // Convert to ORE
  }
  
  // 5. Extract SOL balance changes để estimate total_deployed, vaulted, winnings
  const preBalances = tx.parsedData.meta.preBalances || [];
  const postBalances = tx.parsedData.meta.postBalances || [];
  
  // Treasury index (usually index 9 hoặc tìm bằng cách check balance change lớn)
  let treasuryBalanceChange = 0;
  for (let i = 0; i < preBalances.length; i++) {
    const change = postBalances[i] - preBalances[i];
    if (change > 100_000_000) { // > 0.1 SOL increase
      treasuryBalanceChange = change;
      break;
    }
  }
  
  // 6. Extract roundId từ Round account creation
  // Inner instruction tạo Round account mới
  const innerInstructions = tx.parsedData.meta.innerInstructions || [];
  let roundId = null;
  
  for (const inner of innerInstructions) {
    for (const ix of inner.instructions) {
      if (ix.parsed?.type === 'createAccount' && 
          ix.parsed.info?.owner === 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv' &&
          ix.parsed.info?.space === 560) {
        // This is new Round account - extract roundId from address
        // For now, use null (cần derive từ PDA hoặc previous round)
        roundId = null; // TODO: derive from account address
      }
    }
  }
  
  return {
    type: 'ResetEvent',
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    roundId: roundId,
    winningSquare: winningSquare,
    varValue: varValue,
    totalMinted: totalMinted,
    treasuryChange: treasuryBalanceChange / 1e9, // Convert to SOL
    // Note: Các fields khác cần query thêm từ Round account hoặc Board
    reconstructed: true
  };
}

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db('ore');
  
  console.log('🔍 Parsing ResetEvent từ raw transactions...\n');
  
  // Tìm Reset transactions
  const resetTxs = await db.collection('transactions')
    .find({
      'parsedData.meta.logMessages': { $regex: 'var slothash' }
    })
    .sort({ slot: -1 })
    .limit(10)
    .toArray();
  
  console.log(`Found ${resetTxs.length} Reset transactions\n`);
  console.log('='.repeat(80));
  
  const parsedEvents = [];
  
  for (const tx of resetTxs) {
    try {
      const event = parseResetEventFromRaw(tx);
      
      if (event) {
        parsedEvents.push(event);
        
        console.log(`\n✅ Reset Event ${parsedEvents.length}:`);
        console.log(`   Signature: ${event.signature.substring(0, 40)}...`);
        console.log(`   Slot: ${event.slot}`);
        console.log(`   🎯 Winning Square: ${event.winningSquare}`);
        console.log(`   Var Value: ${event.varValue}`);
        console.log(`   Total Minted: ${event.totalMinted.toFixed(4)} ORE`);
        console.log(`   Treasury Change: ${event.treasuryChange.toFixed(4)} SOL`);
        if (event.roundId) {
          console.log(`   Round ID: ${event.roundId}`);
        }
      }
    } catch (error) {
      console.log(`❌ Error parsing ${tx.signature.substring(0, 20)}...: ${error.message}`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Summary: Successfully parsed ${parsedEvents.length}/${resetTxs.length} Reset events`);
  
  if (parsedEvents.length > 0) {
    console.log('\n📈 Winning Squares Distribution:');
    const squareCounts = {};
    parsedEvents.forEach(e => {
      squareCounts[e.winningSquare] = (squareCounts[e.winningSquare] || 0) + 1;
    });
    
    Object.entries(squareCounts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([square, count]) => {
        console.log(`   Square ${square}: ${count} times`);
      });
  }
  
  await client.close();
  console.log('\n✅ Parse complete!');
}

main().catch(console.error);

