import { Provider, setProvider, workspace, BN } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import initializeState, { initialStateTests } from './utils/initializeState';

describe('Cofre SplSpl trade', () => {
  const provider = Provider.env();
  setProvider(provider);
  const program = workspace.Cofre;

  const maker = Keypair.generate();
  const taker = Keypair.generate();
  const mintAuthority = Keypair.generate();

  let mintA: Token;
  let mintB: Token;

  let makerTokenA: PublicKey;
  let makerTokenB: PublicKey;

  let takerTokenA: PublicKey;
  let takerTokenB: PublicKey;
  let takerTokenC: PublicKey;

  let escrowState: Keypair;
  let escrowVault: PublicKey;
  let vaultBump: number;

  const makerAmount = 1;
  const takerAmount = 2;

  beforeAll(async () => {
    const initialState = await initializeState({
      provider,
      maker,
      taker,
      mintAuthority,
      program,
    });

    ({
      mintA,
      mintB,
      makerTokenA,
      makerTokenB,
      takerTokenA,
      takerTokenB,
      takerTokenC,
      escrowState,
      escrowVault,
      vaultBump,
    } = initialState);

    initialStateTests({
      ...initialState,
      maker,
      taker,
    });
  });

  it('Initialize', async () => {
    await program.rpc.initialize(new BN(makerAmount), new BN(takerAmount), new BN(vaultBump), {
      accounts: {
        maker: maker.publicKey,
        fromMakerAccount: makerTokenA,
        toMakerAccount: makerTokenB,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      },
      signers: [maker, escrowState],
      remainingAccounts: [
        { pubkey: mintA.publicKey, isWritable: false, isSigner: false },
        { pubkey: mintB.publicKey, isWritable: false, isSigner: false },
      ],
    });

    let _makerTokenA = await mintA.getAccountInfo(makerTokenA);
    let escrowVaultToken = await mintA.getAccountInfo(escrowVault);

    let escrowStateAccount = await program.account.escrowState.fetch(escrowState.publicKey);

    // Check that the owner of the maker account is still the maker
    expect(_makerTokenA.owner).toEqual(maker.publicKey);

    // Check that the owner of the vault is the PDA.
    expect(escrowVaultToken.owner).toEqual(escrowVault);
    expect(escrowVaultToken.amount.toNumber()).toBe(makerAmount);
    expect(escrowVaultToken.mint).toEqual(mintA.publicKey);

    // Check that the values in the escrow account match what we expect.
    expect(escrowStateAccount.maker).toEqual(maker.publicKey);
    expect(escrowStateAccount.makerAmount.toNumber()).toBe(makerAmount);
    expect(escrowStateAccount.takerAmount.toNumber()).toBe(takerAmount);
    expect(escrowStateAccount.trade.splSpl.fromToken).toEqual(makerTokenA);
    expect(escrowStateAccount.trade.splSpl.fromMint).toEqual(mintA.publicKey);
    expect(escrowStateAccount.trade.splSpl.toToken).toEqual(makerTokenB);
    expect(escrowStateAccount.trade.splSpl.toMint).toEqual(mintB.publicKey);
    expect(escrowStateAccount.vault).toEqual(escrowVault);
  });

  it('Invalid Exchange', () => {
    expect.assertions(1);
    // Try to Exchange with the wrong taker account mint
    debugger;
    return program.rpc
      .exchange(new BN(vaultBump), {
        accounts: {
          taker: taker.publicKey,
          fromTakerAccount: takerTokenC,
          toTakerAccount: takerTokenA,
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
    const stateBeforeEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);
    const vaultBeforeEscrow = await provider.connection.getAccountInfo(escrowVault);

    await program.rpc.exchange(new BN(vaultBump), {
      accounts: {
        taker: taker.publicKey,
        fromTakerAccount: takerTokenB,
        toTakerAccount: takerTokenA,
        maker: maker.publicKey,
        toMakerAccount: makerTokenB,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      signers: [taker],
    });

    const _makerTokenA = await mintA.getAccountInfo(makerTokenA);
    const _makerTokenB = await mintB.getAccountInfo(makerTokenB);

    const _takerTokenA = await mintA.getAccountInfo(takerTokenA);
    const _takerTokenB = await mintB.getAccountInfo(takerTokenB);

    const makerAfterEscrow = await provider.connection.getAccountInfo(maker.publicKey);
    const stateAfterEscrow = await provider.connection.getAccountInfo(escrowState.publicKey);
    const vaultAfterEscrow = await provider.connection.getAccountInfo(escrowVault);

    // Check that the maker gets back ownership of their token account.
    expect(_makerTokenA.owner).toEqual(maker.publicKey);
    expect(_makerTokenA.amount.toNumber()).toBe(0);
    expect(_makerTokenB.amount.toNumber()).toBe(takerAmount);
    expect(_takerTokenA.amount.toNumber()).toBe(makerAmount);
    expect(_takerTokenB.amount.toNumber()).toBe(0);

    // Check that escrowState and vault account is gone
    expect(stateAfterEscrow).toBe(null);
    expect(vaultAfterEscrow).toBe(null);
    expect(makerAfterEscrow!.lamports).toBe(
      makerBeforeEscrow!.lamports + stateBeforeEscrow!.lamports + vaultBeforeEscrow!.lamports,
    );
  });

  it('Cancel', async () => {
    // Put back tokens into maker token A account.
    // For some reason we need to change a value otherwise repeating the transaction takes too long and expires mocha timeout
    let newMakerAmount = makerAmount + 1;
    await mintA.mintTo(makerTokenA, mintAuthority.publicKey, [mintAuthority], newMakerAmount);

    await program.rpc.initialize(new BN(newMakerAmount), new BN(takerAmount), new BN(vaultBump), {
      accounts: {
        maker: maker.publicKey,
        fromMakerAccount: makerTokenA,
        toMakerAccount: makerTokenB,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      },
      signers: [maker, escrowState],
      remainingAccounts: [
        { pubkey: mintA.publicKey, isWritable: false, isSigner: false },
        { pubkey: mintB.publicKey, isWritable: false, isSigner: false },
      ],
    });

    // Cancel the escrow.
    await program.rpc.cancel(new BN(vaultBump), {
      accounts: {
        maker: maker.publicKey,
        fromMakerAccount: makerTokenA,
        escrowVault: escrowVault,
        escrowState: escrowState.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      signers: [maker],
    });

    const _makerTokenA = await mintA.getAccountInfo(makerTokenA);

    const escrowVaultAccountInfo = await provider.connection.getAccountInfo(escrowVault);
    const escrowStateAccountInfo = await provider.connection.getAccountInfo(escrowState.publicKey);

    // Check all the funds were sent back there.
    expect(_makerTokenA.amount.toNumber()).toBe(newMakerAmount);

    // Check Vault and State are gone
    expect(escrowVaultAccountInfo).toBeNull();
    expect(escrowStateAccountInfo).toBeNull();
  });
});
