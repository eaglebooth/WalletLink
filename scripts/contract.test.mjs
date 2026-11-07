import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, getAddress, keccak256, zeroHash } from 'viem';
import { compile } from './contract.mjs';

test('two-sided consent, stale requests, uniqueness, cancellation, expiry and revocation', async () => {
  const key = '0x' + '11'.repeat(32);
  const synthetic = getAddress('0x' + keccak256(key).slice(-40));
  const key2 = '0x' + '22'.repeat(32);
  const provider = ganache.provider({
    logging: { quiet: true },
    wallet: { unlockedAccounts: [synthetic] },
    chain: { hardfork: 'shanghai' },
  });
  try {
    const transport = custom(provider);
    const client = createPublicClient({ transport });
    const wallet = createWalletClient({ transport, chain: null });
    const [owner, attacker] = await wallet.getAddresses();
    await provider.request({ method: 'evm_setAccountBalance', params: [synthetic, '0x56BC75E2D63100000'] });
    const { abi, bytecode } = compile();
    const deployment = await wallet.deployContract({ account: owner, abi, bytecode, gas: 5_000_000n });
    const { contractAddress: address } = await client.waitForTransactionReceipt({ hash: deployment });
    const read = (functionName, ...args) => client.readContract({ address, abi, functionName, args });
    const write = async (account, functionName, args) => {
      const hash = await wallet.writeContract({ account, address, abi, functionName, args, gas: 800_000n });
      return (await client.waitForTransactionReceipt({ hash })).status;
    };
    assert.equal(await read('syntheticAddress', key), synthetic);
    assert.equal(await write(owner, 'request', [key]), 'success');
    const [, firstId] = await read('pending', owner);
    assert.equal(await write(attacker, 'accept', [owner, firstId]), 'reverted');
    assert.equal(await read('solanaOf', owner), zeroHash);
    assert.equal(await write(owner, 'request', [key]), 'success');
    const [, secondId] = await read('pending', owner);
    assert.equal(await write(synthetic, 'accept', [owner, firstId]), 'reverted');
    assert.equal(await write(synthetic, 'accept', [owner, secondId]), 'success');
    assert.equal(await read('solanaOf', owner), key);
    assert.equal((await read('evmOf', key)).toLowerCase(), owner.toLowerCase());
    assert.equal(await write(attacker, 'request', [key]), 'reverted');
    assert.equal(await write(attacker, 'revoke', [owner, key]), 'reverted');
    assert.equal(await write(owner, 'revoke', [owner, key2]), 'reverted');
    assert.equal(await write(synthetic, 'revoke', [owner, key]), 'success');
    assert.equal(await read('solanaOf', owner), zeroHash);
    assert.equal(await write(owner, 'request', [key]), 'success');
    const [, thirdId] = await read('pending', owner);
    assert.equal(await write(owner, 'cancel', [secondId]), 'reverted');
    assert.equal(await write(owner, 'cancel', [thirdId]), 'success');
    assert.equal(await write(synthetic, 'accept', [owner, thirdId]), 'reverted');
    assert.equal(await write(owner, 'request', [key]), 'success');
    const [, fourthId] = await read('pending', owner);
    await provider.request({ method: 'evm_increaseTime', params: [86401] });
    await provider.request({ method: 'evm_mine', params: [] });
    assert.equal(await write(synthetic, 'accept', [owner, fourthId]), 'reverted');
    assert.equal(await write(owner, 'request', [key]), 'success');
    const [, fifthId] = await read('pending', owner);
    assert.equal(await write(synthetic, 'accept', [owner, fifthId]), 'success');
    assert.equal(await write(owner, 'revoke', [owner, key]), 'success');
  } finally {
    await provider.disconnect();
  }
});

