// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DataTab, shortPath } from '../src/renderer/src/settings/tabs/data'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { defaultPreferences } from '../src/shared/preferences'
import { DataRoot } from '../src/main/data/data-root'
import { DataService } from '../src/main/data/data-service'
import { writeEnvelopeAtomic } from '../src/main/domain/envelope'

let host: HTMLDivElement, root: Root
const dirs: string[] = []
const state = { root: '/tmp/fixture/.palco', backupIntervalMinutes: 60, snapshots: [] as unknown[], lastSaveAt: null as string | null, lastBackupAt: null as string | null }
const api = {
  state: vi.fn(async () => state),
  usage: vi.fn(async () => ({ total: 105_000, workspaces: [{ id: 'a', name: 'Códigos', size: 12_100 }, { id: 'b', name: 'Outro', size: 2_000 }] })),
  pickRoot: vi.fn(async () => null), showFolder: vi.fn(async () => {}), backupNow: vi.fn(async () => {}), exportZip: vi.fn(async () => true), pickImport: vi.fn(async () => null),
  signOutAll: vi.fn(async () => []), reset: vi.fn(async () => {}), clearGlobal: vi.fn(async () => {})
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); Object.assign(state, { lastSaveAt: null, lastBackupAt: null })
  Object.assign(window, { palco: { dataSettings: api, preferences: { get: async () => defaultPreferences(), set: vi.fn(), onChange: () => () => {} } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })
const open = async (section: string) => { await act(async () => root.render(<DataTab section={section} />)); await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const titles = () => [...host.querySelectorAll('.settings-section-title')].map((e) => e.textContent)
const buttons = (within: Element = host) => [...within.querySelectorAll('button')].map((b) => b.textContent)
const rows = () => [...host.querySelectorAll('.data-row')].map((r) => [...r.children].map((c) => c.textContent))

it('Armazenamento: Local com o caminho à direita, Uso com Total e cada espaço de trabalho, e Redefinir em vermelho', async () => {
  await open('Armazenamento')
  expect(titles()).toEqual(['Local de Armazenamento', 'Uso de Armazenamento', 'Redefinir'])
  expect(host.querySelectorAll('.settings-divider')).toHaveLength(2)
  expect(rows()).toEqual([['Local', '/tmp/fixture/.palco'], ['Total', '105 kB'], ['Códigos', '12,1 kB'], ['Outro', '2 kB']])
  expect(host.querySelector('.data-path')!.getAttribute('title')).toBe('/tmp/fixture/.palco')
  const [location, reset] = [...host.querySelectorAll('.data-actions')]
  expect(buttons(location)).toEqual(['Alterar…', 'Mostrar na Pasta'])
  expect(buttons(reset)).toEqual(['Apagar Todos os Dados…'])
  expect(reset!.querySelector('button')!.className).toContain('is-destructive')
})
it('caminho longo é cortado no meio e continua inteiro no título', () => {
  const long = '/home/pessoa/uma/pasta/muito/funda/para/guardar/os/dados/.palco'
  expect(shortPath(long)).toHaveLength(46); expect(shortPath(long)).toContain('…'); expect(shortPath(long).endsWith('dados/.palco')).toBe(true); expect(shortPath('/a')).toBe('/a')
})
it('erro ao calcular o uso aparece e não esconde o resto', async () => {
  api.usage.mockRejectedValueOnce(new Error('sem permissão'))
  await open('Armazenamento')
  expect(host.querySelector('[role=alert]')!.textContent).toContain('sem permissão'); expect(titles()).toHaveLength(3)
})
it('Backups: último salvamento (hora) e último backup automático (relativo); Gerenciar à esquerda, Exportar e Importar à direita', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 25, 17, 30))
  Object.assign(state, { lastSaveAt: new Date(2026, 10, 25, 16, 52).toISOString(), lastBackupAt: new Date(2026, 10, 25, 16, 52).toISOString() })
  await open('Backups')
  expect(titles()).toEqual(['Salvamento Automático', 'Backup e Restauração'])
  expect(rows()).toEqual([['Último salvamento', '16:52'], ['Último backup automático', 'há 38 minutos']])
  const bar = host.querySelector('.data-actions.is-split')!
  expect(buttons(bar.children[0]!.parentElement!)).toEqual(['Gerenciar Backups…', 'Exportar Backup Completo…', 'Importar Backup…'])
  expect(buttons(bar.querySelector('.data-actions-end')!)).toEqual(['Exportar Backup Completo…', 'Importar Backup…'])
})
it('Backups sem nada salvo mostra Nunca; o aviso sobre o que o ZIP não leva fica no gerenciador', async () => {
  await open('Backups')
  expect(rows()).toEqual([['Último salvamento', 'Nunca'], ['Último backup automático', 'Nunca']])
  expect(host.textContent).not.toContain('Os ZIPs não incluem')
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Gerenciar Backups…')!.click())
  expect(host.querySelector('[role=dialog]')!.textContent).toContain('Os ZIPs não incluem')
  expect(host.querySelector('[role=dialog]')!.textContent).toContain('a cada 60 minutos')
})
it('Portais: um título só, escopo padrão e Dados Compartilhados com botão vermelho e descrição', async () => {
  await open('Armazenamento dos Portais')
  expect(titles()).toEqual(['Armazenamento dos Portais'])
  expect(host.querySelector('[data-option=defaultPortalStorage] select')).toBeTruthy()
  const shared = host.querySelector('.data-shared')!
  expect(shared.querySelector('.settings-label')!.textContent).toBe('Dados Compartilhados')
  const clear = shared.querySelector('button')!
  expect(clear.textContent).toBe('Apagar Armazenamento Global…'); expect(clear.className).toContain('is-destructive')
  expect(document.getElementById(clear.getAttribute('aria-describedby')!)!.textContent).toContain('escopo global')
})

function service() {
  const base = mkdtempSync(join(tmpdir(), 'palco-data-settings-')), data = join(base, 'data'); dirs.push(base); mkdirSync(data)
  const roots = new DataRoot(join(base, 'locator.json'), data)
  const svc = new DataService({ roots, flush: () => {}, clearGlobal: async () => {}, signOutAll: async () => [], workspaces: () => [{ id: 'w1', name: 'Um' }, { id: 'w2', name: 'Dois' }] })
  return { base, data, svc }
}
const put = (path: string, bytes: number) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, Buffer.alloc(bytes, 'a')) }
const ws = (id: string, terminals: string[]) => ({ id, name: id, nodes: Object.fromEntries(terminals.map((t) => [t, { id: t, kind: 'terminal' }])), connections: [], floors: {} })

it('uso do disco: soma por espaço de trabalho (arquivo, ícone e chats dos terminais), total da raiz, do maior ao menor, sem seguir links', async () => {
  const { base, data, svc } = service()
  const before = (await svc.usage()).total
  writeEnvelopeAtomic(join(data, 'workspaces/w1.json'), 'workspace', 2, ws('w1', ['t1']))
  writeEnvelopeAtomic(join(data, 'workspaces/w2.json'), 'workspace', 2, ws('w2', ['t2']))
  put(join(data, 'workspaces/w1/icon.png'), 100); put(join(data, 'chats/t1/log'), 10); put(join(data, 'chats/t2/log'), 5000); put(join(data, 'backups/w1/a.zip'), 7000)
  put(join(base, 'fora/enorme'), 100000); symlinkSync(join(base, 'fora'), join(data, 'link'))
  const usage = await svc.usage()
  expect(usage.workspaces.map((w) => w.name)).toEqual(['Dois', 'Um'])
  const json = (usage.workspaces[1]!.size - 110)
  expect(json).toBeGreaterThan(0); expect(json).toBeLessThan(1000)
  expect(usage.total - before).toBeGreaterThanOrEqual(usage.workspaces[0]!.size + usage.workspaces[1]!.size + 7000)
  expect(usage.total).toBeLessThan(50000)
})
it('último salvamento vem do arquivo de espaço de trabalho mais novo; último backup, do snapshot mais novo', () => {
  const { data, svc } = service()
  expect(svc.lastSaveAt()).toBeNull(); expect(svc.lastBackupAt()).toBeNull()
  writeEnvelopeAtomic(join(data, 'workspaces/w1.json'), 'workspace', 2, { ...ws('w1', []), drawings: [], activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } })
  writeEnvelopeAtomic(join(data, 'workspaces/w2.json'), 'workspace', 2, { ...ws('w2', []), drawings: [], activeFloor: null, camera: { offset: { x: 0, y: 0 }, zoom: 1 } })
  utimesSync(join(data, 'workspaces/w1.json'), new Date(1000_000), new Date(1000_000)); utimesSync(join(data, 'workspaces/w2.json'), new Date(2000_000), new Date(2000_000))
  expect(svc.lastSaveAt()).toBe(new Date(2000_000).toISOString())
  svc.backupNow()
  expect(svc.lastBackupAt()).toBe(svc.snapshots()[0]!.createdAt)
})
