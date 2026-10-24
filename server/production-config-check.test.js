import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'production-config-check.js')
const secret = 'T'.repeat(56)
const base = {
  HOST: '0.0.0.0',
  C_POCKET_BRIDGE_TOKEN: 'B'.repeat(40),
  C_POCKET_DRAWER_SECRET: 'D'.repeat(40),
  C_POCKET_DROP_SECRET: secret,
  C_POCKET_MCP_PATH: '/mcp/' + 'R'.repeat(43),
  C_POCKET_MCP_CAPTURE_PATH: '',
  C_POCKET_ENABLE_MCP_CAPTURE: 'false',
  C_POCKET_ENABLE_UNIFIED_OWNER: 'false',
  C_POCKET_ENABLE_OWNER_TAXONOMY_CREATE: 'false',
  C_POCKET_ENABLE_OWNER_IN_PLACE: 'false',
  C_POCKET_ENABLE_MCP_FILE_HOST_PROBE: 'false',
  C_POCKET_ENABLE_MCP_FILE_INTAKE: 'false',
  C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'false',
  C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3: 'false',
  C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'false',
  C_POCKET_ENABLE_LEGACY_MCP: 'true',
  C_POCKET_MCP_FILE_HOSTS: '',
}

function check(overrides = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...base, ...overrides },
  })
}
const enabledOwner = {
  C_POCKET_ENABLE_MCP_CAPTURE: 'true',
  C_POCKET_ENABLE_UNIFIED_OWNER: 'true',
  C_POCKET_MCP_CAPTURE_PATH: '/mcp/' + 'W'.repeat(43),
}

test('legacy defaults and prepared dormant private path pass without enabling an Owner', () => {
  assert.equal(check().status, 0)
  assert.equal(check({ C_POCKET_MCP_CAPTURE_PATH: '/mcp/' + 'W'.repeat(43) }).status, 0)
})
test('invalid Owner, probe, intake and legacy retirement switch combinations fail closed', () => {
  for (const changes of [
    { C_POCKET_ENABLE_UNIFIED_OWNER: 'true' },
    { C_POCKET_ENABLE_MCP_FILE_HOST_PROBE: 'true' },
    { C_POCKET_ENABLE_OWNER_TAXONOMY_CREATE: 'true' },
    { C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true' },
    { C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true' },
    { C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3: 'true' },
    { C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'true' },
    { C_POCKET_ENABLE_LEGACY_MCP: 'false' },
    { C_POCKET_ENABLE_MCP_CAPTURE: 'true' },
    { ...enabledOwner, C_POCKET_MCP_CAPTURE_PATH: base.C_POCKET_MCP_PATH },
    { ...enabledOwner, C_POCKET_MCP_CAPTURE_PATH: '/mcp/short' },
    { C_POCKET_ENABLE_MCP_FILE_HOST_PROBE: 'TRUE' },
    { ...enabledOwner, C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true' },
  ]) {
    const output = check(changes)
    assert.equal(output.status, 1, JSON.stringify(changes))
    assert.match(output.stderr, /Production configuration rejected:/)
    assert.ok(!output.stderr.includes(secret), 'Never print secrets to production logs.')
  }
})
test('same-path Owner upgrades require three explicit flags, no new MCP path and keep old route enabled', () => {
  const inPlace = {
    C_POCKET_ENABLE_OWNER_IN_PLACE: 'true',
    C_POCKET_ENABLE_MCP_CAPTURE: 'true',
    C_POCKET_ENABLE_UNIFIED_OWNER: 'true',
  }
  const enabled = check(inPlace)
  assert.equal(enabled.status, 0, enabled.stderr)
  assert.ok(!enabled.stdout.includes(base.C_POCKET_MCP_PATH))

  // The old production path is valid with 32 random URL-safe characters, no rotation.
  const smallest = check({ ...inPlace, C_POCKET_MCP_PATH: '/mcp/' + 'Q'.repeat(32) })
  assert.equal(smallest.status, 0, smallest.stderr)

  for (const changes of [
    { C_POCKET_ENABLE_OWNER_IN_PLACE: 'true' },
    { ...inPlace, C_POCKET_ENABLE_MCP_CAPTURE: 'false' },
    { ...inPlace, C_POCKET_ENABLE_UNIFIED_OWNER: 'false' },
    { ...inPlace, C_POCKET_ENABLE_LEGACY_MCP: 'false' },
    { ...inPlace, C_POCKET_MCP_CAPTURE_PATH: '/mcp/' + 'W'.repeat(43) },
    { ...inPlace, C_POCKET_MCP_PATH: '/mcp/unsafe' },
    { ...inPlace, C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true' },
  ]) {
    const result = check(changes)
    assert.equal(result.status, 1, JSON.stringify(changes))
    assert.ok(!result.stderr.includes(base.C_POCKET_MCP_PATH))
    assert.ok(!result.stderr.includes(secret))
  }
  assert.equal(check({ ...inPlace, C_POCKET_ENABLE_MCP_FILE_HOST_PROBE: 'true' }).status, 0)
  assert.equal(check({
    ...inPlace, C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true',
    C_POCKET_MCP_FILE_HOSTS: 'uploads.example.org',
  }).status, 0)
  assert.equal(check({ ...inPlace, C_POCKET_ENABLE_OWNER_TAXONOMY_CREATE: 'true' }).status, 0)
  assert.equal(check({ ...inPlace, C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true' }).status, 0)
  assert.equal(check({ ...inPlace, C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true', C_POCKET_MCP_FILE_HOSTS: '' }).status, 0)
  assert.equal(check({ C_POCKET_ENABLE_OWNER_IN_PLACE: 'false' }).status, 0)
})

test('read-only hostname probe can run without file downloads being enabled', () => {
  const result = check({ ...enabledOwner, C_POCKET_ENABLE_MCP_FILE_HOST_PROBE: 'true' })
  assert.equal(result.status, 0, result.stderr)
  const rollback = check({ ...enabledOwner, C_POCKET_ENABLE_LEGACY_MCP: 'false' })
  assert.equal(rollback.status, 0, rollback.stderr)
})
test('download allowlist rejects wildcard, raw URL, IP and empty values', () => {
  for (const host of ['', '*.example.org', 'https://uploads.example.org/file?token=SECRET',
    '127.0.0.1', 'uploads.example.org,', 'localhost', 'files.local']) {
    const result = check({ ...enabledOwner, C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true',
      C_POCKET_MCP_FILE_HOSTS: host })
    assert.equal(result.status, 1, host)
    assert.ok(!result.stderr.includes(secret))
    assert.ok(!result.stderr.includes('https://uploads.example.org/file?'))
  }
  assert.equal(check({ ...enabledOwner, C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true',
    C_POCKET_MCP_FILE_HOSTS: 'uploads.example.org' }).status, 0)
})

test('V3 requires BOTH file lanes plus reviewed exact hosts, never a wildcard', () => {
  const owner = {
    C_POCKET_ENABLE_OWNER_IN_PLACE: 'true',
    C_POCKET_ENABLE_MCP_CAPTURE: 'true',
    C_POCKET_ENABLE_UNIFIED_OWNER: 'true',
    C_POCKET_MCP_CAPTURE_PATH: '',
  }
  for (const overrides of [
    { C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true', C_POCKET_MCP_FILE_HOSTS: 'uploads.example.org' },
    { C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true' },
    { C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true', C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true', C_POCKET_MCP_FILE_HOSTS: '*.example.org' },
  ]) {
    const rejected = check({
      ...owner, ...overrides, C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3: 'true',
    })
    assert.equal(rejected.status, 1)
    assert.ok(!rejected.stderr.includes(secret))
  }
  const allowed = check({
    ...owner,
    C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true',
    C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true',
    C_POCKET_ENABLE_MCP_FILE_SMART_ROUTE_V3: 'true',
    C_POCKET_MCP_FILE_HOSTS: 'uploads.example.org',
  })
  assert.equal(allowed.status, 0, allowed.stderr)
})


test('one-click widget POC requires all existing file lanes and remains independently default-off', () => {
  const owner = {
    C_POCKET_ENABLE_MCP_CAPTURE: 'true', C_POCKET_ENABLE_UNIFIED_OWNER: 'true',
    C_POCKET_MCP_CAPTURE_PATH: '/mcp/' + 'W'.repeat(43),
  }
  for (const changes of [
    { C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'true' },
    { ...owner, C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'true' },
    { ...owner, C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'true',
      C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true', C_POCKET_MCP_FILE_HOSTS: 'approved.example.org' },
  ]) assert.equal(check(changes).status, 1)
  const pass = check({
    ...owner, C_POCKET_ENABLE_ONE_CLICK_KEEP_POC: 'true',
    C_POCKET_ENABLE_MCP_FILE_INTAKE: 'true',
    C_POCKET_ENABLE_MCP_FILE_TRANSFER_V2: 'true',
    C_POCKET_MCP_FILE_HOSTS: 'approved.example.org',
  })
  assert.equal(pass.status, 0, pass.stderr)
})
