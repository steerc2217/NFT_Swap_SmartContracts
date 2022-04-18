import { Provider } from '@project-serum/anchor';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

export default async function airdropTokens({
  provider,
  maker,
  taker,
  mintAuthority,
}: {
  provider: Provider;
  maker: Keypair;
  taker: Keypair;
  mintAuthority: Keypair;
}) {
  // Airdropping Maker
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(maker.publicKey, 100 * LAMPORTS_PER_SOL),
    'confirmed',
  );

  // Airdropping Taker
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(taker.publicKey, 100 * LAMPORTS_PER_SOL),
    'confirmed',
  );

  // Airdropping Mint Authority
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(mintAuthority.publicKey, 100 * LAMPORTS_PER_SOL),
    'confirmed',
  );
}
