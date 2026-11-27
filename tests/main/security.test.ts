import { describe, expect, it } from 'vitest'
import { createUrlPolicy, enforceWebviewPolicy, isPortalUrl } from '../../src/main/security'

describe('createUrlPolicy', () => {
  it('empacotado: só o index.html local (ignorando hash e query)', () => {
    const ok = createUrlPolicy({ indexFileUrl: 'file:///app/out/renderer/index.html' })
    expect(ok('file:///app/out/renderer/index.html')).toBe(true)
    expect(ok('file:///app/out/renderer/index.html#x')).toBe(true)
    expect(ok('file:///etc/passwd')).toBe(false)
    expect(ok('file:///app/out/renderer/outro.html')).toBe(false)
    expect(ok('https://evil.example/')).toBe(false)
    expect(ok('not a url')).toBe(false)
    expect(ok('')).toBe(false)
  })

  it('desenvolvimento: só a origem do servidor de dev', () => {
    const ok = createUrlPolicy({ indexFileUrl: 'file:///app/index.html', devUrl: 'http://localhost:5173/' })
    expect(ok('http://localhost:5173/')).toBe(true)
    expect(ok('http://localhost:5173/algo?x=1')).toBe(true)
    expect(ok('http://localhost:5174/')).toBe(false)
    expect(ok('https://localhost:5173/')).toBe(false)
    expect(ok('http://evil.example:5173/')).toBe(false)
    expect(ok('file:///app/index.html')).toBe(false)
  })
})

describe('política do webview (portal)', () => {
  const prefs = (): Record<string, unknown> => ({
    preload: '/app/preload.cjs',
    preloadURL: 'file:///app/preload.cjs',
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    webSecurity: false,
    allowRunningInsecureContent: true
  })

  it('força partition, apaga preload e liga o isolamento', () => {
    const webPreferences = prefs()
    const params: Record<string, unknown> = { src: 'https://exemplo.com/', partition: 'persist:outro', preload: '/x' }
    expect(enforceWebviewPolicy(webPreferences, params)).toBe(true)
    expect(params.partition).toBe('persist:palco-portal')
    expect(params.preload).toBeUndefined()
    expect(webPreferences.preload).toBeUndefined()
    expect(webPreferences.preloadURL).toBeUndefined()
    expect(webPreferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    })
  })

  it.each(['http://a.com/', 'https://a.com/x?y=1', 'file:///tmp/pagina.html', 'about:blank'])('aceita src %s', (src) => {
    expect(enforceWebviewPolicy(prefs(), { src })).toBe(true)
  })

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://a.com/', 'chrome://gpu', 'devtools://devtools/x', 'view-source:https://a.com', 'blob:https://a.com/1', '', 'nao e url'])('recusa src %j', (src) => {
    expect(enforceWebviewPolicy(prefs(), { src })).toBe(false)
  })

  it('src ausente é recusado', () => {
    expect(enforceWebviewPolicy(prefs(), {})).toBe(false)
  })

  it('isPortalUrl só deixa http, https e file (a navegação do convidado usa a mesma regra)', () => {
    expect(isPortalUrl('https://a.com')).toBe(true)
    expect(isPortalUrl('file:///x.html')).toBe(true)
    expect(isPortalUrl('about:blank')).toBe(false)
    expect(isPortalUrl('javascript:1')).toBe(false)
    expect(isPortalUrl('lixo')).toBe(false)
  })
})
