// @vitest-environment happy-dom
// Respostas atrasadas preservam o tópico e mensagens aguardam o agente ficar pronto.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { ChatService } from '../src/main/chat/chat-service'
import { ChatStore } from '../src/main/chat/chat-store'
import { TerminalManager } from '../src/main/pty/terminal-manager'
import { ChatView } from '../src/renderer/src/chat/ChatView'
import { useChat } from '../src/renderer/src/chat/useChat'
import type { TerminalNode } from '../src/shared/model'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, dir: string
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  dir = mkdtempSync(join(tmpdir(), 'palco-chat-delivery-'))
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers(); vi.unstubAllGlobals()
})

const message = (text: string) => ({ id: text, ts: 1, role: 'user' as const, kind: 'message' as const, text })
const snapshot = (thread: string, texts: string[], extra: object = {}) => ({ terminalId: 't', thread, entries: texts.map(message), hasOlder: true, status: 'idle', unreadCount: 0, workingSince: null, filledThreads: [], ...extra })

describe("respostas atrasadas", () => {
  /** Cada leitura de estado e de página antiga fica pendente até o teste responder, na ordem que quiser. */
  async function mount() {
    const states: Array<(v: unknown) => void> = [], olders: Array<(v: unknown) => void> = []
    let changed = (): void => {}
    Object.assign(window, { palco: { chat: {
      state: () => new Promise((r) => states.push(r)),
      older: () => new Promise((r) => olders.push(r)),
      onChange: (cb: (id: string) => void) => { changed = () => cb('t'); return () => {} }
    } } })
    let hook!: ReturnType<typeof useChat>
    function Probe() { hook = useChat('t'); return createElement('div', null, hook.entries.map((e) => e.text).join(',')) }
    await act(async () => root.render(createElement(Probe)))
    return {
      change: () => act(async () => { changed() }),
      answer: (i: number, v: unknown) => act(async () => { states[i]!(v) }),
      loadOlder: () => act(async () => { void hook.loadOlder() }),
      answerOlder: (i: number, texts: string[]) => act(async () => { olders[i]!(texts.map(message)) })
    }
  }

  it('página antiga do tópico anterior que chega depois da troca é descartada', async () => {
    const h = await mount()
    await h.answer(0, snapshot('blue', ['azul']))
    await h.loadOlder()
    await h.change()
    await h.answer(1, snapshot('red', ['vermelho']))
    await h.answerOlder(0, ['azul-antiga'])
    expect(host.textContent).toBe('vermelho')
  })

  it('leitura de estado atrasada não volta ao tópico anterior', async () => {
    const h = await mount()
    await h.answer(0, snapshot('blue', ['azul']))
    await h.change(); await h.change()
    await h.answer(2, snapshot('red', ['vermelho']))
    await h.answer(1, snapshot('blue', ['azul']))
    expect(host.textContent).toBe('vermelho')
  })

  it('página antiga do mesmo tópico entra antes das mensagens, mesmo com outra leitura no meio', async () => {
    const h = await mount()
    await h.answer(0, snapshot('blue', ['azul']))
    await h.loadOlder()
    await h.change()
    await h.answer(1, snapshot('blue', ['azul']))
    await h.answerOlder(0, ['antiga'])
    expect(host.textContent).toBe('antiga,azul')
  })

  it('avisos em sequência não deixam a tela parada: vale a resposta mais nova que a já vista', async () => {
    const h = await mount()
    await h.answer(0, snapshot('blue', ['um']))
    await h.change(); await h.change()
    await h.answer(1, snapshot('blue', ['um', 'dois']))
    expect(host.textContent).toBe('um,dois')
  })
})

describe("fila de entrega no terminal", () => {
  const agent: TerminalNode = { id: 'a', kind: 'terminal', name: 'A', agent: 'claude', command: 'agente', floorId: null, cwd: process.cwd(), pos: { x: 0, y: 0 }, size: { w: 400, h: 300 } }
  function boot() {
    vi.useFakeTimers()
    const writes: string[] = []
    let exit = (): void => {}
    const manager = new TerminalManager({
      socketPath: '/s', palcoBin: '/p', readyTimeoutMs: 1000, readyQuietMs: 60_000,
      spawnPty: () => ({ pid: 1, onData: () => ({ dispose() {} }), onExit: (cb: (e: { exitCode: number }) => void) => { exit = () => cb({ exitCode: 1 }); return { dispose() {} } }, kill() {}, resize() {}, write: (d: string) => { writes.push(d) } }) as unknown as IPty
    })
    const failed: string[] = [], outcome: boolean[] = []
    manager.onDeliveryFailed((id) => failed.push(id))
    manager.spawn(agent)
    return { manager, outcome, failed, typed: () => writes.join(''), exit: () => exit(), wait: (ms: number) => vi.advanceTimersByTimeAsync(ms) }
  }

  it('a mensagem espera mesmo depois do teto e sai quando o agente fica pronto', async () => {
    const h = boot()
    expect(typeof h.manager.deliverWhenReady('a', 'na-fila', (sent) => h.outcome.push(sent))).toBe('function')
    await h.wait(8000)
    expect(h.manager.agentState('a')).toBe('failed')
    expect(h.typed()).not.toContain('na-fila')
    expect([h.outcome, h.failed]).toEqual([[], []])
    // Enviada já depois do teto: também entra na fila.
    h.manager.deliverWhenReady('a', 'depois-do-teto', (sent) => h.outcome.push(sent))
    h.manager.markReady('a'); await h.wait(600)
    expect(h.typed().indexOf('na-fila')).toBeGreaterThan(-1)
    expect(h.typed().indexOf('depois-do-teto')).toBeGreaterThan(h.typed().indexOf('na-fila'))
    expect(h.outcome).toEqual([true, true])
  })

  it('o teto continua falhando os pedidos comuns', async () => {
    const h = boot()
    h.manager.deliverPrompt('a', 'ask-comum')
    h.manager.deliverWhenReady('a', 'do-chat', (sent) => h.outcome.push(sent))
    await h.wait(8000)
    expect(h.failed).toEqual(['a'])
    h.manager.markReady('a'); await h.wait(600)
    expect(h.typed()).toContain('do-chat')
    expect(h.typed()).not.toContain('ask-comum')
  })

  it('agente pronto recebe na hora; terminal encerrado antes avisa que a mensagem se perdeu; desistir tira da fila', async () => {
    const ready = boot()
    ready.manager.markReady('a'); await ready.wait(600)
    expect(ready.manager.deliverWhenReady('a', 'direto', (sent) => ready.outcome.push(sent))).toBeUndefined()
    expect(ready.typed()).toContain('direto')

    const dead = boot()
    await dead.wait(8000)
    dead.manager.deliverWhenReady('a', 'perdida', (sent) => dead.outcome.push(sent))
    dead.exit()
    expect(dead.outcome).toEqual([false])

    const dropped = boot()
    const cancel = dropped.manager.deliverWhenReady('a', 'desistida', (sent) => dropped.outcome.push(sent))!
    cancel(); dropped.manager.markReady('a'); await dropped.wait(600)
    expect(dropped.typed()).not.toContain('desistida')
    expect(dropped.outcome).toEqual([])
  })
})

describe("o chat acompanha a fila", () => {
  function service() {
    const queue: Array<{ text: string; settle(sent: boolean): void; cancelled: boolean }> = [], written: string[] = []
    const timers = new Map<number, () => void>()
    let next = 0
    const store = new ChatStore(join(dir, 'chats'))
    const chat = new ChatService({
      store, home: dir, isRunning: () => true, isAgent: () => true, onTerminalData: () => () => {}, now: () => 5000, settleMs: 1000,
      write: (_id, data) => written.push(data),
      deliver: (_id, text, settle) => { const item = { text, settle, cancelled: false }; queue.push(item); return () => { item.cancelled = true } },
      setTimer: (fn) => { timers.set(++next, fn); return next }, clearTimer: (id) => { timers.delete(id as number) }
    })
    const send = async (text: string) => { const r = await chat.send('t', { text, attachments: [] }); if (!r.accepted) throw new Error(r.cause); return r.entryId }
    return { chat, store, queue, written, timers, send }
  }

  it('fica "na fila" sem vencer o prazo de resposta, e só conta o turno depois de entregue', async () => {
    const h = service()
    await h.send('oi')
    expect(h.chat.state('t')).toMatchObject({ status: 'working', delivery: 'queued' })
    expect(h.timers.size).toBe(0)
    h.chat.turnEnded('t')
    expect(h.chat.state('t').status).toBe('working')
    h.queue[0]!.settle(true)
    expect(h.chat.state('t')).toMatchObject({ status: 'working' })
    expect(h.chat.state('t').delivery).toBeUndefined()
    expect(h.timers.size).toBe(1)
  })

  it('resposta a um turno anterior não apaga o turno da mensagem que ainda vai sair', async () => {
    const h = service()
    await h.send('oi')
    await h.chat.say('t', { text: 'resposta atrasada' })
    h.queue[0]!.settle(true)
    expect(h.chat.state('t').status).toBe('working')
  })

  it('se o terminal encerra antes, o chat diz que a mensagem não chegou, até o próximo envio', async () => {
    const h = service()
    await h.send('oi')
    h.queue[0]!.settle(false)
    expect(h.chat.state('t')).toMatchObject({ status: 'needsAttention', delivery: 'lost' })
    await h.send('de novo')
    expect(h.chat.state('t').delivery).toBe('queued')
  })

  it('interromper, excluir a mensagem ou limpar o tópico tiram a mensagem da fila', async () => {
    const h = service()
    await h.send('um')
    expect(await h.chat.interrupt('t')).toBe(true)
    expect([h.queue[0]!.cancelled, h.written]).toEqual([true, []])
    expect(h.chat.state('t').delivery).toBeUndefined()
    const two = await h.send('dois')
    h.chat.deleteEntry('t', 'blue', two)
    expect([h.queue[1]!.cancelled, h.chat.state('t').status]).toEqual([true, 'idle'])
    await h.send('três'); h.chat.clearThread('t', 'blue')
    await h.send('quatro'); h.chat.clearHistory('t')
    expect(h.queue.map((q) => q.cancelled)).toEqual([true, true, true, true])
    expect(h.chat.state('t').delivery).toBeUndefined()
  })

  it.each([
    [{ status: 'working', delivery: 'queued' }, 'na fila'],
    [{ status: 'needsAttention', delivery: 'lost' }, 'encerrou antes de receber']
  ])('a tela explica %o', async (state, text) => {
    Object.assign(window, { palco: { chat: { state: async () => snapshot('blue', ['oi'], state), older: async () => [], onChange: () => () => {}, markRead: async () => {} } } })
    // Sem a prévia do terminal (ela tem o teste dela): aqui interessa o texto do estado.
    await act(async () => root.render(createElement(ChatView, { terminalId: 't', name: 'Ana', showsShell: false })))
    expect(host.querySelector('[role=status]')?.textContent).toContain(text)
    expect(host.textContent).not.toContain('está trabalhando')
    expect(host.textContent).not.toContain('Nenhuma resposta')
  })
})
