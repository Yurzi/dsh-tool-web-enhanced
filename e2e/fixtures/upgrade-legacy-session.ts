/** A separate process keeps old plugin ESM modules out of the upgraded Host. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { type E2EContext, artifacts, enterIsolatedEnvironment } from '../harness/environment.ts'
import { bootHost } from '../harness/host.ts'

const fixture = (name: string) => join(import.meta.dirname, name)

// Exact public domain declaration from predecessor 0.1.10 src/host/storage.ts.
// Its packed entry point does not export the spec. Storage format/paths remain
// entirely owned by DSH; never synthesize the JSON backend's files ourselves.
const legacySelection = z.object({
  connectionId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  freshness: z.enum(['auto', 'fresh', 'realtime']).optional(),
}).strict()
const legacyPairing = z.object({ connectionId: z.string().nullable() }).strict()
const legacyDomain = defineDomain({
  name: 'web_search_enhanced',
  version: 1,
  tables: {
    selections: domainTable<string, z.output<typeof legacySelection>>(legacySelection),
    pairings: domainTable<string, z.output<typeof legacyPairing>>(legacyPairing),
  },
})

/** Create a real old-preset Session, then persist off through DSH's domain facility. */
async function createLegacyOffSession(e2e: E2EContext): Promise<SessionId> {
  const old = await bootHost(e2e)
  let sessionId: SessionId
  try {
    const created = await old.ctx.sessionController.create({ cwd: dirname(e2e.env.DSH_HOME!) })
    sessionId = created.sessionId
    // Exercise the installed old Remote, whose flat freshness shape differs
    // from the new API. A missing row/service must fail before seeding anything.
    const remote = old.ctx.get('searchConnections') as unknown as { get(request: { sessionId: string }): Promise<{ selection: unknown }> } | undefined
    if (remote === undefined) throw new Error('the predecessor searchConnections service did not activate')
    const selection = legacySelection.parse((await remote.get({ sessionId })).selection)
    writeFileSync(join(artifacts, 'upgrade-old-selection.json'), JSON.stringify({ sessionId, selection }, null, 2))
    if (selection.connectionId !== 'builtin:exa' || selection.revision !== 0 || selection.freshness !== 'fresh') {
      throw new Error(`the running predecessor did not read its persisted settings: ${JSON.stringify(selection)}`)
    }
    const found = await old.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in found) throw found.error
    // Host-side SessionStore; the browser packages in this program merge their own `sessions` type into Context.
    const sessions = old.ctx.get('sessions') as SessionStore | undefined
    if (sessions === undefined) throw new Error('the old Host has no session store')
    if (!await sessions.flush(found.agent.session)) throw new Error('the old Session has no persistence listener')
  } finally {
    await old.dispose()
  }

  // The old plugin opens its domain during agent/created. Stop that owner first;
  // this temporary host overlay releases the domain for the reconstructed spec.
  // It never changes the persisted user layer or the upgraded profile.
  const writer = await bootHost(e2e, [fixture('disable-search.yml')])
  try {
    const domain = await writer.ctx.storageDomain.open(legacyDomain)
    try {
      // update rejects missing records: only the old plugin may create this
      // record. Never hide a failed old installation by fabricating a selection.
      await domain.table('selections').update(sessionId, current => ({ ...current, connectionId: null, revision: current.revision + 1 }))
    } finally {
      await domain.close()
    }
  } finally {
    await writer.dispose()
  }
  return sessionId
}

const [contextFile] = process.argv.slice(2)
if (contextFile === undefined) throw new Error('usage: upgrade-legacy-session.ts <context.json>')
const e2e = JSON.parse(readFileSync(contextFile, 'utf8')) as E2EContext
enterIsolatedEnvironment(e2e.env)
const sessionId = await createLegacyOffSession(e2e)
process.stdout.write(JSON.stringify({ sessionId }) + '\n')
