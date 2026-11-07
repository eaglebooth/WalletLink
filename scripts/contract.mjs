import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import solc from 'solc';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { submitRomeTx } from '@rome-protocol/sdk';

export function compile() {
  const source = readFileSync(new URL('../contracts/WalletLink.sol', import.meta.url), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'WalletLink.sol': { content: source } },
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  })));
  const errors = output.errors?.filter(error => error.severity === 'error') ?? [];
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const result = output.contracts['WalletLink.sol'].WalletLink;
  return { abi: result.abi, bytecode: '0x' + result.evm.bytecode.object };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { bytecode } = compile();
  if (!process.argv.includes('--deploy')) {
    console.log('WalletLink compiled successfully.');
  } else {
    const key = process.env.DEPLOYER_PRIVATE_KEY;
    if (!key) throw new Error('Set DEPLOYER_PRIVATE_KEY to a funded Hadrian test wallet key.');
    const rpc = process.env.VITE_HADRIAN_RPC || 'https://hadrian.testnet.romeprotocol.xyz/';
    const chain = defineChain({
      id: 200010, name: 'Hadrian', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    });
    const account = privateKeyToAccount(key);
    const client = createPublicClient({ chain, transport: http() });
    if (await client.getChainId() !== chain.id) throw new Error('RPC is not on Hadrian.');
    const wallet = createWalletClient({ account, chain, transport: http() });
    const provider = {
      request: async ({ method, params }) => {
        if (method !== 'eth_sendTransaction') return client.request({ method, params });
        const [{ data, gas, maxFeePerGas, maxPriorityFeePerGas, gasPrice }] = params;
        return wallet.sendTransaction({
          data, gas: BigInt(gas),
          ...(maxFeePerGas ? { maxFeePerGas: BigInt(maxFeePerGas), maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas) }
            : gasPrice ? { gasPrice: BigInt(gasPrice) } : {}),
        });
      },
    };
    const deploymentFile = new URL('../deployment-hadrian.json', import.meta.url);
    const previous = existsSync(deploymentFile) ? JSON.parse(readFileSync(deploymentFile, 'utf8')) : undefined;
    if (previous && (previous.deployer !== account.address || previous.bytecode !== bytecode)) {
      throw new Error('Existing deployment belongs to another deployer or contract build. Review deployment-hadrian.json first.');
    }
    const hash = previous?.hash ?? await submitRomeTx(provider, { from: account.address, data: bytecode });
    writeFileSync(deploymentFile, JSON.stringify({ chainId: chain.id, deployer: account.address, bytecode, hash }, null, 2));
    console.log('Deployment transaction: ' + hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment failed: ' + hash);
    const code = await client.getCode({ address: receipt.contractAddress });
    if (!code || code === '0x') throw new Error('No deployed bytecode at the receipt address.');
    writeFileSync(deploymentFile, JSON.stringify({ chainId: chain.id, deployer: account.address, bytecode, hash, contractAddress: receipt.contractAddress }, null, 2));
    console.log('VITE_CONTRACT_ADDRESS=' + receipt.contractAddress);
    console.log('Transaction: ' + hash);
  }
}
