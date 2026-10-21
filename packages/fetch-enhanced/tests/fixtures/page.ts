import { assert } from 'vitest'
import type { Page, PageOutcome } from 'dsh-tool-web-enhanced-core/host'

export function expectPage(outcome: PageOutcome): Page {
  assert(outcome.kind === 'page', 'expected a page outcome')
  return outcome.page
}
