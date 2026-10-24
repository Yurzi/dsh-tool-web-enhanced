import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { FRESHNESS, isConnectionId, type ConnectionView, type Route, type SelectionSource } from '../shared/index.ts'
import type { Capability, CapabilitySettings, ConnectionOf, LabeledConnection } from './capability.ts'
import { LABEL_MAX, oneLine, recipientText, THIS_MACHINE, UNSUPPORTED_REASON_TEXT } from './enhanced-parts/listing.ts'
import { routeFacts } from './route.ts'
import { isSelectable } from './selectable.ts'
import { writeSelection } from './selection-write.ts'
import { liveSession, type Sessions, type SessionChange } from './sessions.ts'
import { InvalidSettingsError } from './settings-row.ts'

class SelectionOperationError extends Error {}

const SOURCES: Readonly<Record<SelectionSource, string>> = {
  session: 'chosen in this session', inherited: 'copied from the parent session',
  model: 'remembered for this model', default: 'the default connection',
}

export function registerCommand<S extends CapabilitySettings<LabeledConnection>, O extends Record<string, unknown>, V extends ConnectionView, T, Q, R>(ctx: Context, capability: Capability<S, O, V, T, Q, R>, sessions: Sessions<O, S, V>): void {
  const { command, providerId, rowId } = capability.identity
  const noun = capability.tool === 'web_search' ? 'web search' : 'web fetch'
  const capital = capability.tool === 'web_search' ? 'Web search' : 'Web fetch'
  const options = capability.commandOptions
  const hint = options === undefined ? '[off | <connection id>]' : '[off | <connection id> | freshness auto|fresh|realtime]'
  const failure = 'The ' + noun + ' selection could not be read or saved; retry, or check the Host logs.'
  const error = (text: string): CommandResult => ({ kind: 'error', text })
  const selectionOperation = async <U>(work: () => Promise<U>): Promise<U> => {
    try {
      return await work()
    } catch (cause) {
      if (cause instanceof InvalidSettingsError) throw cause
      ctx.logger.warn('%s command selection read or write failed: %s', rowId, cause)
      throw new SelectionOperationError('selection read or write failed')
    }
  }
  const route = () => routeFacts(ctx, capability.field, providerId)
  const routing = () => routingText(route(), capability.tool, providerId)
  const unavailable = (id: string) => error(id + ' is missing or turned off in the settings. Run /' + command + ' to list the connections.')
  const success = (text: string): CommandResult => ({ kind: 'success', text: text + (route().kind === 'this' ? '' : '\n' + routing()) })

  const run = async (invocation: CommandInvocation): Promise<CommandResult> => {
    const raw = invocation.rawInput.trim()
    const args = raw === '' ? [] : raw.split(/\s+/u)
    const usage = () => error('Unknown argument "' + oneLine(raw, 64) + '". Usage: /' + command + ' ' + hint)
    const keyword = args.length === 0 ? '' : args[0]!.toLowerCase()
    const freshnessValue = args.length === 2 ? args[1]!.toLowerCase() : ''
    const freshness = options !== undefined && args.length === 2 && keyword === 'freshness'
    if (args.length > 0 && !freshness && !(args.length === 1 && (keyword === 'off' || isConnectionId(args[0]!)))) return usage()
    if (freshness && !FRESHNESS.some(value => value === freshnessValue)) return error('Unknown freshness "' + oneLine(args[1]!, 64) + '". Use auto, fresh or realtime.')
    const target = liveSession(invocation.agent)
    // Validate settings before touching storage, including a previously persisted selection.
    const settings = capability.settings()
    const current = await selectionOperation(() => sessions.current(target))
    if (args.length === 0) {
      const views = await sessions.connections(target)
      const id = current.selection.connectionId
      const selected = id === null ? undefined : views.find(view => view.id === id)
      let summary = id === null ? 'Off' : selected === undefined || !sessions.selectable(id) ? id : oneLine(selected.label, LABEL_MAX) + ' (' + id + ')'
      summary += ' · ' + SOURCES[current.source]
      if (id !== null && !sessions.selectable(id)) summary += ' · missing or turned off in the settings; ' + capability.tool + ' fails until another connection is chosen'
      if (options !== undefined) summary += ' · freshness: ' + options.freshness(current.selection.options)
      const entries: string[] = []
      for (const view of views) {
        const connection = settings.connections.get(view.id)
        if (!isSelectable(connection)) continue
        const name = oneLine(view.label, LABEL_MAX)
        const parts = [statusText(view)]
        if (view.id === id) parts.push('current')
        if (view.freshness === true) parts.push('applies freshness')
        const recipient = recipientText(capability.enhanced.listing(connection as ConnectionOf<S>, { agent: invocation.agent, signal: invocation.signal }).recipient)
        if (recipient === THIS_MACHINE) parts.push('fetches from this machine')
        else if (recipient !== name) parts.push((capability.tool === 'web_search' ? 'queries' : 'URLs') + ' go to ' + recipient)
        entries.push('- ' + view.id + ' — ' + name + ' · ' + parts.join(' · '))
      }
      if (entries.length === 0) entries.push('- (none; turn connections on in the row settings)')
      const tail = 'Turn off: /' + command + ' off' + (options === undefined ? '' : ' · Freshness: /' + command + ' freshness auto|fresh|realtime (connections marked "applies freshness")')
      return { kind: 'success', text: [summary, routing(), 'Connections (/' + command + ' <id> chooses one):', ...entries, tail].join('\n') }
    }
    let change: SessionChange<O>
    let message: string
    if (freshness && options !== undefined) {
      const selected = (await sessions.connections(target)).find(view => view.id === current.selection.connectionId)
      if (selected === undefined || selected.freshness !== true || !sessions.selectable(selected.id)) return error('The current connection does not apply freshness. Choose one marked "applies freshness" first.')
      const value = FRESHNESS.find(mode => mode === freshnessValue)!
      change = options.changeFreshness(value)
      message = 'Freshness is ' + value + ' from the next model request.'
    } else if (keyword === 'off') {
      change = { connectionId: null }
      message = capital + ' is off for this session from the next model request.'
    } else {
      const id = args[0]!
      if (!sessions.selectable(id)) return unavailable(id)
      const selected = (await sessions.connections(target)).find(view => view.id === id)!
      change = { connectionId: id }
      message = 'Now using ' + oneLine(selected.label, LABEL_MAX) + ' (' + id + ') for ' + noun + ' from the next model request.'
    }
    const result = await selectionOperation(() => writeSelection(sessions, target, change, current.selection.revision))
    if (result.kind === 'unavailable') return unavailable(result.connectionId)
    if (result.kind === 'conflict') return error('The selection changed while this command ran. Run /' + command + ' to see it, then try again.')
    return success(message)
  }
  ctx.effect(() => ctx.commands.register({
    name: command, description: "Show or change this session's " + noun + ' connection', input: { hint },
    async handler(invocation) {
      try {
        return await run(invocation)
      } catch (cause) {
        if (cause instanceof SelectionOperationError) return error(failure)
        // Like the Remote boundary: diagnostics stay in Host logs, never in command text.
        ctx.logger.warn('%s command failed: %s', rowId, cause)
        if (cause instanceof InvalidSettingsError) return error('The ' + noun + ' settings are invalid; fix them in the Enhanced ' + noun + ' row settings.')
        // eslint-disable-next-line preserve-caught-error -- DSH renders thrown errors; the original cause must not cross this user boundary.
        throw new Error('The ' + noun + ' command failed; retry, or check the Host logs.')
      }
    },
  }))
}

function routingText(route: Route, tool: string, providerId: string): string {
  switch (route.kind) {
    case 'this': return 'Routing: ' + tool + ' goes to this plugin.'
    case 'other': return 'Routing: ' + tool + ' goes to ' + oneLine(route.provider, LABEL_MAX) + ', so this selection has no effect until the web row routes it to ' + providerId + '.'
    case 'auto': return 'Routing: the web row pins no ' + tool + ' provider, so this selection has no effect until it routes ' + tool + ' to ' + providerId + '.'
    case 'unknown': return 'Routing: the web row could not be read, so this selection may have no effect.'
  }
}

function statusText(view: ConnectionView): string {
  switch (view.status) {
    case 'ready': return 'ready'
    case 'needs-credential': return view.access === 'account' ? 'needs DeepSeek sign-in' : 'needs an API key'
    case 'unsupported': return 'unavailable: ' + UNSUPPORTED_REASON_TEXT[view.reason!]
    case 'disabled': return 'missing or turned off in the settings'
  }
}
