# Squares Reconstruction for Automation Transactions

## Overview

This document explains how squares are reconstructed for automation transactions that use the Random strategy when the instruction data has `mask = 0`.

## Problem

When automation transactions use the Random strategy, the ORE program generates squares deterministically from a hash of `authority + roundId`. The instruction data contains `mask = 0`, so the parser cannot extract squares directly from the instruction.

## Solution

We can reconstruct the squares by replicating the same algorithm used in the Rust program:

1. Decode authority from base58 to 32-byte buffer
2. Convert roundId to 8-byte little-endian buffer  
3. Concatenate: `authority_bytes + roundId_bytes`
4. Hash with keccak256 (matches Solana's `hashv`)
5. Generate random mask from hash using the same algorithm as Rust

## Implementation

### Location
- **Utility functions**: `src/utils/squares-reconstructor.ts`
- **Integration**: `src/etl/deploy-etl.ts`

### Functions

#### `generateRandomMask(numSquares: number, hashBytes: Buffer): number[]`
Port of Rust `generate_random_mask()` function. Uses hash bytes to probabilistically select squares.

#### `reconstructSquaresForAutomation(authority: string, roundId: number, numSquares: number): number[]`
Main function that reconstructs squares by:
1. Decoding authority from base58
2. Converting roundId to little-endian bytes
3. Hashing with keccak256
4. Generating mask from hash

### Usage

The reconstruction is automatically called in `DeployETL.processTransaction()` when:
- `mask = 0` (no squares in instruction data)
- `numSquares < 25` (not deploying to all squares)
- `isAutomation = true` (automation transaction)
- `authority !== 'unknown'` (authority is known)

### Example

```typescript
// Transaction: 3KXCsor5o9JKVGY8qg1T5Jh9A72pCYgrV9dJMNX2bDywnADp9UJHxSKvFZqpXFTmq2tpf4R726L9c3wGYL954DiN
const authority = '6CLc9s3qhkf3QQqcm7HX1isim7Go9LDCZRrne2uKnhzJ';
const roundId = 47152;
const numSquares = 21;

const squares = reconstructSquaresForAutomation(authority, roundId, numSquares);
// Result: [0,1,2,3,4,5,7,8,9,10,11,13,14,15,16,17,19,20,21,22,23]
```

## Algorithm Details

### Hash Generation (matches Rust `hashv`)
```rust
// Rust code from deploy.rs
let r = hashv(&[&automation.authority.to_bytes(), &round.id.to_le_bytes()]).0;
```

```typescript
// TypeScript equivalent
const authorityBytes = bs58.decode(authority); // 32 bytes
const roundIdBytes = Buffer.alloc(8);
roundIdBytes.writeBigUInt64LE(BigInt(roundId), 0); // 8 bytes
const combined = Buffer.concat([authorityBytes, roundIdBytes]); // 40 bytes
const hashHex = keccak256(combined); // 32-byte hash as hex string
const hashBytes = Buffer.from(hashHex, 'hex'); // 32 bytes
```

### Random Mask Generation (matches Rust `generate_random_mask`)
```rust
// Rust code from deploy.rs
fn generate_random_mask(num_squares: u64, r: &[u8]) -> [bool; 25] {
    let mut new_mask = [false; 25];
    let mut selected = 0;
    for i in 0..25 {
        let rand_byte = r[i];
        let remaining_needed = num_squares as u64 - selected as u64;
        let remaining_positions = 25 - i;
        if remaining_needed > 0
            && (rand_byte as u64) * (remaining_positions as u64) < (remaining_needed * 256)
        {
            new_mask[i] = true;
            selected += 1;
        }
    }
    new_mask
}
```

The TypeScript implementation matches this exactly.

## Limitations

1. **Only works for automation transactions**: Non-automation transactions with `mask = 0` cannot be reconstructed
2. **Requires known authority**: If `authority = 'unknown'`, reconstruction is skipped
3. **Only for Random strategy**: Preferred strategy uses the mask directly, so reconstruction is not needed

## Testing

Tests are located in `test/utils/squares-reconstructor.test.ts`:
- Tests `generateRandomMask()` with various inputs
- Tests `reconstructSquaresForAutomation()` with known transaction
- Tests edge cases (numSquares = 0, 1, 24, 25)

## Dependencies

- `js-sha3`: For keccak256 hashing (matches Solana's implementation)
- `bs58`: For decoding authority pubkey from base58

