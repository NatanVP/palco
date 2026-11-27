// @vitest-environment happy-dom
// o painel de Partituras, na posição padrão, fica abaixo do botão que o abre, mesmo com a faixa de aviso.
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mountApp, type Harness } from './helpers/app-harness'

let app: Harness
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear() })
afterEach(async () => { await app.unmount(); vi.unstubAllGlobals() })
const open = async () => { await act(async () => app.host.querySelector<HTMLButtonElement>('.round-btn[aria-label="Partituras"]')!.click()); await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const px = (selector: string, property: string): number => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/src', selector === '.top-right' ? 'styles.css' : 'partituras/partituras.css'), 'utf8')
  const rule = css.split('\n').find((line) => line.startsWith(`${selector} {`))!
  return Number(new RegExp(`[;{] ${property}: (\\d+)px`).exec(rule)![1])
}

it.each([['sem aviso', undefined], ['com a faixa de aviso', 'Não foi possível iniciar o terminal.']])('%s: o painel e o botão medem a partir da mesma área, e o painel começa abaixo da barra', async (_name, warning) => {
  app = await mountApp({ ...(warning ? { warning } : {}) })
  if (warning) expect(app.host.querySelector('.warning')!.textContent).toContain('iniciar o terminal')
  await open()
  const panel = app.host.querySelector('.partitura-panel')!, button = app.host.querySelector('.round-btn[aria-label="Partituras"]')!
  const area = button.closest('.canvas-area')
  expect(area).toBeTruthy()
  expect(panel.closest('.canvas-area')).toBe(area)
  // Barra: topo 12px + respiro 4px + botão 32px + respiro 4px.
  expect(px('.partitura-panel', 'top')).toBeGreaterThanOrEqual(px('.top-right', 'top') + 40)
})
it('fechar e reabrir continua funcionando dentro da área do canvas', async () => {
  app = await mountApp(); await open()
  await act(async () => app.host.querySelector<HTMLButtonElement>('.partitura-panel-head button')!.click())
  expect(app.host.querySelector('.partitura-panel')).toBeNull()
  await open(); expect(app.host.querySelector('.canvas-area .partitura-panel')).toBeTruthy()
})
