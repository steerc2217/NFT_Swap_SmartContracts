import { Provider } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import airdropTokens from './airdropTokens';

const makerAmount = 1;
const takerAmount = 2;

export default async function initializeState({
  provider,
  maker,
  taker,
  mintAuthority,
  program,
}: {
  provider: Provider;
  maker: Keypair;
  taker: Keypair;
  mintAuthority: Keypair;
  program: any;
}) {
  await airdropTokens({ provider, maker, taker, mintAuthority });

  const mintA = await Token.createMint(
    provider.connection,
    maker,
    mintAuthority.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID,
  );

  const mintB = await Token.createMint(
    provider.connection,
    taker,
    mintAuthority.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID,
  );

  const mintC = await Token.createMint(
    provider.connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID,
  );

  const makerTokenA = await mintA.createAssociatedTokenAccount(maker.publicKey);
  const makerTokenB = await mintB.createAssociatedTokenAccount(maker.publicKey);

  const takerTokenA = await mintA.createAssociatedTokenAccount(taker.publicKey);
  const takerTokenB = await mintB.createAssociatedTokenAccount(taker.publicKey);
  const takerTokenC = await mintC.createAssociatedTokenAccount(taker.publicKey);

  await mintA.mintTo(makerTokenA, mintAuthority.publicKey, [mintAuthority], makerAmount);

  await mintB.mintTo(takerTokenB, mintAuthority.publicKey, [mintAuthority], takerAmount);

  await mintC.mintTo(takerTokenC, mintAuthority.publicKey, [mintAuthority], takerAmount);

  const escrowState = Keypair.generate();

  // Get the PDA that is assigned authority to token account.
  const [_pda, _bump] = await PublicKey.findProgramAddress(
    [escrowState.publicKey.toBuffer()],
    program.programId,
  );

  const escrowVault = _pda;
  const vaultBump = _bump;

  return {
    mintA,
    mintB,
    mintC,
    makerTokenA,
    makerTokenB,

    takerTokenA,
    takerTokenB,
    takerTokenC,

    escrowState,
    escrowVault,
    vaultBump,
    makerAmount,
    takerAmount,
  };
}

export async function initialStateTests({
  mintA,
  mintB,
  mintC,
  makerTokenA,
  makerTokenB,
  takerTokenA,
  takerTokenB,
  takerTokenC,
  maker,
  taker,
}: {
  mintA: Token;
  mintB: Token;
  mintC: Token;
  makerTokenA: PublicKey;
  makerTokenB: PublicKey;
  takerTokenA: PublicKey;
  takerTokenB: PublicKey;
  takerTokenC: PublicKey;
  maker: Keypair;
  taker: Keypair;
}) {
  const _makerTokenA = await mintA.getAccountInfo(makerTokenA);
  const _makerTokenB = await mintB.getAccountInfo(makerTokenB);

  const _takerTokenA = await mintA.getAccountInfo(takerTokenA);
  const _takerTokenB = await mintB.getAccountInfo(takerTokenB);
  const _takerTokenC = await mintC.getAccountInfo(takerTokenC);
  expect(_makerTokenA.owner).toEqual(maker.publicKey);
  expect(_makerTokenB.owner).toEqual(maker.publicKey);
  expect(_takerTokenA.owner).toEqual(taker.publicKey);
  expect(_takerTokenB.owner).toEqual(taker.publicKey);
  expect(_takerTokenC.owner).toEqual(taker.publicKey);

  expect(_makerTokenA.amount.toNumber()).toBe(makerAmount);
  expect(_takerTokenA.amount.toNumber()).toBe(0);
  expect(_makerTokenB.amount.toNumber()).toBe(0);
  expect(_takerTokenB.amount.toNumber()).toBe(takerAmount);
  expect(_takerTokenC.amount.toNumber()).toBe(takerAmount);
}
