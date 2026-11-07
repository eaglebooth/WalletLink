import './style.css';
import { Connection, PublicKey } from '@solana/web3.js';
import { submitRomeTx, submitRomeTxSolanaLane } from '@rome-protocol/sdk';
import { bytesToHex, createPublicClient, defineChain, encodeFunctionData, getAddress, hexToBytes, http, isAddress, parseAbi, zeroAddress, zeroHash } from 'viem';

const { VITE_CONTRACT_ADDRESS: contract, VITE_HADRIAN_RPC, VITE_SOLANA_RPC, VITE_ROME_PROGRAM_ID } = import.meta.env;
const rpc = VITE_HADRIAN_RPC || 'https://hadrian.testnet.romeprotocol.xyz/';
const chain = defineChain({
  id: 200010, name: 'Hadrian',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const chainHex = '0x' + chain.id.toString(16);
const explorer = 'https://via-hadrian.testnet.romeprotocol.xyz';
const client = createPublicClient({ chain, transport: http() });
const abi = parseAbi([
  'function pending(address) view returns (bytes32 solanaKey, uint256 id, uint256 expiresAt)',
  'function solanaOf(address) view returns (bytes32)',
  'function evmOf(bytes32) view returns (address)',
  'function request(bytes32)',
  'function accept(address,uint256)',
  'function cancel(uint256)',
  'function revoke(address,bytes32)',
]);
const $ = id => document.getElementById(id);
const evmProvider = window.ethereum?.providers?.find(provider => provider.isMetaMask) ?? window.ethereum;
const phantom = window.phantom?.solana;
let evm;
let solana;
let profile;
let busy = false;

const configured = Boolean(contract && isAddress(contract) && contract !== zeroAddress);
const read = (functionName, ...args) => client.readContract({ address: contract, abi, functionName, args });
const solKey = publicKey => bytesToHex(publicKey.toBytes());
const sameAddress = (left, right) => Boolean(left && right && left.toLowerCase() === right.toLowerCase());

function render() {
  $('connected').textContent = [evm && 'EVM: ' + evm, solana && 'Solana: ' + solana.toBase58()]
    .filter(Boolean).join('\n') || 'Connect your wallets to start.';
  $('evm-label').textContent = evm ? evm.slice(0, 8) + '…' + evm.slice(-6) : 'Not connected';
  $('sol-label').textContent = solana ? solana.toBase58().slice(0, 8) + '…' + solana.toBase58().slice(-6) : 'Not connected';
  $('next-step').textContent = !configured ? 'Next — the Hadrian contract needs to be deployed before linking.'
    : !evm || !solana ? 'Next — connect MetaMask and Phantom.'
    : 'Next — request with MetaMask, then accept with Phantom. Both transactions need approval.';
  $('connect-evm').disabled = busy;
  $('connect-sol').disabled = busy;
  $('request').disabled = busy || !configured || !evm || !solana;
  $('accept').disabled = busy || !configured || !evm || !solana || !VITE_ROME_PROGRAM_ID;
  $('cancel').disabled = busy || !configured || !evm;
  $('lookup').querySelector('button').disabled = busy || !configured;
  $('revoke-evm').hidden = !sameAddress(evm, profile?.evm);
  $('revoke-sol').hidden = !solana || solKey(solana) !== profile?.key;
  $('revoke-evm').disabled = busy;
  $('revoke-sol').disabled = busy || !VITE_ROME_PROGRAM_ID;
}

async function run(action) {
  if (busy) return;
  busy = true;
  render();
  $('status').textContent = 'Working…';
  try {
    $('status').textContent = await action();
  } catch (error) {
    $('status').textContent = error.shortMessage || error.message || String(error);
  } finally {
    busy = false;
    render();
  }
}

async function switchHadrian() {
  const request = (method, params) => evmProvider.request({ method, params });
  try {
    await request('wallet_switchEthereumChain', [{ chainId: chainHex }]);
  } catch (error) {
    if (error.code !== 4902) throw error;
    await request('wallet_addEthereumChain', [{
      chainId: chainHex, chainName: chain.name, nativeCurrency: chain.nativeCurrency,
      rpcUrls: [rpc], blockExplorerUrls: [explorer],
    }]);
    await request('wallet_switchEthereumChain', [{ chainId: chainHex }]);
  }
}

function showTransaction(url) {
  $('transaction').href = url;
  $('transaction').hidden = false;
}

async function writeEvm(functionName, args) {
  const from = evm;
  await switchHadrian();
  if (!sameAddress(from, evm)) throw new Error('The connected EVM account changed. Try again.');
  const data = encodeFunctionData({ abi, functionName, args });
  const hash = await submitRomeTx(evmProvider, { from, to: contract, data });
  showTransaction(explorer + '/tx/' + hash);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error('The EVM transaction reverted.');
}

async function writeSolana(functionName, args, verify) {
  const payer = solana;
  const connection = new Connection(VITE_SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
  const { signature } = await submitRomeTxSolanaLane({
    connection, proxyUrl: rpc, programId: new PublicKey(VITE_ROME_PROGRAM_ID),
    chainId: chain.id, payer,
    signTransaction: transaction => {
      if (!solana?.equals(payer)) throw new Error('The connected Solana account changed. Try again.');
      return phantom.signTransaction(transaction);
    },
  }, { to: contract, data: encodeFunctionData({ abi, functionName, args }), value: 0n });
  showTransaction('https://explorer.solana.com/tx/' + signature + '?cluster=devnet');
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await verify()) return;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('The Solana transaction was submitted, but the expected link state is not visible. Check the transaction before retrying.');
}

async function lookup(input) {
  profile = undefined;
  $('result').textContent = 'Looking up address…';
  let key;
  let address;
  try {
    if (isAddress(input)) {
      address = getAddress(input);
      key = await read('solanaOf', address);
    } else {
      const publicKey = new PublicKey(input);
      if (publicKey.toBase58() !== input) throw new Error('Invalid Solana address.');
      key = solKey(publicKey);
      address = await read('evmOf', key);
    }
  } catch (error) {
    $('result').textContent = 'Lookup failed.';
    throw error;
  }
  if (key === zeroHash || address === zeroAddress) {
    $('result').textContent = 'No active link for this address.';
    return;
  }
  profile = { evm: address, key };
  $('result').textContent = 'EVM: ' + address + '\nSolana: ' + new PublicKey(hexToBytes(key)).toBase58();
}

$('connect-evm').onclick = () => run(async () => {
  if (!evmProvider?.isMetaMask) throw new Error('Install MetaMask and reload this page.');
  [evm] = await evmProvider.request({ method: 'eth_requestAccounts' });
  return 'MetaMask connected.';
});
$('connect-sol').onclick = () => run(async () => {
  if (!phantom?.isPhantom) throw new Error('Install Phantom and enable Devnet in its developer settings.');
  ({ publicKey: solana } = await phantom.connect());
  return 'Phantom connected.';
});
evmProvider?.on?.('accountsChanged', accounts => { [evm] = accounts; render(); });
phantom?.on('accountChanged', key => { solana = key ?? undefined; render(); });
phantom?.on('disconnect', () => { solana = undefined; render(); });

$('request').onclick = () => run(async () => {
  await writeEvm('request', [solKey(solana)]);
  return 'Request recorded. Accept with the selected Phantom wallet within 24 hours.';
});
$('accept').onclick = () => run(async () => {
  const address = evm;
  const key = solKey(solana);
  const [target, id, expiresAt] = await read('pending', address);
  const { timestamp } = await client.getBlock();
  if (!id || target !== key || expiresAt <= timestamp) throw new Error('No active request for this wallet pair.');
  if (!sameAddress(address, evm) || !solana || solKey(solana) !== key) throw new Error('Connected wallets changed. Try again.');
  await writeSolana('accept', [address, id], async () => await read('solanaOf', address) === key);
  $('address').value = address;
  await lookup(address);
  return 'Both wallets approved the link.';
});
$('cancel').onclick = () => run(async () => {
  const address = evm;
  const [, id] = await read('pending', address);
  if (!id) throw new Error('No pending request to cancel.');
  if (!sameAddress(address, evm)) throw new Error('The connected EVM account changed. Try again.');
  await writeEvm('cancel', [id]);
  return 'Pending request cancelled.';
});
$('lookup').onsubmit = event => {
  event.preventDefault();
  void run(async () => { await lookup($('address').value.trim()); return ''; });
};
for (const [id, write] of [['revoke-evm', writeEvm], ['revoke-sol', writeSolana]]) {
  $(id).onclick = () => run(async () => {
    const { evm: address, key } = profile;
    await write('revoke', [address, key], async () => await read('solanaOf', address) !== key);
    await lookup(address);
    return 'Link revoked.';
  });
}

render();
if (!configured || !VITE_ROME_PROGRAM_ID) {
  $('deployment-notice').hidden = false;
  $('status').textContent = 'On-chain setup is pending. You can explore the walkthrough and connect your wallets.';
}


const demoSteps = [
  {
    title: 'Connect your wallets',
    description: 'Choose two wallets you control. Connecting lets the app read your selected account addresses.',
    symbol: '···',
  },
  {
    title: 'Request from MetaMask',
    description: 'Your EVM wallet proposes a link to your Solana address. Approve the Hadrian transaction in MetaMask. The request expires after 24 hours.',
    symbol: '→',
  },
  {
    title: 'Accept from Phantom',
    description: 'Your Solana wallet confirms the same pair. Once confirmed on-chain, either address can be looked up to find the linked wallet. Either wallet can revoke the link.',
    symbol: '↔',
  },
];
let demoStep = 0;
function renderDemo() {
  const step = demoSteps[demoStep];
  $('demo-count').textContent = '0' + (demoStep + 1) + ' / 03';
  $('demo-stage').textContent = step.title;
  $('demo-description').textContent = step.description;
  $('demo-link').textContent = step.symbol;
  $('demo-back').disabled = demoStep === 0;
  $('demo-next').textContent = demoStep === 2 ? 'Start linking ↗' : 'Next step →';
}
$('demo-open').onclick = () => {
  demoStep = 0;
  renderDemo();
  $('demo-dialog').showModal();
};
$('demo-close').onclick = () => $('demo-dialog').close();
$('demo-back').onclick = () => { demoStep--; renderDemo(); };
$('demo-next').onclick = () => {
  if (demoStep === 2) {
    $('demo-dialog').close();
    $('workspace').scrollIntoView({ behavior: 'smooth' });
    $('connect-evm').focus({ preventScroll: true });
  } else {
    demoStep++;
    renderDemo();
  }
};
