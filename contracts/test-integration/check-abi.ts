/** Read compiled artifacts only. No RPC, wallets, signing or deployment. Run forge build first. */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { getAbiItem, toEventSelector, toFunctionSelector, type Abi } from 'viem'
import { ROUTER_ABI } from '../../src/shared/router'

const artifact = JSON.parse(await readFile(new URL('../out/CooketPayRouter.sol/CooketPayRouter.json', import.meta.url), 'utf8')) as { abi: Abi }
for (const [name, kind] of [['pay', 'function'], ['USDC', 'function'], ['PaymentReceived', 'event']] as const) {
  const compiled = getAbiItem({ abi: artifact.abi, name } as never) as never
  const shared = getAbiItem({ abi: ROUTER_ABI, name } as never) as never
  const selector = (item: never) => kind === 'event' ? toEventSelector(item) : toFunctionSelector(item)
  assert.equal(selector(compiled), selector(shared), `ABI selector mismatch: ${name}`)
  // Indexed event fields and function outputs are not part of selectors.
  const shape = (item: unknown) => JSON.parse(JSON.stringify(item, (key, value: unknown) => key === 'internalType' || (key === 'name' && value === '') || (['anonymous', 'indexed'].includes(key) && value === false) ? undefined : value)) as unknown
  assert.deepEqual(shape(compiled), shape(shared), `ABI shape mismatch: ${name}`)
  console.log(`PASS  compiled/shared ABI parity: ${name}`)
}
