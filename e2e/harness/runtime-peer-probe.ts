import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { type E2EContext, profileDir } from './environment.ts'
import { bootHost } from './host.ts'
import { auditHostRuntime } from './host-runtime-peers.ts'

// Separate real profiles run in separate Node processes. TUI 0.16.1 patches Cordis
// globally and cannot load two independently installed copies into one isolate.
const [install, profileName, overlay, output] = process.argv.slice(2)
assert(install !== undefined && profileName !== undefined && overlay !== undefined && output !== undefined)
const env: Record<string, string> = {}
for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value
const e2e: E2EContext = { install, cli: join(install, 'node_modules/.bin/dsh'), env, tarballs: {} }
const host = await bootHost(e2e, [overlay], () => {}, profileName)
try {
  const directory = profileDir(e2e, profileName)
  const report = auditHostRuntime(directory, ['@deepseek-harness-tui/dsh-tui', SEARCH.packageName, FETCH.packageName, '@deepseek-ai/dsh-agent'], host.resolution)
  const require = createRequire(join(directory, 'package.json'))
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) as typeof import('@deepseek-ai/cordis')
  assert(host.ctx instanceof Context, 'Host and plugins must share the selected Cordis class')
  writeFileSync(output, JSON.stringify({ ...report, contextClassIdentity: true }, null, 2))
} finally { await host.dispose() }
