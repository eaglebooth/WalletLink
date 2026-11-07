# WalletLink

Live dApp: https://walletlink-livid.vercel.app/

Source: https://github.com/eaglebooth/WalletLink

A two-wallet consent registry for Hadrian. An EVM wallet requests a link to a Solana public key. The Solana wallet accepts through the Rome Solana lane. Either wallet can revoke the active link.

## Run locally

Requires Node.js 22.13+ and npm.

1. Run `npm ci`.
2. Copy `.env.example` to `.env`.
3. Deploy the contract using the steps below and set `VITE_CONTRACT_ADDRESS`.
4. Run `npm run dev -- --host 127.0.0.1`.
5. Open the localhost URL in a browser with MetaMask and Phantom installed.

`npm run build` creates the production output in `dist`. Only VITE-prefixed variables are exposed to the browser.

## Deploy on Hadrian

Fund a dedicated test wallet with Hadrian USDC. Set `DEPLOYER_PRIVATE_KEY` in your local .env, then run `npm run deploy`. Copy the printed contract address into `VITE_CONTRACT_ADDRESS` and restart the dev server. Keep the private key out of source control.

Hadrian uses chain ID 200010 and USDC gas. The Solana wallet needs devnet SOL for transaction fees and devnet USDC. Use Phantom's Devnet mode. The example program ID is from the official Hadrian network documentation.

## Demo

- Connect MetaMask and Phantom.
- Click Request with MetaMask and confirm the Hadrian transaction.
- Click Accept with Phantom and approve the Solana transaction.
- Look up either wallet address to see the same active pair.
- Revoke using either wallet, then repeat the lookup.

The EVM request and Solana acceptance are separate transactions. Requests expire after 24 hours. The globally increasing request ID prevents acceptance of an overwritten or cancelled request. Acceptance checks both wallets are still available. Each wallet can have one active pair. Linking is public and historical events remain public after revocation. A linked profile proves control at acceptance time.

MetaMask writes use `submitRomeTx`. Phantom writes use the official SDK's legacy `submitRomeTxSolanaLane` path with `signTransaction`. The v1 wallet-signing path is a separate SDK feature. Browser wallet compatibility and network behavior must be validated on Hadrian before an Arena submission.

## Checks

- `npm run compile`
- `npm test`
- `npm run build`

The contract tests run on an isolated local EVM. They impersonate the synthetic address to check the registry's access control. They do not validate Rome's Solana authentication implementation. Covered cases include unauthorized acceptance/revocation, stale request IDs, cancellation, expiry, uniqueness and revocation by both sides.

The pinned SDK source archive needs compilation. The install script builds it with TypeScript. The production bundle currently exceeds Vite's default 500 kB chunk warning threshold.

## Current verification

Contract compilation, local contract tests and production bundling passed. WalletLink is deployed on Hadrian at 0x449f8c732e4e93a338b4e93c9fed32cf594ab5ea. Deployment transaction 0x95983dd02d9cfddc86d83b772480fb51cdbb44cfe6ebcc587405a22b71b373ea succeeded and deployed bytecode was checked. The local .env points the frontend to this address. Live integration tests using the supplied test accounts passed request, Solana acceptance, lookup in both directions, Solana revocation, EVM revocation and relinking. The final pair remains linked. Browser lookup was verified for both public addresses. Transactions were signed locally through the same official SDK methods used by the app. MetaMask/Phantom extension approval prompts have not been exercised. Public transaction evidence is in walletlink-test-results.json.

The initial dependency install reported security advisories, including high and critical severities. A full online dependency review remains necessary before public release.

## References

- https://github.com/rome-protocol/rome-sdk-ts
- https://docs.rome.builders/networks/hadrian
- https://docs.rome.builders/getting-started-1/quickstart
