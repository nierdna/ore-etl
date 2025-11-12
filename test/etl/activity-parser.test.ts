import { parseRawTransaction, ParsedActivity, ActivityType } from '../../src/etl/activity-parser';
import { RawTransaction } from '../../src/types/schemas';
import samplesData from '../fixtures/sample-events.json';

const samples = samplesData as any;

const GRAMS_PER_ORE = 100_000_000_000;

function withLogs(rawTx: any, logFilter: (log: string) => boolean): RawTransaction {
  return {
    ...rawTx,
    parsedData: {
      ...rawTx.parsedData,
      meta: {
        ...rawTx.parsedData.meta,
        logMessages: rawTx.parsedData.meta.logMessages.filter(logFilter),
      },
    },
  } as RawTransaction;
}

function buildClaimYieldTransaction(amountORE: number): RawTransaction {
  return {
    _id: undefined as any,
    signature: 'yieldTxSignature',
    slot: 987654321,
    blockTime: 1700000000,
    err: null,
    parsedData: {
      meta: {
        logMessages: [`Program log: Claiming ${amountORE} ORE`],
      },
      transaction: {
        message: {
          instructions: [
            {
              data: 'D',
              accounts: [
                'Signer1111111111111111111111111111111111',
                'Mint111111111111111111111111111111111111',
                'Recipient1111111111111111111111111111111',
                'Stake11111111111111111111111111111111111',
                'Treasury1111111111111111111111111111111',
                'TreasuryTok11111111111111111111111111111',
                'Sys111111111111111111111111111111111111',
                'Token1111111111111111111111111111111111',
                'Assoc1111111111111111111111111111111111',
              ],
            },
          ],
          accountKeys: [{ pubkey: 'Signer1111111111111111111111111111111111' }],
        },
      },
    },
    createdAt: new Date(),
  } as unknown as RawTransaction;
}

function expectActivity<T extends ActivityType>(
  parsed: ParsedActivity | undefined,
  type: T
): asserts parsed is Extract<ParsedActivity, { activityType: T }> {
  expect(parsed).toBeDefined();
  expect(parsed!.activityType).toBe(type);
}

describe('Activity Parser Router', () => {
  it('should parse deploy transaction', async () => {
    const rawTx = withLogs(samples.deploys[0], (log: string) => log.includes('deploying'));
    const parsed = await parseRawTransaction(rawTx);

    const deploy = parsed.find(a => a.activityType === 'deploy');
    expectActivity(deploy, 'deploy');
    expect(deploy.numSquares).toBeGreaterThan(0);
    expect(deploy.signature).toBe(rawTx.signature);
  });

  it('should parse checkpoint transaction', async () => {
    const rawTx = samples.checkpoints[0];
    const parsed = await parseRawTransaction(rawTx);

    const checkpoint = parsed.find(a => a.activityType === 'checkpoint');
    expectActivity(checkpoint, 'checkpoint');
    expect(checkpoint.roundId).toBeGreaterThan(0);
    expect(checkpoint.totalRewardsSOL).toBeGreaterThanOrEqual(0);
  });

  it('should parse claim SOL transaction', async () => {
    const rawTx = samples.claims_sol[0];
    const parsed = await parseRawTransaction(rawTx);

    const claimSol = parsed.find(a => a.activityType === 'claim_sol');
    expectActivity(claimSol, 'claim_sol');
    expect(claimSol.amountSOL).toBeGreaterThan(0);
  });

  it('should parse claim ORE transaction', async () => {
    const rawTx = samples.claims_ore[0];
    const parsed = await parseRawTransaction(rawTx);

    const claimOre = parsed.find(a => a.activityType === 'claim_ore');
    expectActivity(claimOre, 'claim_ore');
    expect(claimOre.amountORE).toBeGreaterThan(0);
  });

  it('should parse claim ORE transaction with embedded SOL claim', async () => {
    const rawTx = samples.claims_ore[0];
    const parsed = await parseRawTransaction(rawTx);

    const claimOre = parsed.find(a => a.activityType === 'claim_ore');
    const claimSol = parsed.find(a => a.activityType === 'claim_sol');

    expectActivity(claimOre, 'claim_ore');
    expectActivity(claimSol, 'claim_sol');

    expect(claimOre.amountORE).toBeGreaterThan(0);
    expect(claimSol.amountSOL).toBeGreaterThan(0);
  });

  it('should parse deposit transaction', async () => {
    const rawTx = samples.deposits[0];
    const parsed = await parseRawTransaction(rawTx);

    const deposit = parsed.find(a => a.activityType === 'deposit');
    expectActivity(deposit, 'deposit');
    expect(deposit.amountORE).toBeGreaterThan(0);
  });

  it('should parse withdraw transaction', async () => {
    const rawTx = samples.withdraws[0];
    const parsed = await parseRawTransaction(rawTx);

    const withdraw = parsed.find(a => a.activityType === 'withdraw');
    expectActivity(withdraw, 'withdraw');
    expect(withdraw.amountORE).toBeGreaterThan(0);
  });

  it('should parse bury transaction', async () => {
    const rawTx = samples.bury[0];
    const parsed = await parseRawTransaction(rawTx);

    const bury = parsed.find(a => a.activityType === 'bury');
    expectActivity(bury, 'bury');
    expect(bury.solSwappedAmount).toBeGreaterThan(0);
    expect(bury.oreBurnedAmount).toBeGreaterThan(0);
  });

  it('should parse synthetic claim yield transaction', async () => {
    const amountORE = 0.12345678901;
    const rawTx = buildClaimYieldTransaction(amountORE);
    const parsed = await parseRawTransaction(rawTx);

    const claimYield = parsed.find(a => a.activityType === 'claim_yield');
    expectActivity(claimYield, 'claim_yield');
    expect(claimYield.amountORE).toBeCloseTo(amountORE, 12);
    expect(claimYield.amount).toBe(Math.round(amountORE * GRAMS_PER_ORE));

    const maybeClaimOre = parsed.find(a => a.activityType === 'claim_ore');
    if (maybeClaimOre) {
      expect(maybeClaimOre.amountORE).toBeCloseTo(amountORE, 12);
    }
  });

  it('should return null for unsupported transactions', async () => {
    const rawTx = {
      signature: 'unknownTx',
      slot: 1,
      blockTime: 123,
      err: null,
      parsedData: {
        meta: {
          logMessages: ['Program log: Unrelated message'],
        },
        transaction: {
          message: {
            instructions: [],
            accountKeys: [],
          },
        },
      },
      createdAt: new Date(),
      _id: undefined as any,
    } as RawTransaction;

    const parsed = await parseRawTransaction(rawTx);
    expect(parsed).toEqual([]);
  });
});
