import { expect, it } from 'vitest'
import { bodyDetail, type UpstreamDetail } from '../src/host/index.ts'

it('requires screened text rather than a structural lookalike', () => {
  // @ts-expect-error Only transport can construct screened upstream text.
  const unscreened: UpstreamDetail = { kind: 'text', text: 'x' }
  expect(unscreened).toEqual(bodyDetail('x'))
  const safe = bodyDetail('screened')
  if (safe === undefined || safe.kind !== 'text') throw new Error('expected screened text')
  // @ts-expect-error Spreading a screened object cannot authorize replacement text.
  const replaced: UpstreamDetail = { ...safe, text: 'x' }
  // @ts-expect-error Concatenation creates new text that has not been screened.
  const derived: UpstreamDetail = { kind: 'text', text: safe.text + 'x' }
  expect(replaced).toEqual({ kind: 'text', text: 'x' })
  expect(derived).toEqual({ kind: 'text', text: 'screenedx' })
})
