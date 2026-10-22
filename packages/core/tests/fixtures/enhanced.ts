import type { CapabilityEnhanced, CapabilitySettings } from '../../src/host/index.ts'
import type { EnhancedToolNames } from '../../src/shared/index.ts'

/** For capabilities whose settings keep `enhancedTools` off: core must never build or list their tools. */
export function inertEnhanced<S extends CapabilitySettings, O, Q, R>(names: EnhancedToolNames): CapabilityEnhanced<S, O, Q, R> {
  const unexpected = () => { throw new Error('enhanced tools are off in this test') }
  return { names, tools: unexpected, listing: unexpected }
}
