import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { isSelectable, routeFacts, type CapabilityRuntime } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import type { AllowlistRules } from './local/address-policy.ts'
import { describeProblem, parseCidr, parseHostnameRule } from './local/rules.ts'
import type { FetchOptions } from './host/options.ts'
import type { ResolvedSettings } from './settings/types.ts'

const NOTICE_BUDGET = 2000
const SAFETY_NOTICE = ' All other URL, DNS, redirect, and transport safety checks still apply.'

/** Explain only the operator-authorized exceptions, retaining every other safety check. */
export function allowlistNotice({ allowCidrs, allowHostnames }: AllowlistRules): string {
  if (allowCidrs.length === 0) return ''
  const cidrs = [...new Set(allowCidrs.map(rule => {
    const parsed = parseCidr(rule)
    if (!parsed.ok) throw new Error(`web-fetch-enhanced: allowCidrs entry ${describeProblem(parsed.problem)}`)
    return `${parsed.value.network.toString()}/${parsed.value.prefixLength}`
  }))]
  const hostnames = [...new Set(allowHostnames.map(rule => {
    const parsed = parseHostnameRule(rule)
    if (!parsed.ok) throw new Error(`web-fetch-enhanced: allowHostnames entry ${describeProblem(parsed.problem)}`)
    return parsed.value.kind === 'exact' ? parsed.value.hostname : `*${parsed.value.suffix}`
  }))]
  const scope = hostnames.length === 0
    ? ''
    : ` Only URLs whose hostname matches [${hostnames.join(', ')}] may use these exceptions.`
  const full = `The operator has authorized web_fetch to reach non-public addresses within [${cidrs.join(', ')}].${scope}${SAFETY_NOTICE}`
  if (full.length <= NOTICE_BUDGET) return full

  const hostnameScope = hostnames.length === 0
    ? ''
    : ' Only URLs whose hostname matches a configured hostname rule may use these exceptions.'
  const summary = `The operator has authorized web_fetch exceptions described by ${cidrs.length} CIDR ranges and ${hostnames.length} hostname rules; see the fetch settings page for the complete allowlist.`
    + ` Non-public addresses must match a configured CIDR.${hostnameScope}${SAFETY_NOTICE}`
  const exampleBudget = NOTICE_BUDGET - summary.length
  const cidrExamples = ruleExamples('CIDR', cidrs, hostnames.length === 0 ? exampleBudget : Math.floor(exampleBudget / 2))
  return summary + cidrExamples + ruleExamples('Hostname', hostnames, exampleBudget - cidrExamples.length)
}

function ruleExamples(label: string, rules: readonly string[], budget: number): string {
  const prefix = ` ${label} examples (partial list): [`
  let list = ''
  for (const rule of rules) {
    const next = list === '' ? rule : `${list}, ${rule}`
    if (prefix.length + next.length + 2 > budget) break
    list = next
  }
  return list === '' ? '' : `${prefix}${list}].`
}

/** Runtime context is refreshed after agent/request captures this step's connection. */
export function registerAllowlistNotice(ctx: Context, runtime: CapabilityRuntime<FetchOptions>, settings: () => ResolvedSettings): void {
  ctx.inject(['systemPrompt'], prompt => {
    prompt.systemPrompt.context({
      name: 'web-fetch-enhanced:allowlist',
      order: prompt.systemPrompt.getContextOrder('SANDBOX_POLICY') + 1,
      interpolate: false,
      text: assembly => {
        if (routeFacts(ctx, 'fetchProvider', FETCH.providerId).kind !== 'this') return ''
        const agent = assembly.agent ?? ctx.get('agents')?.currentInitiator()
        const plan = runtime.plan(agent)
        if (plan === undefined || plan.kind !== 'ready') return ''
        const connection = settings().connections.get(plan.connectionId)
        if (!isSelectable(connection) || connection.kind !== 'local') return ''
        return allowlistNotice(connection.options)
      },
    })
  })
}
