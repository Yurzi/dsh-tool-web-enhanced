import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/** Session lineage from public headers; subagent ownership takes precedence over fork lineage. */
export type SessionOrigin =
  | { readonly kind: 'top-level'; readonly seeded: boolean }
  | { readonly kind: 'fork'; readonly parent: SessionId; readonly seeded: boolean }
  | { readonly kind: 'subagent'; readonly parent: SessionId | undefined; readonly seeded: boolean }

export function sessionOrigin(header: Pick<SessionHeader, 'parentSession' | 'isSeeded' | 'origin'>): SessionOrigin {
  const { parentSession: parent, isSeeded: seeded, origin } = header
  if (origin === 'subagent') return { kind: 'subagent', parent, seeded }
  return parent === undefined ? { kind: 'top-level', seeded } : { kind: 'fork', parent, seeded }
}

export function parentOf(origin: SessionOrigin): SessionId | undefined {
  return origin.kind === 'top-level' ? undefined : origin.parent
}
