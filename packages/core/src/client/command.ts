import type { CommandContribution, SelectOption, SelectOptionGroup } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { SelectionView } from '../shared/selection.ts'
import type { ConnectionText, SelectionState, SelectionStore, SelectionUpdate } from './section.ts'

export type ClientTranslate<K extends string = string> = (key: K, params?: Record<string, string | number>) => string
export type CommandCopyKey = 'label' | 'description' | 'placeholder' | 'empty' | 'noResults' | 'readFailed' | 'current' | 'off'
export type CommandDetail = (hint: string | undefined, current: boolean) => { detail?: string }

export interface CommandOptions<V extends SelectionView> {
  choices(view: V, detail: CommandDetail): readonly SelectOption[]
  parse(id: string): SelectionUpdate | undefined
  isCurrent(update: SelectionUpdate, selection: V['selection']): boolean
}

export interface SelectionCommandSpec<V extends SelectionView, K extends string> {
  readonly name: string
  readonly icon: NonNullable<CommandContribution['icon']>
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

/** A keyboard entry to the same per-session store the composer menu uses. */
export function selectionCommand<V extends SelectionView, K extends string>(
  selections: SelectionStore<V> & { current(sessionId: string): Promise<SelectionState<V>> },
  spec: SelectionCommandSpec<V, K>,
): CommandContribution {
  const t = (key: CommandCopyKey) => spec.t(spec.keys[key])
  const read = async (sessionId: string) => {
    const { view, readFailed } = await selections.current(sessionId)
    if (view === undefined || readFailed) throw new Error(t('readFailed'))
    return view
  }
  return {
    name: spec.name,
    label: () => t('label'),
    description: () => t('description'),
    icon: spec.icon,
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
