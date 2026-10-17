const errors = []

requireSecret('C_POCKET_BRIDGE_TOKEN', 32)
requireSecret('C_POCKET_DRAWER_SECRET', 32)
requireSecret('C_POCKET_DROP_SECRET', 48)

const mcpPath = cleanEnvironmentValue(process.env.C_POCKET_MCP_PATH)
if (!/^\/mcp\/[A-Za-z0-9_-]{32,}$/.test(mcpPath)) {
  errors.push('C_POCKET_MCP_PATH must be /mcp/<32+ random characters>.')
}

if (process.env.HOST !== '0.0.0.0') {
  errors.push('HOST must be 0.0.0.0 inside the private production container network.')
}

// Optional Owner configuration is dormant by default. Validate combinations
// before any production switch is enabled; never print secret values/URLs.
const flags = {
  capture: flag('C_POCKET_ENABLE_MCP_CAPTURE'),
  owner: flag('C_POCKET_ENABLE_UNIFIED_OWNER'),
  inPlace: flag('C_POCKET_ENABLE_OWNER_IN_PLACE'),
  hostProbe: flag('C_POCKET_ENABLE_MCP_FILE_HOST_PROBE'),
  fileIntake: flag('C_POCKET_ENABLE_MCP_FILE_INTAKE'),
  legacy: flag('C_POCKET_ENABLE_LEGACY_MCP', true),
}
if (flags.owner && !flags.capture) {
  errors.push('Unified Owner requires C_POCKET_ENABLE_MCP_CAPTURE=true.')
}
if (flags.hostProbe && (!flags.owner || !flags.capture)) {
  errors.push('File Host Probe requires the unified Owner and Capture switches.')
}
if (flags.fileIntake && (!flags.owner || !flags.capture)) {
  errors.push('File Intake requires the unified Owner and Capture switches.')
}
if (flags.inPlace && (!flags.owner || !flags.capture || !flags.legacy)) {
  errors.push('In-place Owner requires Capture, Unified Owner, and Legacy MCP enabled.')
}
if (!flags.legacy && !flags.owner) {
  errors.push('Legacy MCP cannot be retired without unified Owner.')
}
if (flags.capture) {
  const writerPath = cleanEnvironmentValue(process.env.C_POCKET_MCP_CAPTURE_PATH)
  if (flags.inPlace) {
    if (writerPath) errors.push('In-place Owner forbids a second C_POCKET_MCP_CAPTURE_PATH.')
  } else if (!/^\/mcp\/[A-Za-z0-9_-]{43,}$/u.test(writerPath) || writerPath === mcpPath) {
    errors.push('Split-path Capture requires a distinct /mcp/<43+ random chars> private path.')
  }
}
const hostValue = cleanEnvironmentValue(process.env.C_POCKET_MCP_FILE_HOSTS)
const hostEntries = hostValue ? hostValue.split(',').map((part) => part.trim().toLowerCase()) : []
const hostsValid = hostEntries.length > 0 && hostEntries.every((host) =>
  /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(host)
  && !host.startsWith('-') && !host.includes('..')
  && !host.endsWith('.local') && !host.endsWith('.internal')
)
if (hostValue && !hostsValid) {
  errors.push('C_POCKET_MCP_FILE_HOSTS must be comma-separated exact DNS hostnames (no URL, wildcard or IP).')
}
if (flags.fileIntake && !hostsValid) {
  errors.push('Active File Intake requires an explicitly reviewed, valid C_POCKET_MCP_FILE_HOSTS allowlist.')
}

if (errors.length) {
  console.error(`Production configuration rejected:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

console.log('Production configuration passed the secret and network checks.')

function flag(name, defaultValue = false) {
  const raw = cleanEnvironmentValue(process.env[name])
  if (!raw) return defaultValue
  if (raw !== 'true' && raw !== 'false') {
    errors.push(name + ' must be exactly true or false.')
  }
  return raw === 'true'
}

function requireSecret(name, minimumLength) {
  const value = cleanEnvironmentValue(process.env[name])
  if (value.length < minimumLength || /replace|example|password|secret/i.test(value)) {
    errors.push(`${name} must contain at least ${minimumLength} non-placeholder characters.`)
  }
}

function cleanEnvironmentValue(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim()
}
