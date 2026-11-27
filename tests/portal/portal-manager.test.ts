import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { guarded, pageClick, pageFill, pageSnapshot, pageText } from '../../src/main/portal/page-scripts'
import { PortalClosedError, PortalManager, TEXT_LIMIT, SNAPSHOT_LIMIT, type WebContentsLike } from '../../src/main/portal/portal-manager'

interface Fake {
  loadURL: Mock
  executeJavaScript: Mock
  capturePage: Mock
  goBack: Mock
  reload: Mock
  getURL: Mock
  isDestroyed: Mock
  isLoading: Mock
  on: Mock
  removeListener: Mock
  emit: (event: string, ...args: unknown[]) => boolean
}

function fakeContents(over: Partial<Fake> = {}): Fake {
  const events = new EventEmitter()
  return {
    loadURL: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async () => 'resultado'),
    capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('PNGDATA') })),
    goBack: vi.fn(),
    reload: vi.fn(),
    getURL: vi.fn(() => 'https://atual.example/'),
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    on: vi.fn((event, listener) => { events.on(event, listener); return events }),
    removeListener: vi.fn((event, listener) => { events.removeListener(event, listener); return events }),
    emit: (event, ...args) => events.emit(event, ...args),
    ...over
  }
}

let contents: Map<number, Fake>
let written: Array<[string, Buffer]>
let manager: PortalManager

beforeEach(() => {
  contents = new Map()
  written = []
  manager = new PortalManager({
    fromId: (id) => contents.get(id) as unknown as WebContentsLike | undefined,
    writeFile: (path, data) => void written.push([path, data]),
    nameOf: (nodeId) => (nodeId === 'n1' ? 'Web' : undefined),
    now: () => 1700000000000
  })
})

const open = (nodeId = 'n1', id = 7, wc: Fake = fakeContents()): Fake => {
  contents.set(id, wc)
  manager.register(nodeId, id)
  return wc
}

describe('PortalManager: portal fechado', () => {
  it('nó nunca registrado responde PortalClosedError em todas as ações', async () => {
    for (const call of [
      () => manager.navigate('x', 'https://a.com'),
      () => manager.snapshot('x'),
      () => manager.click('x', 'e1'),
      () => manager.fill('x', 'e1', 'v'),
      () => manager.text('x'),
      () => manager.back('x'),
      () => manager.reload('x'),
      () => manager.screenshot('x')
    ]) {
      await expect(call()).rejects.toBeInstanceOf(PortalClosedError)
    }
    expect(new PortalClosedError().message).toBe('portal não está aberto')
  })

  it('webContents destruído ou desaparecido também é portal fechado', async () => {
    const wc = open()
    wc.isDestroyed.mockReturnValue(true)
    await expect(manager.snapshot('n1')).rejects.toBeInstanceOf(PortalClosedError)
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
    contents.delete(7)
    wc.isDestroyed.mockReturnValue(false)
    await expect(manager.text('n1')).rejects.toBeInstanceOf(PortalClosedError)
  })

  it('unregister fecha; um novo register (nova aba do mesmo nó) reabre', async () => {
    open()
    manager.unregister('n1')
    await expect(manager.text('n1')).rejects.toBeInstanceOf(PortalClosedError)
    const novo = open('n1', 9)
    await expect(manager.text('n1')).resolves.toBe('resultado')
    expect(novo.executeJavaScript).toHaveBeenCalled()
  })
})

describe('PortalManager: navegação', () => {
  it.each(['https://a.com/x', 'http://localhost:3000', 'file:///tmp/p.html'])('navigate aceita %s e devolve a URL final', async (url) => {
    const wc = open()
    expect(await manager.navigate('n1', url)).toBe('https://atual.example/')
    expect(wc.loadURL).toHaveBeenCalledWith(url)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', 'chrome://gpu', 'about:blank', 'view-source:https://a.com', 'sem esquema', ''])('navigate recusa %j sem tocar no webContents', async (url) => {
    const wc = open()
    await expect(manager.navigate('n1', url)).rejects.toThrow(/http, https|URL inválida/)
    expect(wc.loadURL).not.toHaveBeenCalled()
  })

  it('falha de carregamento vira erro legível', async () => {
    open('n1', 7, fakeContents({ loadURL: vi.fn(async () => { throw new Error('ERR_NAME_NOT_RESOLVED (-105) loading') }) }))
    await expect(manager.navigate('n1', 'https://nao.existe')).rejects.toThrow(/falha ao carregar.*ERR_NAME_NOT_RESOLVED/)
  })

  it('aguarda o evento de fim de carregamento e expõe falhas principais', async () => {
    const wc = fakeContents(); wc.isLoading.mockReturnValue(true); open('n1', 7, wc)
    const pending = manager.waitForLoad('n1', 15000)
    wc.emit('did-finish-load')
    await expect(pending).resolves.toBe('loaded')

    const failed = fakeContents(); failed.isLoading.mockReturnValue(true); open('n2', 8, failed)
    const rejected = manager.waitForLoad('n2', 15000)
    failed.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://broken.example/', true)
    await expect(rejected).rejects.toThrow(/falha ao carregar.*ERR_NAME_NOT_RESOLVED/)
  })

  it('espera a página mesmo quando o webview registra depois do pedido', async () => {
    const pending = manager.waitForLoad('n1', 15000)
    const wc = fakeContents(); wc.isLoading.mockReturnValue(true); open('n1', 7, wc)
    wc.emit('did-finish-load')
    await expect(pending).resolves.toBe('loaded')
  })

  it('limita a espera do carregamento ao prazo solicitado', async () => {
    vi.useFakeTimers()
    const wc = fakeContents(); wc.isLoading.mockReturnValue(true); open('n1', 7, wc)
    const pending = manager.waitForLoad('n1', 120)
    await vi.advanceTimersByTimeAsync(120)
    await expect(pending).resolves.toBe('timeout')
    vi.useRealTimers()
  })

  it('navigate permanece pendente até loadURL resolver', async () => {
    let finish!: () => void
    const wc = open('n1', 7, fakeContents({ loadURL: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) }))
    let done = false
    const navigation = manager.navigate('n1', 'https://example.test/').then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    finish(); await navigation
    expect(done).toBe(true)
    expect(wc.loadURL).toHaveBeenCalledOnce()
  })

  it('back e reload chamam o webContents e devolvem a URL', async () => {
    const wc = open()
    expect(await manager.back('n1')).toBe('https://atual.example/')
    expect(await manager.reload('n1')).toBe('https://atual.example/')
    expect(wc.goBack).toHaveBeenCalledOnce()
    expect(wc.reload).toHaveBeenCalledOnce()
  })
})

describe('PortalManager: scripts de página', () => {
  it('snapshot, text, click e fill executam os scripts injetáveis com os argumentos como dados', async () => {
    const wc = open()
    await manager.snapshot('n1')
    await manager.text('n1')
    await manager.click('n1', 'e2')
    const hostil = `x'); alert(1); ('`
    await manager.fill('n1', '#nome', hostil)
    expect(wc.executeJavaScript.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      guarded(pageSnapshot, SNAPSHOT_LIMIT),
      guarded(pageText, TEXT_LIMIT),
      guarded(pageClick, 'e2'),
      guarded(pageFill, '#nome', hostil)
    ])
    // Os argumentos viajam como JSON, nunca concatenados como código.
    expect(wc.executeJavaScript.mock.calls[3]![0]).toContain(JSON.stringify([ '#nome', hostil ]).slice(1, -1))
  })

  it('devolve o texto retornado pela página e propaga o erro da página', async () => {
    const wc = open()
    wc.executeJavaScript.mockResolvedValueOnce('[e1] botão "ok"')
    expect(await manager.snapshot('n1')).toBe('[e1] botão "ok"')
    wc.executeJavaScript.mockRejectedValueOnce(new Error('elemento não encontrado: e9'))
    await expect(manager.click('n1', 'e9')).rejects.toThrow('elemento não encontrado: e9')
  })

  it('a mensagem de erro da página chega inteira (o Electron esconde a das exceções)', async () => {
    const wc = open()
    wc.executeJavaScript.mockResolvedValueOnce({ ok: false, error: 'elemento desabilitado: #enviar' })
    await expect(manager.click('n1', '#enviar')).rejects.toThrow('elemento desabilitado: #enviar')
    wc.executeJavaScript.mockResolvedValueOnce({ ok: true, value: '[e1] botão "ok"' })
    expect(await manager.snapshot('n1')).toBe('[e1] botão "ok"')
    wc.executeJavaScript.mockResolvedValueOnce({ ok: false })
    await expect(manager.text('n1')).rejects.toThrow('a página recusou a ação')
  })

  it('o script enviado captura a exceção da página e a devolve como dado', () => {
    const run = (fn: Function, ...args: unknown[]): unknown => new Function('document', `return ${guarded(fn, ...args)}`)({})
    const boom = function boom(): string { throw new Error('quebrou na página') }
    expect(run(boom)).toEqual({ ok: false, error: 'quebrou na página' })
    expect(run(function ok(): string { return 'feito' })).toEqual({ ok: true, value: 'feito' })
    expect(run(function str(): string { throw 'texto solto' })).toEqual({ ok: false, error: 'texto solto' })
  })

  it('resultado que não é texto vira texto', async () => {
    const wc = open()
    wc.executeJavaScript.mockResolvedValueOnce(undefined)
    expect(await manager.click('n1', 'e1')).toBe('')
  })

  it('argumentos que não são texto são recusados antes de executar', async () => {
    const wc = open()
    await expect(manager.click('n1', 42 as unknown as string)).rejects.toThrow(/texto/)
    await expect(manager.fill('n1', 'e1', {} as unknown as string)).rejects.toThrow(/texto/)
    expect(wc.executeJavaScript).not.toHaveBeenCalled()
  })
})

describe('PortalManager: captura de tela', () => {
  it('grava o PNG no caminho pedido e devolve o caminho', async () => {
    open()
    const path = join(tmpdir(), 'captura.png')
    expect(await manager.screenshot('n1', path)).toBe(path)
    expect(written).toEqual([[path, Buffer.from('PNGDATA')]])
  })

  it('sem caminho, usa tmpdir/palco-<nome>-<ts>.png com o nome do nó sanitizado', async () => {
    open()
    expect(await manager.screenshot('n1')).toBe(join(tmpdir(), 'palco-web-1700000000000.png'))
    manager.register('n2', 8)
    contents.set(8, fakeContents())
    expect(await manager.screenshot('n2')).toBe(join(tmpdir(), 'palco-n2-1700000000000.png'))
  })

  it('recusa caminho relativo ou sem .png', async () => {
    open()
    await expect(manager.screenshot('n1', 'rel.png')).rejects.toThrow(/caminho/)
    await expect(manager.screenshot('n1', '/tmp/x.txt')).rejects.toThrow(/caminho/)
    await expect(manager.screenshot('n1', '/tmp/../etc/x.png')).rejects.toThrow(/caminho/)
    expect(written).toEqual([])
  })
})
