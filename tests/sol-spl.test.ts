import { Provider, setProvider, workspace, BN } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import initializeState, { initialStateTests } from './utils/initializeState';

describe('Cofre SolSpl trade', () => {
  const provider = Provider.env();
  setProvider(provider);
  const program = workspace.Cofre;

  const maker = Keypair.generate();
  const taker = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let mintB: Token;
  let makerTokenB: PublicKey;

  let takerTokenB: PublicKey;
  let takerTokenC: PublicKey;

  const makerAmount = 1;
  const takerAmount = 2;
  const makerAmountLamports = makerAmount * LAMPORTS_PER_SOL;

  let escrowState: Keypair;
  let escrowVault: PublicKey;
  let vaultBump: number;

  beforeAll(async () => {
    const initialState = await initializeState({
      provider,
      maker,
      taker,
      mintAuthority,
      program,
    });

    ({ mintB, makerTokenB, takerTokenB, takerTokenC, escrowState, escrowVault, vaultBump } =
      initialState);

    initialStateTests({
      ...initialState,
      maker,
      taker,
    });
  });

  it('Initialize', async () => {
    const makerBeforeEscrow = await provider.connection.getAccountInfo(maker.publicKey);
    const transactionSignature = await program.rpc.initialize(
      new BN(makerAmount),
      new BN(takerAmount),
      new BN(vaultBump),
      {
        accounts: {
          maker: maker.publicKey,
          fromMakerAccount: maker.publicKey,
          toMakerAccount: makerTokenB,
          escrowVault: escrowVault,
          escrowState: escrowState.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        },
        signers: [maker, escrowState],
        remainingAccounts: [{ pubkey: mintB.publicKey, isWritable: false, isSigner: false }],
      },
    );

    await provider.connection.confirmTransaction(transactionSignature, 'confirmed');

    const makerAccountInfo = await provider.connection.getAccountInfo(maker.publicKey);
    const escrowVaultAccountInfo = await provider.connection.getAccountInfo(escrowVault);
    const escrowStateAccountInfo = await provider.connection.getAccountInfo(escrowState.publicKey);
    const escrowStateAccount = await program.account.escrowState.fetch(escrowState.publicKey);

    // Check that the maker gave the amount, and paid for the escrowState
    expect(makerAccountInfo?.lamports).toBe(
      makerBeforeEscrow!.lamports - makerAmountLamports - escrowStateAccountInfo!.lamports,
    );

    // Check that the vault holds the makerAmount
    expect(escrowVaultAccountInfo?.lamports).toBe(makerAmountLamports);

    // Check that the values in the escrow account match what we expect.
    expect(escrowStateAccount.maker).toEqual(maker.publicKey);
    expect(escrowStateAccount.makerAmount.toNumber()).toBe(makerAmount);
    expect(escrowStateAccount.takerAmount.toNumber()).toBe(takerAmount);
    expect(escrowStateAccount.trade.solSpl.fromNative).toEqual(maker.publicKey);
    expect(escrowStateAccount.trade.solSpl.toToken).toEqual(makerTokenB);
    expect(escrowStateAccount.trade.solSpl.toMint).toEqual(mintB.publicKey);
    expect(escrowStateAccount.vault).toEqual(escrowVault);
  });

  it('Invalid Exchange', () => {
    expect.assertions(1);
    // Try to Exchange with the wrong taker account mint
    return program.rpc
      .exchange(new BN(vaultBump), {
        accounts: {
          taker: taker.publicKey,
          fromTakerAccount: takerTokenC,
          toTakerAccount: taker.publicKey,
          maker: maker.publicKey,
          toMakerAccount: makerTokenB,
          escrowVault: escrowVault,
          escrowState: escrowState.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        },
        signers: [taker],
      })
      .catch((err: any) => {
        expect(err.logs).toContain('Program log: Error: Account not associated with this Mint');
      });
  });

  it('Exchange', async () => {
    const makerBeforeEscrow = await provider.connection.getAccountInfo(maker.publicKey);
    const takerBeforeEscrow = await provider.connection.getAccountInfo(taker.publicKey);
    const stateBeforeEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);
    const vaultBeforeEscrow = await provider.connection.getAccountInfo(escrowVault);
    const makerBeforeEscrowTokenB = await mintB.getAccountInfo(makerTokenB);

    expect(vaultBeforeEscrow?.lamports).toBe(makerAmountLamports);

    const transactionSignature = await program.rpc.exchange(new BN(vaultBump), {
      accounts: {
        taker: taker.publicKey,
        fromTakerAccount: takerTokenB,
        toTakerAccount: taker.publicKey,
        maker: maker.publicKey,
        toMakerAccount: makerTokenB,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      signers: [taker],
    });

    await provider.connection.confirmTransaction(transactionSignature, 'confirmed');

    const makerAfterEscrowTokenB = await mintB.getAccountInfo(makerTokenB);

    const takerAfterEscrow = await provider.connection.getAccountInfo(taker.publicKey);
    const takerAfterTokenB = await mintB.getAccountInfo(takerTokenB);

    const makerAfterEscrow = await provider.connection.getAccountInfo(maker.publicKey);
    const stateAfterEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);
    const vaultAfterEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);

    // Maker gets escrowState rent
    expect(makerAfterEscrow?.lamports).toBe(
      makerBeforeEscrow!.lamports + stateBeforeEscrow!.lamports,
    );
    // Maker gets takerAmount of TokenB
    expect(makerAfterEscrowTokenB.amount.toNumber()).toBe(
      makerBeforeEscrowTokenB.amount.toNumber() + takerAmount,
    );
    // Taker gets escrowVault lamports
    expect(takerAfterEscrow?.lamports).toBe(takerBeforeEscrow!.lamports + makerAmountLamports);
    // Taker loses takerAmount of TokenB
    expect(takerAfterTokenB.amount.toNumber()).toBe(0);

    // Check that escrowState and escrowVault accounts are gone
    expect(stateAfterEscrow).toBeNull();
    expect(vaultAfterEscrow).toBeNull();
  });

  it('Cancel', async () => {
    // For some reason we need to change a value otherwise repeating the transaction takes too long and expires mocha timeout
    const newMakerAmount = makerAmount + 1;
    const newMakerAmountLamports = newMakerAmount * LAMPORTS_PER_SOL;

    const makerBeforeEscrow = await provider.connection.getAccountInfo(maker.publicKey);

    await program.rpc.initialize(new BN(newMakerAmount), new BN(takerAmount), new BN(vaultBump), {
      accounts: {
        maker: maker.publicKey,
        fromMakerAccount: maker.publicKey,
        toMakerAccount: makerTokenB,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      },
      signers: [maker, escrowState],
      remainingAccounts: [{ pubkey: mintB.publicKey, isWritable: false, isSigner: false }],
    });

    const makerDuringEscrow = await provider.connection.getAccountInfo(maker.publicKey);
    const vaultDuringEscrow = await provider.connection.getAccountInfo(escrowVault);
    const stateDuringEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);

    expect(makerDuringEscrow?.lamports).toBe(
      makerBeforeEscrow!.lamports - stateDuringEscrow!.lamports - vaultDuringEscrow!.lamports,
    );
    expect(vaultDuringEscrow!.lamports).toBe(newMakerAmountLamports);

    // Cancel the escrow.
    await program.rpc.cancel(new BN(vaultBump), {
      accounts: {
        maker: maker.publicKey,
        fromMakerAccount: maker.publicKey,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      signers: [maker],
    });

    let makerAfterCancel = await provider.connection.getAccountInfo(maker.publicKey);

    // Check all the funds were sent back there.
    expect(makerBeforeEscrow?.lamports).toBe(makerAfterCancel!.lamports);
    expect(makerAfterCancel?.lamports).toBe(
      makerDuringEscrow!.lamports + vaultDuringEscrow!.lamports + stateDuringEscrow!.lamports,
    );
  });
});
