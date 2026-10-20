import { assert } from 'vitest'
import type { Page, PageOutcome } from '../../src/remote/page.ts'

export function expectPage(outcome: PageOutcome): Page {
  assert(outcome.kind === 'page', 'expected a page outcome')
  return outcome.page
}
