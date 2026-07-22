import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = process.argv[2]
if (!url) throw new Error('Usage: node server/check-remote.js https://host/mcp')

const client = new Client({ name: 'c-pocket-remote-check', version: '1.0.0' })
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name).sort()
  assert.equal(names.includes('pocket_list'), true)
  assert.equal(names.includes('memory_turn_pre'), true)
  console.log(JSON.stringify({ ok: true, toolCount: names.length, tools: names }))
} finally {
  await client.close()
}
