import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  isPortalPartition, normalizePortalInput, portalPartitionFor, uniquePortalName, userAgentPresets, PORTAL_STORAGES
} from '../../src/shared/portal-settings'
import { NewPortalDialog, toNewPortalNode } from '../../src/renderer/src/dialogs/NewPortalDialog'
import { parseNewNode, parseNodePatch } from '../../src/main/validate'
import { enforceWebviewPolicy, PORTAL_PARTITION } from '../../src/main/security'
import { popupWindowPolicy } from '../../src/main/portal/popup-policy'
import { WorkspaceStore } from '../../src/main/domain/workspace-store'

describe('URL do Novo Portal', () => {
  it.each([
    ['', 'about:blank'],
    ['   ', 'about:blank'],
    ['exemplo.com', 'https://exemplo.com/'],
    ['localhost:3000/app', 'http://localhost:3000/app'],
    ['app.localhost:5173', 'http://app.localhost:5173/'],
    ['127.0.0.1:8765', 'http://127.0.0.1:8765/'],
    ['0.0.0.0:8000', 'http://0.0.0.0:8000/'],
    ['[::1]:8080', 'http://[::1]:8080/'],
    ['https://a.com/x', 'https://a.com/x'],
    ['file:///tmp/p.html', 'file:///tmp/p.html'],
    ['/tmp/p.html', 'file:///tmp/p.html']
  ])('%j -> %s', (input, expected) => {
    expect(normalizePortalInput(input)).toBe(expected)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', 'chrome://gpu', 'http://'])('recusa %j', (input) => {
    expect(normalizePortalInput(input)).toBeNull()
  })
})

describe('nome do portal', () => {
  it('opcional, aparado e único (sem diferenciar maiúsculas)', () => {
    expect(uniquePortalName('', [])).toBe('Portal')
    expect(uniquePortalName('  ', ['Portal'])).toBe('Portal 2')
    expect(uniquePortalName('', ['portal', 'Portal 2'])).toBe('Portal 3')
    expect(uniquePortalName(' Docs ', ['Nota'])).toBe('Docs')
    expect(uniquePortalName('Docs', ['docs'])).toBe('Docs 2')
    expect(uniquePortalName('x'.repeat(200), [])).toHaveLength(120)
  })
})

describe('armazenamento e partição', () => {
  it('isolado por portal, por workspace ou global; sem escolha (portais antigos) fica na partição global de antes', () => {
    expect(PORTAL_STORAGES).toEqual(['isolated', 'workspace', 'global'])
    expect(portalPartitionFor('isolated', 'n1', 'w1')).toBe('persist:portal-n1')
    expect(portalPartitionFor('workspace', 'n1', 'w1')).toBe('persist:portal-ws-w1')
    expect(portalPartitionFor('global', 'n1', 'w1')).toBe(PORTAL_PARTITION)
    expect(portalPartitionFor(undefined, 'n1', 'w1')).toBe(PORTAL_PARTITION)
  })

  it('o main só aceita partições de portal; qualquer outra cai na global', () => {
    expect(isPortalPartition('persist:portal-3f2a-b')).toBe(true)
    expect(isPortalPartition('persist:portal-ws-w1')).toBe(true)
    expect(isPortalPartition(PORTAL_PARTITION)).toBe(true)
    for (const bad of ['', 'persist:app', 'portal-n1', 'persist:portal-../x', 'persist:portal-a b']) expect(isPortalPartition(bad)).toBe(false)
    const ok = { src: 'https://a.com/', partition: 'persist:portal-n1' }
    expect(enforceWebviewPolicy({}, ok)).toBe(true)
    expect(ok.partition).toBe('persist:portal-n1')
    const evil = { src: 'https://a.com/', partition: 'persist:main' }
    expect(enforceWebviewPolicy({}, evil)).toBe(true)
    expect(evil.partition).toBe(PORTAL_PARTITION)
    const none: Record<string, unknown> = { src: 'https://a.com/' }
    expect(enforceWebviewPolicy({}, none)).toBe(true)
    expect(none.partition).toBe(PORTAL_PARTITION)
  })

  it('popup herda a sessão do portal que o abriu', () => {
    const session = { tag: 's' }
    const r = popupWindowPolicy('https://a.com/', session as never)
    expect(r.action).toBe('allow')
    if (r.action === 'allow') {
      expect(r.overrideBrowserWindowOptions.webPreferences?.session).toBe(session)
      expect(r.overrideBrowserWindowOptions.webPreferences?.partition).toBeUndefined()
    }
    const legacy = popupWindowPolicy('https://a.com/')
    if (legacy.action === 'allow') expect(legacy.overrideBrowserWindowOptions.webPreferences?.partition).toBe(PORTAL_PARTITION)
  })
})

describe('agente de usuário', () => {
  it('padrão vazio, Computador, Celular e Personalizado, com a versão do Chromium instalado', () => {
    const groups = userAgentPresets(140)
    expect(groups.map((g) => g.group)).toEqual(['Computador', 'Celular'])
    expect(groups[0]!.items.map((i) => i.label)).toEqual(['Chrome', 'Firefox', 'Microsoft Edge'])
    expect(groups[1]!.items.map((i) => i.label)).toEqual(['Safari (iPhone)', 'Chrome (Android)', 'Firefox (Android)', 'Microsoft Edge (Android)'])
    expect(groups[0]!.items[0]!.ua).toContain('Chrome/140.0.0.0')
    expect(groups[1]!.items[0]!.ua).toContain('iPhone')
    for (const g of groups) for (const i of g.items) expect(i.ua).toMatch(/^Mozilla\/5\.0 /)
  })
})

describe('nó criado pelo diálogo', () => {
  const frame = { pos: { x: 10, y: 20 }, size: { w: 800, h: 600 } }
  it('grava URL normalizada, nome único, UA aparado e o armazenamento', () => {
    expect(toNewPortalNode({ url: 'localhost:3000', name: '', userAgent: '  UA/1 ', storage: 'workspace' }, frame, null, ['Portal'])).toEqual({
      kind: 'portal', floorId: null, name: 'Portal 2', url: 'http://localhost:3000/', userAgent: 'UA/1', storage: 'workspace', ...frame
    })
    expect(toNewPortalNode({ url: '', name: 'Docs', userAgent: '  ', storage: 'isolated' }, frame, 'f1', [])).toEqual({
      kind: 'portal', floorId: 'f1', name: 'Docs', url: 'about:blank', storage: 'isolated', ...frame
    })
    expect(() => toNewPortalNode({ url: 'javascript:x', name: '', userAgent: '', storage: 'isolated' }, frame, null, [])).toThrow(/endereço/)
  })

  it('o main valida UA e armazenamento na criação e na edição', () => {
    const base = { kind: 'portal', name: 'P', url: 'https://a.com/', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
    expect(parseNewNode({ ...base, userAgent: 'UA/1', storage: 'global' })).toMatchObject({ userAgent: 'UA/1', storage: 'global' })
    expect(() => parseNewNode({ ...base, storage: 'cofre' })).toThrow()
    expect(() => parseNewNode({ ...base, userAgent: 'a\nb' })).toThrow()
    expect(() => parseNewNode({ ...base, userAgent: 'x'.repeat(600) })).toThrow()
    expect(parseNodePatch({ userAgent: '', storage: 'isolated' }, 'portal')).toEqual({ userAgent: '', storage: 'isolated' })
    expect(() => parseNodePatch({ storage: 'isolated' }, 'note')).toThrow()
  })

  it('o store grava, troca e limpa (UA vazio volta ao padrão)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-portal-'))
    try {
      const store = new WorkspaceStore(join(dir, 'ws.json'))
      const id = store.addNode({ kind: 'portal', floorId: null, name: 'P', url: 'about:blank', userAgent: 'UA/1', storage: 'workspace', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } })
      expect(store.get().nodes[id]).toMatchObject({ userAgent: 'UA/1', storage: 'workspace' })
      store.patchNode(id, { userAgent: '', storage: 'global' })
      const after = store.get().nodes[id] as unknown as Record<string, unknown>
      expect(after.userAgent).toBeUndefined()
      expect(after.storage).toBe('global')
      store.flush()
      store.dispose()
      const again = new WorkspaceStore(join(dir, 'ws.json'))
      expect(again.get().nodes[id]).toMatchObject({ storage: 'global' })
      again.dispose()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('diálogo', () => {
  it('abas Navegador e Dispositivos (desabilitada), URL, Nome, Agente de Usuário com informação, Armazenamento, Cancelar e Criar', () => {
    const html = renderToStaticMarkup(createElement(NewPortalDialog, { onCancel: () => {}, onCreate: async () => null }))
    expect(html).toContain('Novo Portal')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Navegador/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*role="tab"[^>]*>Dispositivos|<button[^>]*role="tab"[^>]*disabled=""[^>]*>Dispositivos/)
    expect(html).toContain('placeholder="https://example.com"')
    expect(html).toContain('inputMode="url"')
    expect(html).toContain('placeholder="Opcional"')
    expect(html).toContain('maxLength="120"')
    expect(html).toContain('Padrão (Chromium)')
    expect(html).toContain('<optgroup label="Computador">')
    expect(html).toContain('<optgroup label="Celular">')
    expect(html).toContain('Personalizado')
    expect(html).toContain('aria-label="Sobre o agente de usuário"')
    expect(html).toMatch(/<option value="isolated" selected="">Isolado<\/option>/)
    expect(html).toContain('>Workspace</option>')
    expect(html).toContain('>Global</option>')
    expect(html).toContain('>Cancelar</button>')
    expect(html).toContain('>Criar</button>')
  })
})
