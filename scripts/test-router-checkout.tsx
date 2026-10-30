/** Offline deployment/checkout checks. Wallet calls are in-memory stubs, never providers. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbi, zeroHash, type Abi, type Hex } from 'viem'
import { ARC_NETWORK } from '../src/lib/networks'
import { linkIdToBytes32, parseRouterAddress } from '../src/shared/router'
import { ARC_SYSTEM_EMITTER } from '../src/shared/links'
import type { LocalTx } from '../src/domain/types'
import type { useRouterCheckout } from '../src/chain/useRouterCheckout'

// Bun's built-in test mock API; no dependency or ambient type shim needed.
const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module: (path: string, factory: () => Record<string, unknown>) => void }
}
globalThis.fetch = () => Promise.reject(new Error('Network access forbidden in offline checkout test'))
const preset = Object.fromEntries<string>(readFileSync(new URL('../config/arc-mainnet-router.env.example', import.meta.url), 'utf8')
  .split('\n').filter((line) => line && !line.startsWith('#')).map((line): [string, string] => {
    const separator = line.indexOf('=')
    assert.ok(separator > 0)
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
const router = parseRouterAddress(preset.VITE_COOKET_ROUTER_ADDRESS)!
const usdc = '0x3600000000000000000000000000000000000000'
const artifact = JSON.parse(readFileSync(new URL('../contracts/out/CooketPayRouter.sol/CooketPayRouter.json', import.meta.url), 'utf8')) as {
  abi: Abi
  deployedBytecode: { object: Hex; immutableReferences: Record<string, { start: number; length: number }[]> }
}
let passed = 0
let expectedRuntime: Hex
async function check(name: string, run: () => void | Promise<void>) {
  await run(); passed++; console.log(`PASS  ${name}`)
}
await check('public preset selects the reported router and Arc Mainnet USDC', () => {
  assert.equal(router, '0x1BB1348ab8900D0F04c483fBaeCfd6472D808EF9')
  assert.equal(ARC_NETWORK.chainId, 5042)
  assert.equal(ARC_NETWORK.usdcAddress.toLowerCase(), usdc.toLowerCase())
  assert.equal(ARC_NETWORK.usdcDecimals, 6)
  assert.equal(ARC_NETWORK.rpcUrl, 'https://rpc.mainnet.arc.io')
  assert.equal(preset.ARC_RPC_URL, ARC_NETWORK.rpcUrl)
})
await check('pinned runtime hash matches compiled contract with immutable Arc USDC', () => {
  let code = artifact.deployedBytecode.object.slice(2)
  const immutable = usdc.slice(2).padStart(64, '0')
  assert.equal(Object.keys(artifact.deployedBytecode.immutableReferences).length, 1, 'only USDC is immutable')
  const refs = Object.values(artifact.deployedBytecode.immutableReferences).flat()
  assert.ok(refs.length > 0)
  for (const ref of refs) {
    assert.equal(ref.length, 32)
    code = code.slice(0, ref.start * 2) + immutable + code.slice((ref.start + ref.length) * 2)
  }
  expectedRuntime = `0x${code}`
  assert.equal(keccak256(expectedRuntime), preset.COOKET_ROUTER_CODE_HASH)
})
await check('server consumes the same router, runtime hash and Arc USDC configuration', async () => {
  Object.assign(process.env, preset)
  delete process.env.RPC_PROXY_BASE_URL
  const config = await import('../server/config')
  assert.equal(config.ROUTER_ADDRESS, router)
  assert.equal(config.ROUTER_CODE_HASH, preset.COOKET_ROUTER_CODE_HASH)
  assert.equal(config.ROUTER_CONFIG_VALID, true)
  assert.equal(config.CHAIN_ID, 5042)
  assert.equal(config.USDC_ADDRESS.toLowerCase(), usdc.toLowerCase())
})

const payer = '0x1111111111111111111111111111111111111111' as const
const recipient = '0x2222222222222222222222222222222222222222' as const
const hash: Hex = `0x${'ab'.repeat(32)}`
const amountRaw = 1_250_000n
const linkId = 'offlineDeployedRouterCheckout'
await check('backend validates the configured router using its compiled runtime and USDC getter', async () => {
  const { client, routerIsValid } = await import('../server/verify')
  Object.assign(client, {
    getChainId: () => Promise.resolve(5042),
    getCode: ({ address }: { address: string }) => {
      assert.equal(address, router)
      return Promise.resolve(expectedRuntime)
    },
    readContract: ({ address, functionName }: { address: string; functionName: string }) => {
      assert.equal(address, router)
      assert.equal(functionName, 'USDC')
      return Promise.resolve(usdc)
    },
  })
  assert.equal(await routerIsValid(router), true)
})
await check('backend verifies a receipt emitted by the deployed router with real-movement requirements', async () => {
  const { client, verifyPayment } = await import('../server/verify')
  const blockHash: Hex = `0x${'cd'.repeat(32)}`
  const metadata = { blockHash, blockNumber: 10n, transactionHash: hash, removed: false }
  const logs = [
    { ...metadata, address: ARC_SYSTEM_EMITTER, logIndex: 1,
      topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), eventName: 'Transfer', args: { from: payer, to: recipient } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [amountRaw * 10n ** 12n]) },
    { ...metadata, address: router, logIndex: 2,
      topics: encodeEventTopics({ abi: artifact.abi, eventName: 'PaymentReceived', args: { linkId: linkIdToBytes32(linkId), payer, recipient } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [amountRaw, zeroHash]) },
  ]
  Object.assign(client, {
    getTransactionReceipt: () => Promise.resolve({ ...metadata, status: 'success', logs }),
    getBlock: () => Promise.resolve({ hash: blockHash, number: 10n, timestamp: 2000n }),
  })
  const link = { id: linkId, ownerDid: 'did:privy:offline', recipient, router, description: 'Offline fixture', mode: 'fixed' as const, amountRaw: amountRaw.toString(), createdAt: 1000 }
  const result = await verifyPayment(link, hash)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.payment.payer.toLowerCase(), payer)
    assert.equal(result.payment.amountRaw, amountRaw.toString())
    assert.equal(result.payment.logIndex, 1)
  }
  logs.shift()
  const missingMovement = await verifyPayment(link, hash)
  assert.equal(missingMovement.ok ? 'ok' : missingMovement.code, 'no_transfer')
})
let allowance = 0n
let records: Record<string, LocalTx[]> = {}
const writes: { address: string; abi: Abi; functionName: string; args: readonly unknown[]; chainId: number; value?: bigint }[] = []
const mockPath = (path: string, factory: () => Record<string, unknown>) => mock.module(new URL(path, import.meta.url).pathname, factory)
mock.module('wagmi', () => ({
  useReadContract: () => ({ data: allowance, isLoading: false, isError: false, refetch: () => Promise.resolve({ data: allowance }) }),
  useWriteContract: () => ({ writeContractAsync: (args: typeof writes[number]) => { writes.push(args); return Promise.resolve(hash) } }),
}))
mock.module('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }) }))
mockPath('../src/chain/useSession.ts', () => ({ useSession: () => ({ address: payer }) }))
mockPath('../src/chain/client.ts', () => ({
  CONFIRMATIONS: 1,
  clientFor: () => ({
    estimateFeesPerGas: () => Promise.resolve({ maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 0n }),
    waitForTransactionReceipt: () => Promise.resolve({ status: 'success', transactionHash: hash, blockNumber: 10n }),
  }),
}))
mockPath('../src/stores/index.ts', () => ({
  settingsStore: { get: () => ({ notifyOutgoing: false }) },
  txStore: { get: () => records },
  upsertLocalTx: (tx: LocalTx) => { records = { [payer]: [{ ...records[payer]?.[0], ...tx }] } },
  pushNotification: () => undefined,
}))
const { useRouterCheckout: checkout } = await import('../src/chain/useRouterCheckout')
function render() {
  let flow!: ReturnType<typeof useRouterCheckout>
  function Harness() {
    flow = checkout({ network: ARC_NETWORK, router, linkId, recipient, amountRaw })
    return null
  }
  renderToStaticMarkup(createElement(Harness))
  return flow
}
await check('checkout needs approval for insufficient allowance and approves the exact amount', async () => {
  const flow = render()
  assert.equal(flow.needsApproval, true)
  await flow.approve()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].address.toLowerCase(), usdc.toLowerCase())
  assert.equal(writes[0].chainId, 5042)
  assert.equal(writes[0].functionName, 'approve')
  assert.deepEqual(writes[0].args, [router, amountRaw])
  assert.equal(writes[0].value, undefined, 'no native value is attached')
  assert.equal(records[payer], undefined, 'approval alone is not a payment')
})
await check('sufficient allowance permits the pay step without another approval', () => {
  allowance = amountRaw
  assert.equal(render().needsApproval, false)
  allowance = amountRaw - 1n
  assert.equal(render().needsApproval, true)
  allowance = amountRaw
})
await check('checkout hook calls actual compiled pay ABI with link, recipient, amount and zero reference', async () => {
  await render().submit()
  assert.equal(writes.length, 2, 'approval never automatically submits a payment')
  const call = writes[1]
  assert.equal(call.address, router)
  assert.equal(call.chainId, 5042)
  assert.equal(call.functionName, 'pay')
  assert.equal(call.value, undefined)
  const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args })
  const decoded = decodeFunctionData({ abi: artifact.abi, data })
  assert.equal(decoded.functionName, 'pay')
  assert.deepEqual(decoded.args, [linkIdToBytes32(linkId), recipient, amountRaw, zeroHash])
  assert.equal(records[payer][0].linkId, linkId)
  assert.equal(records[payer][0].amountRaw, amountRaw.toString())
  assert.equal(records[payer][0].linkVerifiedAt, undefined, 'a receipt does not register payment')
})
await check('submitted but unregistered checkout blocks another approve or pay', async () => {
  await render().approve()
  await render().submit()
  assert.equal(writes.length, 2)
})
console.log(`\n${passed} offline deployed-router checkout checks passed; no signing or transactions`)
