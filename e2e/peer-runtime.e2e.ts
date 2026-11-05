import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, inject, it } from 'vitest'
import { FETCH, SEARCH, UI } from 'dsh-tool-web-enhanced-core/shared'
import { bootHost } from './harness/host.ts'
import { artifacts, enterIsolatedEnvironment, profileDir } from './harness/environment.ts'
import { auditHostRuntime } from './harness/host-runtime-peers.ts'

const e2e = inject('e2e')

it('the packed profile resolves one exact rc.1 DSH graph and the same Cordis module identity as its Host', async () => {
  enterIsolatedEnvironment(e2e.env)
  // rc.1 routes Host peers through the public PluginPackages runtime interception.
  const host = await bootHost(e2e)
  try {
    const report = auditHostRuntime(profileDir(e2e), [SEARCH.packageName, FETCH.packageName, UI.packageName, '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-tools'], host.resolution)
    writeFileSync(join(artifacts, 'runtime-peers-profile.json'), JSON.stringify(report, null, 2))
    expect(report.peers['@deepseek-ai/cordis']).toBeDefined()
    const require = createRequire(join(profileDir(e2e), 'package.json'))
    const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) as typeof import('@deepseek-ai/cordis')
    expect(host.ctx).toBeInstanceOf(Context)
  } finally { await host.dispose() }
})
