# Reset ETL Implementation Summary

## Overview
Successfully implemented ResetETL to parse and save Reset events from raw transactions in the ETL pipeline.

## Challenge
Reset events are emitted via Steel framework's `program_log()` which **does NOT** create standard "Program data:" logs like Anchor. Database only contains:
- Debug logs: "Ore accounts", "Entropy accounts"
- Entropy logs: "var slothash", "var seed", "var value"
- No "Program data:" event logs

## Solution: Reconstruction Approach

Parse Reset events by **reconstructing** from available data:

### 1. Winning Square Calculation
```typescript
// Extract var value from logs
const varValueLog = logs.find(l => l.includes('var value:'));
// "Program log: var value: 2ceAGfRYcQzG1u5haXJKFtF6aPdawkFMKigB176FL8SU"

// Decode base58 to 32-byte hash
const varValue = bs58.decode(varValueBase58);

// Calculate RNG (XOR 4 chunks of 8 bytes)
const r1 = varValue.readBigUInt64LE(0);
const r2 = varValue.readBigUInt64LE(8);
const r3 = varValue.readBigUInt64LE(16);
const r4 = varValue.readBigUInt64LE(24);
const rng = r1 ^ r2 ^ r3 ^ r4;

// Get winning square
const winningSquare = Number(rng % 25n);
```

### 2. Total Minted Extraction
```typescript
// Compare token balances before/after
const preAmount = BigInt(preTokenBalances[0].uiTokenAmount.amount);
const postAmount = BigInt(postTokenBalances[0].uiTokenAmount.amount);
const totalMinted = Number(postAmount - preAmount); // in grams
```

### 3. Round ID Extraction
```typescript
// Query Deploy transaction before Reset (within 1000 slots)
const deployTx = await collection.findOne({
  slot: { $lt: resetTx.slot, $gt: resetTx.slot - 1000 },
  'parsedData.meta.logMessages': { $regex: 'Round #' }
}, { sort: { slot: -1 } });

// Extract from log: "Program log: Round #52641: deploying 0.1 SOL to 5 squares"
const deployLog = deployTx.parsedData.meta.logMessages
  .find(l => l.includes('Round #'));
const roundMatch = deployLog.match(/Round #(\d+)/);
const roundId = parseInt(roundMatch[1]);
```

### 4. Treasury Vaulted SOL
```typescript
// Find account with significant SOL balance increase
for (let i = 0; i < preBalances.length; i++) {
  const change = postBalances[i] - preBalances[i];
  if (change > 100_000_000) { // > 0.1 SOL
    totalVaulted = change; // in lamports
    break;
  }
}
```

## Files Created

1. **src/etl/reset-etl.ts** - Main ResetETL class
   - Fetches transactions with "var slothash" log
   - Reconstructs ResetEvent from logs + balance changes
   - Saves to `resets` collection

2. **src/etl/run-reset.ts** - Standalone runner
   - Execute: `npm run etl:reset`

3. **test/etl/reset-etl.test.ts** - Comprehensive tests
   - 10 test cases covering all scenarios
   - All tests pass ✅

## Files Modified

1. **src/etl/activity-parser.ts**
   - Added `'reset'` to ActivityType
   - Added ResetActivity to ParsedActivity union
   - Added reset parser to PARSERS array
   - Added reset persistence logic

2. **src/etl/run-all.ts**
   - Added ResetETL to run-all pipeline

3. **package.json**
   - Added `"etl:reset"` npm script

4. **test/fixtures/sample-events.json**
   - Added `reset` section with sample transaction

## Test Results

```
Test Suites: 12 passed, 12 total
Tests:       124 passed, 124 total
✅ All tests pass!
```

### Real Database Test Results

```
Round ID: 52715, Slot: 379965033, Winning Square: 8
Round ID: 52714, Slot: 379964821, Winning Square: 17
Round ID: 52713, Slot: 379964612, Winning Square: 10
✅ RoundId extraction working perfectly!
```

## Usage

### Run Reset ETL Standalone
```bash
npm run etl:reset
```

### Run All ETLs (Including Reset)
```bash
npm run etl:all
```

### Test
```bash
npm test -- reset-etl.test.ts
```

## Data Extracted

From Reset transactions tested:
- ✅ Round ID: 52715, 52714, 52713, ... (extracted from Deploy logs)
- ✅ Winning Square: 0-24 (properly distributed)
- ✅ Total Minted: ~1.2 ORE per round (1.0 + 0.2 motherlode)
- ✅ Treasury Vaulted: ~1.6-1.8 SOL per round
- ✅ Success status tracking

## Winning Square Distribution (10 samples)
- Square 2: 1 time
- Square 5: 1 time  
- Square 6: 1 time
- Square 7: 1 time
- Square 11: 1 time
- Square 16: 1 time
- Square 17: 1 time
- Square 19: 2 times
- Square 24: 1 time

## Notes

### Fields with Full Data
- ✅ `signature`, `slot`, `blockTime`, `success`
- ✅ `roundId` (from Deploy logs before Reset)
- ✅ `winningSquare` (calculated from var value)
- ✅ `totalMinted` (from token balance delta)
- ✅ `totalVaulted` (from SOL balance delta)

### Fields with Defaults (Require Additional Data)
- ⚠️ `startSlot`, `endSlot`: Set to tx.slot (approximate)
- ⚠️ `topMiner`: Empty hex string (would need Round account state)
- ⚠️ `numWinners`: Set to 0 (would need Round account state)
- ⚠️ `motherlode`: Set to 0 (would need to check trigger)
- ⚠️ `totalDeployed`, `totalWinnings`: Set to 0 (would need Round account)

## Future Enhancements

To get complete data, could add:
1. Round account state lookup from on-chain data
2. Parse Round PDA to extract roundId
3. Decode Round account data for numWinners, totalDeployed, etc.
4. Check motherlode trigger condition from RNG

## Verification

Created working prototype: `parse-reset-from-raw.js`
- Successfully parsed 10 Reset events
- Verified winning_square calculation
- Confirmed reconstruction approach works

