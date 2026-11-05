// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AllowlistEditor } from '../../fetch-enhanced/src/client/settings/AllowlistEditor.tsx'
import { en, zh } from '../../fetch-enhanced/src/client/locales.ts'
import type { Translate } from '../../fetch-enhanced/src/client/connections.ts'

afterEach(cleanup)

it.each([
  [en, 'Both lists empty follows upstream any-address fetching. A non-empty list enables public-only preflight plus the permitted ranges below; hostnames alone grant no private access. Clear both lists to disable filtering. The initial-address check does not pin DNS or recheck redirects; proxied hostnames are governed by the proxy. Upstream URL, redirect, timeout and size limits still apply.'],
  [zh, '两列表均为空时跟随上游，允许任意地址。任一非空即启用初始地址预检：公网照常放行，非公网须匹配允许网段；仅填域名不授予内网访问。清空两者关闭过滤。预检不固定 DNS 地址、不复验重定向；代理域名由代理负责。上游仍执行 URL、重定向、超时和大小限制。'],
] as const)('always discloses direct/proxy access limits in the editor', (locale, disclosure) => {
  const t: Translate = key => locale[key]
  expect(locale['allowlist.description']).toBe(disclosure)
  const write = async () => true
  const { rerender } = render(<AllowlistEditor allowCidrs={[]} allowHostnames={[]} revision={1} disabled={false} write={write} t={t} />)
  expect(screen.getByText(disclosure).hidden).toBe(false)
  rerender(<AllowlistEditor allowCidrs={['10.0.0.0/8']} allowHostnames={['internal.example']} revision={2} disabled write={write} t={t} />)
  expect(screen.getByText(disclosure).hidden).toBe(false)
})
