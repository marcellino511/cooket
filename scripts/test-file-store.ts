/** Development-file-store tests. Every file is disposable and local; no RPC or Supabase access. */
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createFileDatabase, type Db } from '../server/db'
import { StoreUnavailable } from '../server/store-types'

const root = await mkdtemp(join(tmpdir(), 'cooket-file-store-'))
const fixture: Db = {
  links: { existing: { id: 'existing', ownerDid: 'did:privy:fixture', recipient: '0x1111111111111111111111111111111111111111', description: 'Keep this data', mode: 'fixed', amountRaw: '2500000', createdAt: 1000 } },
  payments: { existing: [{ txHash: `0x${'ab'.repeat(32)}`, logIndex: 1, payer: '0x2222222222222222222222222222222222222222', amountRaw: '2500000', blockNumber: '10', paidAt: 2000, verifiedAt: 3000 }] },
  claimed: { [`0x${'ab'.repeat(32)}:1`]: 'existing' },
  nonces: { existing: 1000 },
}
const original = JSON.stringify(fixture, null, 2)
let passed = 0
let sequence = 0
async function test(name: string, run: (file: string) => Promise<void>) {
  const dir = join(root, String(sequence++))
  await mkdir(dir)
  await run(join(dir, 'db.json'))
  passed++
  console.log(`PASS  ${name}`)
}
async function blocked(file: string, bytes: string) {
  const database = createFileDatabase(file)
  await assert.rejects(database.read((state) => state), StoreUnavailable)
  assert.equal(await readFile(file, 'utf8'), bytes, 'failed read preserves bytes')
  let called = false
  await assert.rejects(database.mutate((state) => { called = true; state.nonces.overwrite = 9999 }), StoreUnavailable)
  assert.equal(called, false, 'mutation never runs after a failed load')
  assert.equal(await readFile(file, 'utf8'), bytes, 'rejected write preserves bytes')
  assert.deepEqual(await readdir(join(file, '..')), ['db.json'], 'no replacement, temporary file or lock remains')
}

try {
  await test('missing file reads empty, then initializes without losing a normal write', async (file) => {
    const database = createFileDatabase(file)
    assert.deepEqual(await database.read((state) => state), { links: {}, payments: {}, claimed: {}, nonces: {} })
    await assert.rejects(lstat(file), { code: 'ENOENT' })
    assert.equal(await database.mutate((state) => { state.nonces.first = 123; return 'saved' }), 'saved')
    assert.equal((await createFileDatabase(file).read((state) => state)).nonces.first, 123)
    assert.equal((JSON.parse(await readFile(file, 'utf8')) as Db).nonces.first, 123)
  })
  await test('valid existing data survives reads and writes in every map', async (file) => {
    await writeFile(file, original)
    const database = createFileDatabase(file)
    assert.deepEqual(await database.read((state) => state), fixture)
    assert.equal(await readFile(file, 'utf8'), original)
    await database.mutate((state) => { state.nonces.new = 4000 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...fixture, nonces: { ...fixture.nonces, new: 4000 } })
  })
  await test('empty file cannot be replaced by a write after failed read', async (file) => {
    await writeFile(file, '')
    await blocked(file, '')
  })
  await test('malformed JSON preserves its exact original bytes', async (file) => {
    const bytes = '{"links":{"existing":' + original
    await writeFile(file, bytes)
    await blocked(file, bytes)
  })
  await test('invalid UTF-8 is rejected without silently rewriting corrupt bytes', async (file) => {
    const bytes = Buffer.concat([Buffer.from('{"metadata":"'), Buffer.from([0xff]), Buffer.from('"}')])
    await writeFile(file, bytes)
    const database = createFileDatabase(file)
    await assert.rejects(database.read((state) => state), StoreUnavailable)
    await assert.rejects(database.mutate((state) => { state.nonces.bad = 1 }), StoreUnavailable)
    assert.deepEqual(await readFile(file), bytes)
  })
  for (const value of [null, [], 'text', { links: null }, { payments: [] }, { nonces: { bad: 'not-a-number' } }, { links: { existing: {} } }, { payments: { existing: [null] } }]) {
    await test(`malformed database structure is preserved: ${JSON.stringify(value)}`, async (file) => {
      const bytes = JSON.stringify(value)
      await writeFile(file, bytes)
      await blocked(file, bytes)
    })
  }
  await test('a non-file read error preserves the directory and its contents', async (file) => {
    await mkdir(file)
    await writeFile(join(file, 'keep.txt'), original)
    const database = createFileDatabase(file)
    await assert.rejects(database.read((state) => state), StoreUnavailable)
    await assert.rejects(database.mutate((state) => { state.nonces.new = 1 }), StoreUnavailable)
    assert.equal((await lstat(file)).isDirectory(), true)
    assert.equal(await readFile(join(file, 'keep.txt'), 'utf8'), original)
  })
  if (process.getuid?.() !== 0) {
    await test('permission failure rejects both read and write without replacing data', async (file) => {
      await writeFile(file, original)
      const identity = (await lstat(file)).ino
      const database = createFileDatabase(file)
      await chmod(file, 0)
      try {
        await assert.rejects(database.read((state) => state), StoreUnavailable)
        let called = false
        await assert.rejects(database.mutate(() => { called = true }), StoreUnavailable)
        assert.equal(called, false)
        assert.equal((await lstat(file)).ino, identity)
      } finally { await chmod(file, 0o600) }
      assert.equal(await readFile(file, 'utf8'), original)
    })
  } else console.log('SKIP  permission-denied test: running as root; non-file read-error test still executes')
  await test('a dangling symlink is never treated as a missing database', async (file) => {
    const target = join(file, '..', 'absent.json')
    await symlink(target, file)
    const database = createFileDatabase(file)
    await assert.rejects(database.read((state) => state), StoreUnavailable)
    await assert.rejects(database.mutate(() => undefined), StoreUnavailable)
    assert.equal(await readlink(file), target)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
  })
  await test('legacy omitted maps and unknown fields survive a normal write', async (file) => {
    await writeFile(file, JSON.stringify({ links: fixture.links, metadata: { keep: true } }))
    await createFileDatabase(file).mutate((state) => { state.nonces.new = 4 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { links: fixture.links, payments: {}, claimed: {}, nonces: { new: 4 }, metadata: { keep: true } })
  })
  await test('a file appearing after an initial missing read is loaded afresh', async (file) => {
    const database = createFileDatabase(file)
    await database.read((state) => state)
    await writeFile(file, original)
    await database.mutate((state) => { state.nonces.new = 9 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...fixture, nonces: { ...fixture.nonces, new: 9 } })
  })
  await test('a file appearing during initial creation is never overwritten', async (file) => {
    await assert.rejects(createFileDatabase(file).mutate(async (state) => {
      state.nonces.new = 2
      await writeFile(file, original)
    }), StoreUnavailable)
    assert.equal(await readFile(file, 'utf8'), original)
  })
  await test('an intervening external edit rejects the write and keeps the edit', async (file) => {
    await writeFile(file, original)
    const external = JSON.stringify({ ...fixture, nonces: { external: 7 } })
    await assert.rejects(createFileDatabase(file).mutate(async (state) => {
      state.nonces.new = 2
      await writeFile(file, external)
    }), StoreUnavailable)
    assert.equal(await readFile(file, 'utf8'), external)
  })
  await test('concurrent writes on one instance retain every update', async (file) => {
    await writeFile(file, original)
    const database = createFileDatabase(file)
    await Promise.all(Array.from({ length: 12 }, (_, index) => database.mutate((state) => { state.nonces[`new${index}`] = index })))
    const stored = JSON.parse(await readFile(file, 'utf8')) as Db
    assert.deepEqual(stored.links, fixture.links)
    assert.deepEqual(stored.payments, fixture.payments)
    assert.deepEqual(stored.claimed, fixture.claimed)
    assert.equal(Object.keys(stored.nonces).length, 13)
  })
  await test('independent instances cannot overwrite an active writer', async (file) => {
    await writeFile(file, original)
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const first = createFileDatabase(file).mutate(async (state) => { entered(); await held; state.nonces.first = 5 })
    await ready
    try {
      await assert.rejects(createFileDatabase(file).mutate((state) => { state.nonces.lost = 8 }), StoreUnavailable)
      assert.equal(await readFile(file, 'utf8'), original)
      const child = spawnSync(process.execPath, ['--no-env-file', '-e', `
        const {createFileDatabase} = await import(${JSON.stringify(new URL('../server/db.ts', import.meta.url).href)});
        const assert = await import('node:assert/strict');
        const {StoreUnavailable} = await import(${JSON.stringify(new URL('../server/store-types.ts', import.meta.url).href)});
        await assert.rejects(createFileDatabase(process.env.COOKET_TEST_FILE).mutate(() => undefined), StoreUnavailable);
      `], { env: { ...process.env, COOKET_TEST_FILE: file }, encoding: 'utf8', timeout: 5000 })
      assert.equal(child.status, 0, 'a separate process also refuses the held lock')
      assert.equal(await readFile(file, 'utf8'), original)
    } finally { release() }
    await first
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...fixture, nonces: { ...fixture.nonces, first: 5 } })
  })
  await test('a leftover lock is preserved for manual inspection', async (file) => {
    await writeFile(file, original)
    await writeFile(`${file}.lock`, 'existing lock')
    await assert.rejects(createFileDatabase(file).mutate(() => undefined), StoreUnavailable)
    assert.equal(await readFile(file, 'utf8'), original)
    assert.equal(await readFile(`${file}.lock`, 'utf8'), 'existing lock')
  })
  await test('a failed mutation leaves both disk and subsequent reads unchanged', async (file) => {
    await writeFile(file, original)
    const database = createFileDatabase(file)
    await assert.rejects(database.mutate((state) => { state.nonces.bad = 4; throw new Error('fixture callback failed') }), /fixture callback failed/)
    assert.equal(await readFile(file, 'utf8'), original)
    assert.deepEqual(await database.read((state) => state), fixture)
    await database.mutate((state) => { state.nonces.good = 5 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...fixture, nonces: { ...fixture.nonces, good: 5 } })
  })
  await test('corruption after a successful read still blocks all later writes', async (file) => {
    await writeFile(file, original)
    const database = createFileDatabase(file)
    await database.read((state) => state)
    await writeFile(file, 'corrupt original bytes')
    await assert.rejects(database.mutate((state) => { state.nonces.bad = 5 }), StoreUnavailable)
    assert.equal(await readFile(file, 'utf8'), 'corrupt original bytes')
  })
  await test('FileStore default wiring preserves existing links and payments', async (file) => {
    await writeFile(file, original)
    const child = spawnSync(process.execPath, ['--no-env-file', '-e', `
      const {FileStore} = await import(${JSON.stringify(new URL('../server/store-file.ts', import.meta.url).href)});
      const assert = await import('node:assert/strict');
      const store = new FileStore();
      const existing = await store.getLink('existing');
      assert.equal(existing.payments.length, 1);
      await store.createLink({...existing.link, id:'new-link', createdAt:4000}, 'fresh-nonce');
      assert.equal((await store.getLink('new-link')).link.id, 'new-link');
      await store.recordPayment('new-link', {...existing.payments[0], txHash:'0x'+'cd'.repeat(32)});
      assert.equal((await store.findPayment('new-link', '0x'+'cd'.repeat(32))).amountRaw, '2500000');
    `], { env: { ...process.env, COOKET_DATA_FILE: file }, encoding: 'utf8', timeout: 5000 })
    assert.equal(child.status, 0)
    const stored = JSON.parse(await readFile(file, 'utf8')) as Db
    assert.deepEqual(stored.links.existing, fixture.links.existing)
    assert.deepEqual(stored.payments.existing, fixture.payments.existing)
    assert.equal(stored.claimed[`0x${'ab'.repeat(32)}:1`], 'existing')
    assert.equal(stored.nonces.existing, 1000)
    assert.equal(stored.payments['new-link'].length, 1)
  })
  console.log(`\n${passed} file-store preservation checks passed`)
} finally {
  await rm(root, { recursive: true, force: true })
}
