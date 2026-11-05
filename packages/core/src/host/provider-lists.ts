import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionStorage } from './storage.ts'
import { parentOf, sessionOrigin } from './session-origin.ts'

/** Public lifecycle offsets distinguish a fresh ordinary fork from its persisted resume. */
export function isNewConversation(session: Session): boolean {
  const origin = sessionOrigin(session.header)
  if (origin.kind === 'subagent') return false
  // A new fork owns its marker/closers at the inherited cut; restore begins after them.
  if (origin.seeded) return session.firstLifecycleSeq === session.inheritedEventCount
  return session.firstLiveSeq === 0 && session.firstLifecycleSeq === 0
}

/** Immutable conversation authorization, sharing the selection queue and storage lifetime. */
export class ProviderLists<O extends Record<string, unknown>, S> {
  constructor(private readonly storage: SessionStorage<O, S>) {}

  read(agent: Agent): Promise<readonly string[] | undefined> {
    return this.storage.exclusive(agent.session.id, async () => {
      const table = (await this.storage.domain()).table('provider_lists')
      return this.nonempty(table.get(agent.session.id))
    })
  }

  create(agent: Agent, initial: readonly string[] | undefined): Promise<readonly string[] | undefined> {
    return this.storage.exclusive(agent.session.id, async () => {
      const table = (await this.storage.domain()).table('provider_lists')
      const stored = table.get(agent.session.id)
      if (stored !== undefined) return this.nonempty(stored)
      const parent = parentOf(sessionOrigin(agent.session.header))
      let ids: readonly string[] | undefined
      if (parent !== undefined) {
        await this.storage.settled(parent)
        ids = table.get(parent)
      } else ids = initial
      if (ids === undefined) return undefined
      await table.put(agent.session.id, [...ids])
      return this.nonempty(ids)
    })
  }

  private nonempty(ids: readonly string[] | undefined): readonly string[] | undefined {
    return ids === undefined || ids.length === 0 ? undefined : [...ids]
  }
}
