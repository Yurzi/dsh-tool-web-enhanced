import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { expect } from 'vitest'

/** Mount rc.1's real Controller assembly; callers own AgentLoop, storage and the unused upload-resolver seam. */
export async function mountSessionController(ctx: Context, root: string): Promise<SessionController> {
  if (ctx.get('agentDefaultModel') === undefined) await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'm' })
  if (ctx.get('fs') === undefined) await ctx.plugin(FsLocal)
  if (ctx.get('typert') === undefined) await ctx.plugin(TypertRegistry)
  if (ctx.get('remoteAccess') === undefined) await ctx.plugin(RemoteAccess)
  if (ctx.get('typertGateway') === undefined) await ctx.plugin(Gateway, {})
  if (ctx.get('attachments') === undefined) await ctx.plugin(AttachmentLocal, { dshHome: join(root, 'attachments-home') })
  if (ctx.get('sessionPersistence') === undefined) {
    await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  }
  // These are published Controller peers, resolved from that package's dependency tree on a clean install.
  const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-session-controller'))
  if (ctx.get('sessionQuery') === undefined) {
    type Query = Context['sessionQuery']
    const { default: SessionQuery }: { default: abstract new (ctx: Context) => Query } = await import(require.resolve('@deepseek-ai/dsh-session-query'))
    class ExactReadQuery extends SessionQuery {
      override searchSessions(..._args: Parameters<Query['searchSessions']>): ReturnType<Query['searchSessions']> {
        throw new Error('Controller fixture does not support full-text session search')
      }
      override searchEvents(..._args: Parameters<Query['searchEvents']>): ReturnType<Query['searchEvents']> {
        throw new Error('Controller fixture does not support full-text event search')
      }
    }
    await ctx.plugin(ExactReadQuery)
  }
  if (ctx.get('workspaceRegistry') === undefined) {
    const { default: Workspace }: { default: Plugin } = await import(require.resolve('@deepseek-ai/dsh-workspace'))
    await ctx.plugin(Workspace)
  }
  await ctx.plugin(SessionController, { nativeOpen: false })
  let controller: SessionController | undefined
  await ctx.inject(['sessionController'], scope => { controller = scope.sessionController })
  expect(controller).toBeDefined()
  return controller!
}
