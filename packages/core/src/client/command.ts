import type { Context } from '@deepseek-ai/cordis'
import type { CommandDecoration, SelectOption, SelectOptionGroup } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SelectionView } from '../shared/selection.ts'
import type { ConnectionText, SelectionState, SelectionStore, SelectionUpdate } from './section.ts'

export type ClientTranslate<K extends string = string> = (key: K, params?: Record<string, string | number>) => string
export type CommandCopyKey = 'placeholder' | 'empty' | 'noResults' | 'readFailed' | 'current' | 'off'
export type CommandDetail = (hint: string | undefined, current: boolean) => { detail?: string }

export interface CommandOptions<V extends SelectionView> {
  choices(view: V, detail: CommandDetail): readonly SelectOption[]
  parse(id: string): SelectionUpdate | undefined
  isCurrent(update: SelectionUpdate, selection: V['selection']): boolean
}

export interface SelectionCommandSpec<V extends SelectionView, K extends string> {
  /** The capability's Host command (`PluginIdentity.command`). */
  readonly name: string
  readonly t: ClientTranslate<K>
  readonly keys: Readonly<Record<CommandCopyKey, K>>
  readonly groups: (view: V) => readonly { group: SelectOptionGroup; connections: readonly V['connections'][number][] }[]
  readonly describe: (connection: V['connections'][number]) => ConnectionText
  readonly writeFailureText: (error: RemoteFailure) => string
  readonly options?: CommandOptions<V>
}

/** Shared ids cannot be shadowed by capability-specific option groups. */
export function parseSelectionCommandOption(id: string, parseOptions?: (id: string) => SelectionUpdate | undefined): SelectionUpdate | undefined {
  if (id === 'off') return { connectionId: null }
  const prefix = 'connection:'
  if (id.startsWith(prefix) && id.length > prefix.length) return { connectionId: id.slice(prefix.length) }
  return parseOptions?.(id)
}

/**
 * The browser's bare invocation of the capability's Host command: a popup over
 * the same per-session store the composer menu uses. The Host command keeps its
 * menu row and runs every line with arguments.
 */
export function selectionCommand<V extends SelectionView, K extends string>(
  selections: SelectionStore<V> & { current(sessionId: string): Promise<SelectionState<V>> },
  spec: SelectionCommandSpec<V, K>,
): CommandDecoration {
  const t = (key: CommandCopyKey) => spec.t(spec.keys[key])
  const read = async (sessionId: string) => {
    const { view, readFailure } = await selections.current(sessionId)
    if (view === undefined || readFailure !== undefined) throw new Error(t('readFailed'))
    return view
  }
  return {
    name: spec.name,
    available: () => true,
    ui: {
      kind: 'popupSelect',
      searchLabels: () => ({ placeholder: t('placeholder'), empty: t('empty'), noResults: t('noResults') }),
      async options(session) {
        const view = await read(session.sessionId)
        const { connectionId } = view.selection
        const detail: CommandDetail = (hint, current) => {
          const text = [hint, current ? t('current') : undefined].filter(part => part !== undefined).join(' · ')
          return text === '' ? {} : { detail: text }
        }
        const options: SelectOption[] = [
          { id: 'off', label: t('off'), ...detail(undefined, connectionId === null), ...(connectionId === null ? { active: true } : {}) },
        ]
        for (const { group, connections } of spec.groups(view)) {
          for (const connection of connections) {
            if (connection.status !== 'ready') continue
            const text = spec.describe(connection)
            options.push({ id: 'connection:' + connection.id, label: text.label, group,
              ...detail(text.caption, connection.id === connectionId), ...(connection.id === connectionId ? { active: true } : {}) })
          }
        }
        if (spec.options !== undefined) options.push(...spec.options.choices(view, detail))
        return options
      },
      async onSelect(option, session) {
        const options = spec.options
        const update = parseSelectionCommandOption(option.id, options === undefined ? undefined : id => options.parse(id))
        if (update === undefined) return
        const { selection } = await read(session.sessionId)
        const current = update.connectionId !== undefined
          ? update.connectionId === selection.connectionId
          : spec.options !== undefined && spec.options.isCurrent(update, selection)
        if (current) return
        const result = await selections.set(session.sessionId, update)
        if (!result.ok) throw new Error(spec.writeFailureText(result.error))
      },
    },
  }
}

/**
 * Call `ran` after this browser ran the Host command `name` in a Session. A line
 * with arguments (`/setup-search off`) writes on the Host without the selection
 * store, so that Session's views must read again. DSH reports each Host command
 * this browser executed with `command/executed`, without its arguments, so every
 * run counts; runs from another browser or the TUI are not reported here.
 * @returns the listener's disposer; it also ends with `ctx`'s fiber.
 */
export function followHostCommand(ctx: Context, name: string, ran: (sessionId: string) => void): () => void {
  return ctx.on('command/executed', (sessionId, executed) => {
    if (executed === name) ran(sessionId)
  })
}
