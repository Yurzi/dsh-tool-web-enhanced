// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AllowlistEditor } from '../../fetch-enhanced/src/client/settings/AllowlistEditor.tsx'
import { en, zh } from '../../fetch-enhanced/src/client/locales.ts'
import type { Translate } from '../../fetch-enhanced/src/client/connections.ts'

afterEach(cleanup)

it.each([
  [en, 'With an empty list, direct connections reach public addresses only. With a proxy, hostnames are resolved by the proxy, and neither that limit nor these rules apply to them.'],
  [zh, '列表为空时，直连只能访问公网地址。设置了代理时，域名由代理解析，公网限制和这里的规则都管不到它们。'],
] as const)('always discloses direct/proxy access limits in the editor', (locale, disclosure) => {
  const t: Translate = key => locale[key]
  expect(locale['allowlist.description']).toBe(disclosure)
  const write = async () => true
  const { rerender } = render(<AllowlistEditor allowCidrs={[]} allowHostnames={[]} revision={1} disabled={false} write={write} t={t} />)
  expect(screen.getByText(disclosure).hidden).toBe(false)
  rerender(<AllowlistEditor allowCidrs={['10.0.0.0/8']} allowHostnames={['internal.example']} revision={2} disabled write={write} t={t} />)
  expect(screen.getByText(disclosure).hidden).toBe(false)
})
