import { describe, expect, it } from 'vitest'
import { isLiftable, liftFrame, liftRect, LIFT_MIN, LIFT_TOP_INSET } from '../../src/renderer/src/canvas/lift'
import { resolveCommand } from '../../src/renderer/src/canvas/commands/keymap'
import { defaultShortcuts, rebindShortcut, SHORTCUTS } from '../../src/shared/shortcuts'

const view = { w: 1400, h: 900 }
describe('elevar elemento: o painel central', () => {
  it('só terminal, nota, portal e árvore de arquivos se elevam (banda e arquivo avulso não)', () => {
    for (const kind of ['terminal', 'note', 'portal', 'filetree']) expect(isLiftable({ kind } as never)).toBe(true)
    for (const kind of ['band', 'file', 'text', 'link']) expect(isLiftable({ kind } as never)).toBe(false)
  })
  it('nota: até 720 de largura e quase toda a altura, centrada abaixo da barra', () => {
    const r = liftRect({ kind: 'note' } as never, view)
    expect(r.w).toBe(720); expect(r.h).toBe(900 - LIFT_TOP_INSET - 72); expect(r.x).toBe((1400 - 720) / 2); expect(r.y).toBe(LIFT_TOP_INSET + (900 - LIFT_TOP_INSET - r.h) / 2)
  })
  it('terminal e portal: largo (até 1400, deixando 80 de folga); árvore: até 560', () => {
    expect(liftRect({ kind: 'terminal' } as never, view).w).toBe(1320); expect(liftRect({ kind: 'portal' } as never, { w: 2400, h: 900 }).w).toBe(1400)
    expect(liftRect({ kind: 'filetree' } as never, view).w).toBe(560)
  })
  it('nunca menor que 240 nem maior que a área livre, mesmo em janela minúscula', () => {
    const r = liftRect({ kind: 'terminal' } as never, { w: 200, h: 200 })
    expect(r.w).toBeGreaterThanOrEqual(LIFT_MIN); expect(r.h).toBeGreaterThanOrEqual(LIFT_MIN)
  })
  it('liftFrame: o painel de tela vira posição de mundo e escala 1/zoom (tamanho real na tela)', () => {
    const f = liftFrame({ x: 100, y: 200, w: 800, h: 500 }, { offset: { x: 50, y: 20 }, zoom: 2 })
    expect(f).toEqual({ pos: { x: 25, y: 90 }, size: { w: 800, h: 500 }, scale: 0.5 })
  })
})
describe('elevar elemento: atalho', () => {
  it('sem atribuição por padrão mas o gravador aceita uma combinação e o comando sai', () => {
    const def = SHORTCUTS.find(s => s.id === 'lift')!; expect(def.reason).toBeUndefined(); expect(def.defaults).toEqual([])
    const map = rebindShortcut(defaultShortcuts(), 'lift', { key: 'e', mod: true } as never).shortcuts
    expect(resolveCommand({ key: 'e', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as never, { shortcuts: map, jump: { armed: () => false, digit: () => null } as never, now: 0 })).toEqual({ kind: 'lift' })
    expect(resolveCommand({ key: 'e', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as never, { shortcuts: defaultShortcuts(), jump: { armed: () => false, digit: () => null } as never, now: 0 })).toBeNull()
  })
})
