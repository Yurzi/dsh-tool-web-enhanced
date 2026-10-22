import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { WebError } from '@deepseek-ai/dsh-web'
import type { OptionsCodec } from './capability.ts'
import { capabilityErrors } from './errors.ts'

/** Capability codecs own the option fields; these three fields belong to core. */
export interface StoredSelection extends Record<string, unknown> {
  readonly connectionId: string | null
  readonly revision: number
  readonly inherited?: boolean | undefined
}

export function selectionDomain(name: string) {
  const selection = z.looseObject({ connectionId: z.string().nullable(), revision: z.number().int().nonnegative(), inherited: z.boolean().optional() })
  const pairing = z.strictObject({ connectionId: z.string().nullable() })
  return defineDomain({ name, version: 1, tables: {
    selections: domainTable<string, StoredSelection>(selection),
    pairings: domainTable<string, z.output<typeof pairing>>(pairing),
    provider_lists: domainTable<string, string[]>(z.array(z.string())),
  } })
}
export type SelectionDomain = Domain<ReturnType<typeof selectionDomain>>
export interface DomainAccess { domain(): Promise<SelectionDomain> }

/** Lazy open; a missing or replaced facility can recover on the next read. */
export function openDomain(ctx: Context, name: string, unavailable = () => capabilityErrors(name).error('WEB_PROVIDER_ERROR', 'selection storage is unavailable; retry or ask the user to check the DSH storage backend')): DomainAccess {
  const spec = selectionDomain(name)
  let disposed = false
  let opened: { facility: DomainFacility; domain: Promise<SelectionDomain> } | undefined
  ctx.effect(() => async () => {
    disposed = true
    const closing = opened
    opened = undefined
    if (closing !== undefined) await closing.domain.then(domain => domain.close(), error => {
      ctx.logger.warn('%s: storage did not open before disposal: %s', name, error)
    })
  }, name + ' storage')
  return {
    async domain() {
      if (disposed) throw unavailable()
      const facility = ctx.get('storageDomain')
      if (facility === undefined) throw unavailable()
      if (opened === undefined || opened.facility !== facility) opened = { facility, domain: facility.open(spec) }
      const current = opened
      try {
        const domain = await current.domain
        if (disposed) throw unavailable()
        return domain
      } catch (error) {
        if (opened === current) opened = undefined
        ctx.logger.warn('%s: opening selection storage failed: %s', name, error)
        throw unavailable()
      }
    },
  }
}

/** Couples persistent option encoding to the domain, without retaining any global state. */
export class SessionStorage<O extends Record<string, unknown>, S> implements DomainAccess {
  private readonly access: DomainAccess
  private readonly queues = new Map<string, Promise<void>>()
  constructor(ctx: Context, name: string, readonly optionsCodec: OptionsCodec<O, S>, unavailable?: () => WebError) {
    this.access = openDomain(ctx, name, unavailable)
  }
  domain(): Promise<SelectionDomain> { return this.access.domain() }

  exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id)
    const run = previous === undefined ? work() : previous.then(work)
    // Callers retain the rejection; only the queue tail settles to admit later work.
    const tail = run.then(() => {}, () => {})
    this.queues.set(id, tail)
    void tail.then(() => { if (this.queues.get(id) === tail) this.queues.delete(id) })
    return run
  }

  settled(id: string): Promise<void> | undefined { return this.queues.get(id) }
}
