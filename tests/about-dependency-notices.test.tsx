// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AboutTab } from '../src/renderer/src/settings/tabs/about'
import { collectNotices } from '../scripts/third-party-notices.mjs'
import notices from '../src/shared/third-party-notices.json'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
const listed = new Set(notices.packages.map((p) => p.name))
const textOf = (name: string): string => notices.packages.filter((p) => p.name === name).flatMap((p) => p.texts.map((i) => notices.texts[i]!)).join('\n')
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(tsx?|css)$/.test(e.name) ? [join(d, e.name)] : []))

it('o inventário gravado é o das dependências instaladas (se falhar: npm run notices)', () => {
  expect(notices).toEqual(collectNotices(process.cwd()))
})
it('toda dependência do app e o Electron têm aviso com texto de licença; nenhum pacote fica sem', () => {
  for (const name of [...Object.keys(pkg.dependencies), 'electron']) expect(listed.has(name), name).toBe(true)
  for (const p of notices.packages) { expect(p.license, p.name).toBeTruthy(); expect(p.texts.length, p.name).toBeGreaterThan(0) }
  expect(textOf('react')).toContain('Meta Platforms'); expect(textOf('@xterm/headless')).toContain('xterm.js authors')
  expect(textOf('@fontsource-variable/geist')).toContain('SIL Open Font License'); expect(textOf('node-pty')).toContain('Ryan Prichard')
  expect(textOf('rehype-katex')).toContain('Permission is hereby granted')
  expect(notices.packages.find((p) => p.name === 'rehype-katex')!.note).toBeTruthy()
})
it('tudo o que o código do app importa de fora está no inventário', () => {
  const builtin = new Set(builtinModules)
  const imported = walk('src').flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*|@import\s+)['"]([@a-z][\w@./-]*)['"]/g)].map((m) => m[1]!))
    .filter((s) => !s.startsWith('node:') && !s.startsWith('data:')).map((s) => s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/')).filter((s) => !builtin.has(s))
  expect(imported.length).toBeGreaterThan(20)
  expect([...new Set(imported)].filter((s) => !listed.has(s))).toEqual([])
})

let host: HTMLDivElement, root: Root
const openRuntimeLicenses = vi.fn(async () => {})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); openRuntimeLicenses.mockClear()
  Object.assign(window, { palco: { about: { info: async () => ({ version: '0.1.0', contact: null, onboardingCompleted: true }), openRuntimeLicenses } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const open = async () => { await act(async () => root.render(<AboutTab />)); await flush() }
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!

it('Sobre em blocos: nome e versão, relato, agradecimentos (fechado) e onboarding, com divisórias', async () => {
  await open()
  expect(host.querySelector('.about-name')!.textContent).toBe('palco'); expect(host.querySelector('.about-identity')!.textContent).toContain('Versão 0.1.0')
  expect([...host.querySelectorAll('.settings-section-title')].map((e) => e.textContent)).toEqual(['Relatar um problema', 'Agradecimentos', 'Introdução'])
  expect(host.querySelectorAll('.settings-divider')).toHaveLength(3)
  expect(button('Agradecimentos').getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('.third-party-list')).toBeNull()
  expect(host.querySelectorAll('.about-name')).toHaveLength(1)
})
it('Agradecimentos lista cada pacote com versão e licença; abrir um mostra o texto; o botão abre as licenças do Chromium', async () => {
  await open(); await act(async () => button('Agradecimentos').click()); await flush()
  const rows = [...host.querySelectorAll('.third-party-list > li')]
  expect(rows).toHaveLength(notices.packages.length)
  const react = rows.find((r) => r.querySelector('.third-party-name')!.textContent === 'react')!
  expect(react.textContent).toContain('MIT'); expect(react.querySelector('pre')).toBeNull()
  await act(async () => react.querySelector('button')!.click())
  expect(react.querySelector('pre')!.textContent).toContain('Meta Platforms'); expect(react.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
  await act(async () => button('Licenças do Chromium e do Node.js').click()); expect(openRuntimeLicenses).toHaveBeenCalledOnce()
})
it('falha ao abrir as licenças do runtime aparece na tela', async () => {
  openRuntimeLicenses.mockRejectedValueOnce(new Error('arquivo não encontrado'))
  await open(); await act(async () => button('Agradecimentos').click()); await flush()
  await act(async () => button('Licenças do Chromium e do Node.js').click()); await flush()
  expect(host.querySelector('[role=alert]')!.textContent).toContain('arquivo não encontrado')
})
