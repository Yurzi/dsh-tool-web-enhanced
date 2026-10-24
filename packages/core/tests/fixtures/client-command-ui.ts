/**
 * DSH's real browser command surface (CommandUiRuntime from the published
 * dsh-client-ui-commands bundle) over one Host Session's command catalog.
 * Only the services it consumes are structural fakes: the `/` source registry
 * (inputTriggers), the Session layer (sessions) and the `remote.commands`
 * Remote, whose `execute` runs the test's Host handler.
 */
import { readFileSync } from 'node:fs'
import { runInNewContext, runInThisContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommandContribution, CommandDecoration, CommandUiRuntime, filterOptions, PopupState } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { CommandClaim, PickOutcome, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandDescriptor, CommandResult } from '@deepseek-ai/dsh-commands/types'
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'

interface CommandUiModule {
  readonly CommandUiRuntime: typeof CommandUiRuntime
  readonly filterOptions: typeof filterOptions
}

/** Execute the shipped client bundle with its documented module-loader protocol. */
function loadBundle(): CommandUiModule {
  const modules: Record<string, unknown> = {
    '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': clientStore, '@deepseek-ai/dsh-client-ui-primitives': primitives,
    react: React, 'react/jsx-runtime': jsxRuntime,
  }
  let loaded: unknown
  const loaderWindow = { __ModuleLoader__: { load({ factory }: { factory: (require: (id: string) => unknown) => unknown }) {
    loaded = factory(id => {
      if (!Object.hasOwn(modules, id)) throw new Error('unprovided platform module: ' + id)
      return modules[id]
    })
  } } }
  const script = readFileSync(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-commands/client')), 'utf8')
  const nodeStructuredClone = runInThisContext('structuredClone') as typeof structuredClone
  runInNewContext(script, { window: loaderWindow, console, navigator, queueMicrotask, structuredClone: nodeStructuredClone, AbortController })
  return loaded as CommandUiModule
}

const bundle = loadBundle()

/** One row of the `/` menu as the composer receives it. */
export interface MenuRow {
  readonly name: string
  readonly label?: string
  readonly description?: string
  readonly hint?: string
}

/** The parts of the `/` source (input-trigger's InputTriggerSource) these tests drive. */
interface CommandSource {
  candidates(session: { sessionId: string }, request: { query: string; position: 'leading'; drilled: boolean; signal: AbortSignal }): Promise<readonly MenuRow[]>
  onPick(pick: {
    candidate: MenuRow; session: { sessionId: string }; position: 'leading'; via: 'menu'; action: 'pick'
    span: { start: number; end: number; draftRev: number }
  }): PickOutcome
  matchEnter(session: { sessionId: string }, line: string, signal: AbortSignal, envelope: { attachments: number }): Promise<PickOutcome>
}

export interface HostCommandsSpec {
  /** The one Session the browser has open. */
  readonly sessionId: string
  /** The Session's Host command catalog. */
  readonly commands: readonly CommandDescriptor[]
  /** The Host handler of an admitted line. */
  readonly execute: (line: string) => CommandResult | Promise<CommandResult>
}

export interface CommandUiHarness {
  /** The `remote.commands` Remote; the caller's `remote` service must carry it as `commands`. */
  readonly remote: {
    list(sessionId: string): Promise<{ ok: true; value: readonly CommandDescriptor[] }>
    execute(sessionId: string, line: string): Promise<{ ok: true; value: { commandId: string; result: CommandResult } | undefined }>
  }
  /** Client registrations on the runtime by name (decorations and contributions), removed by their disposers. */
  readonly commands: ReadonlyMap<string, CommandDecoration>
  /** Settles once the first client registration landed. */
  readonly registered: Promise<void>
  /** Lines the Host executed, in order. */
  readonly executed: readonly string[]
  /**
   * Provide the services the runtime consumes and mount it. `locale` and
   * `remote` must already be provided, the latter carrying {@link remote} as `commands`.
   */
  mount(ctx: cordis.Context): Promise<void>
  /** The empty-query `/` menu. */
  rows(): Promise<readonly MenuRow[]>
  /** Pick a menu row, as a click does once the menu shows. */
  pick(name: string): Promise<PickOutcome>
  /** The Session's popup once its options settled. */
  popup(): Promise<PopupState>
  /** Choose a row of the open popup by option id. */
  choose(id: string): Promise<void>
  /** Press Enter on a draft line; an argued line the Host command claims is then submitted. */
  enter(line: string): Promise<PickOutcome>
  /** Submit an argued line through the Host command's claim, as the composer does after Enter. */
  submit(line: string): Promise<SubmitOutcome>
}

export function commandUiHarness(spec: HostCommandsSpec): CommandUiHarness {
  const commands = new Map<string, CommandDecoration>()
  const executed: string[] = []
  const registered = Promise.withResolvers<void>()
  let root: cordis.Context | undefined
  let source: CommandSource | undefined
  const session = { sessionId: spec.sessionId }
  const signal = new AbortController().signal

  const runtime = (): CommandUiRuntime => {
    if (root === undefined) throw new Error('command UI is not mounted')
    const service = root.get('commandUi')
    if (service === undefined) throw new Error('command UI runtime is not running')
    return service
  }
  const menu = (): CommandSource => {
    if (source === undefined) throw new Error('the command source is not registered')
    return source
  }
  const popup = () => {
    if (root === undefined) throw new Error('command UI is not mounted')
    return runtime().popupFor(root)
  }

  class ObservedRuntime extends bundle.CommandUiRuntime {
    override register(contribution: CommandContribution): () => void {
      return observe(contribution, super.register(contribution))
    }

    override decorate(decoration: CommandDecoration): () => void {
      return observe(decoration, super.decorate(decoration))
    }
  }
  function observe(registration: CommandDecoration, dispose: () => void): () => void {
    commands.set(registration.name, registration)
    registered.resolve()
    return () => {
      commands.delete(registration.name)
      dispose()
    }
  }

  return {
    remote: {
      list: async () => ({ ok: true, value: spec.commands }),
      async execute(_sessionId, line) {
        const name = line.trim().split(/\s/u, 1)[0]?.slice(1)
        if (!spec.commands.some(command => command.name === name)) return { ok: true, value: undefined }
        executed.push(line)
        return { ok: true, value: { commandId: 'command-' + executed.length, result: await spec.execute(line) } }
      },
    },
    commands,
    registered: registered.promise,
    executed,
    async mount(ctx) {
      root = ctx
      ctx.provide('remote.commands', this.remote)
      ctx.provide('inputTriggers', {
        registerSource(registeredSource: CommandSource) {
          source = registeredSource
          return () => { source = undefined }
        },
      })
      const face = { sessionId: spec.sessionId, getSnapshot: () => ({ openState: 'open' }), subscribe: () => () => {} }
      const binding = { sessionId: spec.sessionId, session: face, ctx }
      ctx.provide('sessions', {
        subagentAddress: () => undefined,
        binding: (id: string) => id === spec.sessionId ? binding : undefined,
        using: async (_id: string, _options: unknown, operation: (reference: { binding: typeof binding }) => unknown) => operation({ binding }),
        scope: (id: string) => id === spec.sessionId ? ctx : undefined,
        sessionOf: (scope: cordis.Context) => scope === ctx ? face : undefined,
      })
      await ctx.plugin(ObservedRuntime)
    },
    rows: () => menu().candidates(session, { query: '', position: 'leading', drilled: false, signal }),
    async pick(name) {
      const row = (await this.rows()).find(candidate => candidate.name === name)
      if (row === undefined) throw new Error('no menu row /' + name)
      return menu().onPick({ candidate: row, session, position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: name.length + 1, draftRev: 0 } })
    },
    popup() {
      const state = popup().state
      return new Promise(resolve => {
        const settled = () => {
          const current = state.getSnapshot()
          if (!current.open || current.status === 'pending') return false
          resolve(current)
          return true
        }
        if (settled()) return
        const stop = state.subscribe(() => { if (settled()) stop() })
      })
    },
    async choose(id) {
      const { options, search, searchMode } = await this.popup()
      const index = bundle.filterOptions(options, search, searchMode).findIndex(option => option.id === id)
      if (index === -1) throw new Error('no popup option ' + id)
      await popup().select(index)
    },
    enter: line => menu().matchEnter(session, line, signal, { attachments: 0 }),
    async submit(line) {
      const outcome = await this.enter(line)
      if (typeof outcome !== 'object' || !('claim' in outcome)) throw new Error('the line was not claimed by a Host command: ' + line)
      const claim: CommandClaim = outcome.claim
      if (root === undefined) throw new Error('command UI is not mounted')
      return claim.submit(line.trim().slice(claim.token.trim().length).trimStart(), root, [])
    },
  }
}
