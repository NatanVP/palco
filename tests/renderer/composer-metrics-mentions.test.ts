import { describe, expect, it } from 'vitest'
import { composerMetrics } from '../../src/renderer/src/composer/metrics'
import { applyMention, expandPastes, isLargePaste, mentionAt, mentionItems, mentionName, pasteLabel } from '../../src/renderer/src/composer/mentions'
import { nextMode } from '../../src/renderer/src/composer/composer-mode'
import type { CanvasNode } from '../../src/shared/model'

const node = (id: string, kind: string, name: string): CanvasNode => ({ id, kind, name, floorId: null, pos: { x: 0, y: 0 }, size: { w: 1, h: 1 } }) as CanvasNode
describe('medidas do compositor', () => {
  it('fonte 13: linha 20, mínima 36, máxima 220; escala com o tamanho', () => {
    expect(composerMetrics(null)).toEqual({ fontSize: 13, lineHeight: 20, minHeight: 36, maxHeight: 220 })
    expect(composerMetrics(26)).toMatchObject({ lineHeight: 40, minHeight: 56, maxHeight: 440 })
  })
})
describe('o estado do compositor gira off → sobreposto → abaixo → off', () => { it('gira', () => { expect(['off', 'overlay', 'below'].map(m => nextMode(m as never))).toEqual(['overlay', 'below', 'off']) }) })
describe('menções com @', () => {
  it('acha o @ no começo ou depois de espaço, até o cursor, sem espaço no meio', () => {
    expect(mentionAt('oi @Fa', 6)).toEqual({ start: 3, query: 'Fa' }); expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('mail a@b', 8)).toBeNull(); expect(mentionAt('@Faísca ola', 11)).toBeNull(); expect(mentionAt('sem', 3)).toBeNull()
  })
  it('aplica a escolha no lugar da consulta e põe o cursor depois', () => {
    expect(applyMention('veja @Fa agora', 8, 5, '@Faísca')).toEqual({ text: 'veja @Faísca  agora', caret: 13 })
    expect(applyMention('@', 1, 0, '@Alfa')).toEqual({ text: '@Alfa ', caret: 6 })
  })
  it('nome com espaço vira @"Nome"', () => { expect(mentionName('Faísca')).toBe('@Faísca'); expect(mentionName('Nota do Dia')).toBe('@"Nota do Dia"') })
  const src = { nodes: [node('s', 'terminal', 'Eu'), node('t', 'terminal', 'Faísca'), node('n', 'note', 'Plano'), node('p', 'portal', 'Docs'), node('f', 'filetree', 'src')], selfId: 's', floors: [{ id: 'f1', name: 'ui' }], workspaces: [{ id: 'w1', name: 'Palco' }], actions: [{ id: 'newNote', label: 'Nova Nota' }] }
  it('agrupa por seção, na ordem, sem o próprio terminal nem nós que não são mencionáveis', () => {
    const items = mentionItems(src, '')
    expect(items.map(i => `${i.section}:${i.label}`)).toEqual(['terminals:Faísca', 'notes:Plano', 'portals:Docs', 'floors:ui', 'workspaces:Palco', 'actions:Nova Nota', 'files:Arquivo…', 'prompts:Prompts…'])
    expect(items.find(i => i.section === 'floors')?.insert).toBe('@"Andar: ui"')
  })
  it('filtra sem acento nem caixa', () => { expect(mentionItems(src, 'faisca').map(i => i.label)).toEqual(['Faísca']); expect(mentionItems(src, 'zzz')).toEqual([]) })
  it('@Prompts aparece desabilitado com o motivo enquanto não há gerenciador de prompts', () => {
    const p = mentionItems(src, 'prompt')[0]!; expect(p).toMatchObject({ section: 'prompts' }); expect(p.disabled).toMatch(/gerenciador de prompts/); expect(p.insert).toBeUndefined()
    expect(mentionItems(src, 'prompt', true)[0]!.disabled).toBeUndefined()
  })
})
describe('texto colado', () => {
  it('é grande a partir de 5 linhas ou 500 caracteres; a pílula conta as linhas e expande ao enviar', () => {
    expect(isLargePaste('a\nb\nc\nd')).toBe(false); expect(isLargePaste('a\nb\nc\nd\ne')).toBe(true); expect(isLargePaste('x'.repeat(500))).toBe(true)
    const t = 'l1\nl2\nl3\nl4\nl5\nl6', label = pasteLabel(1, t); expect(label).toBe('[Texto colado #1 · 6 linhas]')
    expect(expandPastes(`veja ${label} fim`, new Map([[label, t]]))).toBe(`veja ${t} fim`)
  })
})
