import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/** Only subagent headers carry inheritance; ordinary forks are independent, including historical parent fields. */
export type SessionOrigin =
  | { readonly kind: 'top-level'; readonly seeded: boolean }
  | { readonly kind: 'subagent'; readonly parent: SessionId | undefined; readonly seeded: boolean }

export function sessionOrigin(header: Pick<SessionHeader, 'parentSession' | 'isSeeded' | 'origin'>): SessionOrigin {
  const { parentSession: parent, isSeeded: seeded, origin } = header
  if (origin === 'subagent') return { kind: 'subagent', parent, seeded }
  return { kind: 'top-level', seeded }
}

export function parentOf(origin: SessionOrigin): SessionId | undefined {
  return origin.kind === 'top-level' ? undefined : origin.parent
}
