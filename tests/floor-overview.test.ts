// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FloorOverview, FloorCreateSheet, initialOverview, overviewTransition, floorTransform, ghostTransform } from '../src/renderer/src/floors/FloorOverview'
import type { Workspace } from '../src/shared/model'

// happy-dom não trata cancelamento WAAPI como o Chromium; exercita o fallback JS real do Motion.
const nativeAnimate = Element.prototype.animate
beforeAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true, writable: true }) })
afterAll(() => { Object.defineProperty(Element.prototype, 'animate', { value: nativeAnimate, configurable: true, writable: true }) })

const workspace = (): Workspace => ({ id: 'w', name: 'W', nodes: {}, connections: [], camera: { offset: { x: 0, y: 0 }, zoom: 1 }, floors: {
  f: { id: 'f', name: 'UI', repoRoot: '/repo', dir: '/repo.floors/ui', branch: 'palco/ui', baseRef: 'main', camera: { offset: { x: 0, y: 0 }, zoom: 1 }, createdAt: 1 }
}, activeFloor: null })
it('abrir, pré-visualizar, escolher e fechar não revertem o andar escolhido', () => {
  let state = initialOverview(null)
  expect(state.open).toBe(false)
  state = overviewTransition(state, { kind: 'open', floor: null })
  state = overviewTransition(state, { kind: 'preview', floor: 'f' })
  expect(state).toEqual({ open: true, floor: 'f' })
  expect(overviewTransition(state, { kind: 'close' })).toEqual({ open: false, floor: 'f' })
  expect(overviewTransition(state, { kind: 'choose', floor: null })).toEqual({ open: false, floor: null })
})
it('perspectiva acompanha altura e ghosts empilham acima/abaixo', () => {
  expect(floorTransform(600, true)).toEqual({ perspective: 1200, rotateX: 55, scale: .55, y: 130 })
  expect(floorTransform(0, false)).toEqual({ perspective: 1600, rotateX: 0, scale: 1, y: 0 })
  expect(ghostTransform(-1)).toMatchObject({ y: 290, opacity: .7 })
  expect(ghostTransform(1)).toMatchObject({ y: -30, opacity: .35 })
  expect(ghostTransform(0).opacity).toBe(0)
})
it('indicador abre lista; clique pré-visualiza, Esc fecha sem rollback; duplo clique escolhe', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), onSwitch = vi.fn(async () => true), create = vi.fn()
  try {
    await act(async () => root.render(createElement(FloorOverview, { ws: workspace(), onSwitch, onCreate: create, onLand: vi.fn(), onDelete: vi.fn(), children: createElement('div', null, 'Canvas vivo') })))
    const indicator = host.querySelector<HTMLButtonElement>('[aria-label="Andares"]')!
    await act(async () => indicator.click())
    expect(host.querySelector('[data-overview="true"]')).not.toBeNull()
    expect(host.querySelector('[role="listbox"]')).not.toBeNull()
    const floor = host.querySelector<HTMLButtonElement>('[data-floor-id="f"]')!
    await act(async () => floor.click())
    expect(onSwitch).toHaveBeenLastCalledWith('f')
    expect(host.querySelector('[data-overview="true"]')).not.toBeNull()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('[data-overview="true"]')).toBeNull()
    expect(onSwitch).toHaveBeenCalledTimes(1)
    await act(async () => indicator.click())
    await act(async () => host.querySelector('[data-floor-id="f"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(host.querySelector('[data-overview="true"]')).toBeNull()
    await act(async () => indicator.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Novo andar"]')!.click())
    expect(create).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="Excluir Ground"]')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
it('folha mantém campos git existentes e Esc cancela', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), cancel = vi.fn(), submit = vi.fn((e: { preventDefault(): void }) => e.preventDefault())
  try {
    await act(async () => root.render(createElement(FloorCreateSheet, { defaultDir: '/repo', onCancel: cancel, onSubmit: submit })))
    expect(host.querySelector('input[name="dir"]')?.getAttribute('value')).toBe('/repo')
    expect(host.querySelector('input[name="branch"]')).not.toBeNull()
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(submit).toHaveBeenCalledOnce()
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(cancel).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
it('duplo clique durante troca pendente reutiliza a operação e fecha só depois; roda na lista não troca andar', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  let finish!: (ok: boolean) => void
  const onSwitch = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  try {
    await act(async () => root.render(createElement(FloorOverview, { ws: workspace(), onSwitch, onCreate: vi.fn(), onLand: vi.fn(), onDelete: vi.fn(), children: createElement('div') })))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Andares"]')!.click())
    await act(async () => host.querySelector('[role="listbox"]')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true, cancelable: true })))
    expect(onSwitch).not.toHaveBeenCalled()
    const target = host.querySelector<HTMLButtonElement>('[data-floor-id="f"]')!
    await act(async () => { target.click(); target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-overview="true"]')).not.toBeNull()
    await act(async () => finish(true))
    expect(host.querySelector('[data-overview="true"]')).toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
it('troca recusada mantém overview e seleção anterior, sem executar exclusão', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), remove = vi.fn()
  try {
    await act(async () => root.render(createElement(FloorOverview, { ws: workspace(), onSwitch: async () => false, onCreate: vi.fn(), onLand: vi.fn(), onDelete: remove, children: createElement('div') })))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Andares"]')!.click())
    await act(async () => host.querySelector('[data-floor-id="f"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(host.querySelector('[data-overview="true"]')).not.toBeNull()
    expect(host.querySelector('[data-floor-id="ground"]')?.getAttribute('aria-selected')).toBe('true')
    expect(remove).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
it('wheel cancela evento nativo fora dos controles e canvas continua inerte durante a saída', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), switchFloor = vi.fn(async () => true)
  try {
    await act(async () => root.render(createElement(FloorOverview, { ws: workspace(), onSwitch: switchFloor, onCreate: vi.fn(), onLand: vi.fn(), onDelete: vi.fn(), children: createElement('div') })))
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Andares"]')!.click())
    const wheel = new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true })
    await act(async () => host.querySelector('.floor-overview-dismiss')!.dispatchEvent(wheel))
    expect(wheel.defaultPrevented).toBe(true)
    expect(switchFloor).toHaveBeenCalledWith('f')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('.floor-stage-live')!.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('[role="listbox"]')).not.toBeNull()
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
