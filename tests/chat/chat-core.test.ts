import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THREAD_COLORS, chatHeader, isThreadColor } from '../../src/shared/chat'
import { ChatStore } from '../../src/main/chat/chat-store'
import { openAttachment, validateAttachment, MAX_ATTACHMENT_BYTES } from '../../src/main/chat/attach'
import { ChatService } from '../../src/main/chat/chat-service'

let dir: string, home: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-chat-')); home = join(dir, 'home'); mkdirSync(home) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, content: string | Buffer = 'x'): string => { const p = join(dir, name); writeFileSync(p, content); return p }
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('cabeçalho da mensagem do chat', () => {
  it('traz a instrução completa em linha, a cor do tópico e o texto do usuário depois da cerca', () => {
    const h = chatHeader('blue', 'Olá, rode os testes', [])
    expect(h).toMatch(/^---\nBelow is a message from the user through Palco Chat\./)
    expect(h).toContain('palco say'); expect(h).toContain('--progress'); expect(h).toContain('--question'); expect(h).toContain('--attach')
    expect(h).toContain('thread: blue\n---\nOlá, rode os testes')
    expect(h).toContain('palco-chat')
  })
  it('lista os anexos pelo caminho absoluto, depois do texto', () => {
    const h = chatHeader('pink', 'veja', [{ name: 'a.png', path: '/tmp/a.png', kind: 'image' }, { name: 'n.txt', path: '/tmp/n.txt', kind: 'file' }])
    expect(h).toMatch(/veja\n\nAttached by the user:\n- image: \/tmp\/a\.png\n- file: \/tmp\/n\.txt$/)
  })
  it('são sete tópicos por cor', () => { expect(THREAD_COLORS).toEqual(['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green']); expect(isThreadColor('red')).toBe(true); expect(isThreadColor('graphite')).toBe(false) })
})

describe('validação de anexo (caminho vem do agente: não é confiável)', () => {
  it('aceita arquivo comum absoluto e reconhece imagem pelo conteúdo', () => {
    expect(validateAttachment(file('a.txt', 'oi'), home)).toMatchObject({ ok: true, kind: 'file', name: 'a.txt' })
    expect(validateAttachment(file('foto.dat', PNG), home)).toMatchObject({ ok: true, kind: 'image' })
  })
  it('recusa relativo, inexistente, pasta, grande demais e vazio', () => {
    expect(validateAttachment('rel/a.txt', home)).toMatchObject({ ok: false })
    expect(validateAttachment(join(dir, 'nao-existe'), home)).toMatchObject({ ok: false })
    expect(validateAttachment(dir, home)).toMatchObject({ ok: false })
    expect(validateAttachment(file('vazio.txt', ''), home)).toMatchObject({ ok: false })
    expect(validateAttachment(file('grande.bin', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)), home)).toMatchObject({ ok: false })
  })
  it('recusa credenciais do usuário, inclusive por link simbólico', () => {
    mkdirSync(join(home, '.ssh')); const key = join(home, '.ssh', 'id_x'); writeFileSync(key, 'segredo')
    expect(validateAttachment(key, home)).toMatchObject({ ok: false })
    const link = join(dir, 'inocente.txt'); symlinkSync(key, link)
    expect(validateAttachment(link, home)).toMatchObject({ ok: false })
    mkdirSync(join(home, '.config', 'gcloud'), { recursive: true }); writeFileSync(join(home, '.config', 'gcloud', 'credentials.db'), 'x')
    expect(validateAttachment(join(home, '.config', 'gcloud', 'credentials.db'), home)).toMatchObject({ ok: false })
    writeFileSync(join(dir, '.env'), 'K=1'); expect(validateAttachment(join(dir, '.env'), home)).toMatchObject({ ok: false })
  })
})

describe('ChatStore', () => {
  const entry = (text: string, extra = {}) => ({ role: 'agent' as const, kind: 'message' as const, text, ...extra })
  it('grava em JSONL por terminal e tópico e lê a cauda e a página anterior', () => {
    const s = new ChatStore(join(dir, 'chats'))
    const ids = Array.from({ length: 5 }, (_, i) => s.append('t1', 'blue', entry(`m${i}`)).id)
    expect(s.tail('t1', 'blue', 2).map(e => e.text)).toEqual(['m3', 'm4'])
    expect(s.before('t1', 'blue', ids[3]!, 2).map(e => e.text)).toEqual(['m1', 'm2'])
    expect(s.tail('t1', 'red', 10)).toEqual([])
    expect(readFileSync(join(dir, 'chats', 't1', 'blue', 'transcript.jsonl'), 'utf8').trim().split('\n')).toHaveLength(5)
    expect(new ChatStore(join(dir, 'chats')).tail('t1', 'blue', 10)).toHaveLength(5)
  })
  it('ignora linha corrompida em vez de perder o histórico', () => {
    const s = new ChatStore(join(dir, 'chats')); s.append('t1', 'blue', entry('bom'))
    writeFileSync(join(dir, 'chats', 't1', 'blue', 'transcript.jsonl'), readFileSync(join(dir, 'chats', 't1', 'blue', 'transcript.jsonl'), 'utf8') + '{lixo\n')
    expect(s.tail('t1', 'blue', 10).map(e => e.text)).toEqual(['bom'])
  })
  it('recusa terminal ou tópico com nome que escapa da pasta', () => {
    const s = new ChatStore(join(dir, 'chats'))
    expect(() => s.append('../x', 'blue', entry('a'))).toThrow(); expect(() => s.append('t1', '../blue' as never, entry('a'))).toThrow()
  })
  it('copia o anexo para a pasta do tópico e devolve só o caminho dentro dela', () => {
    const s = new ChatStore(join(dir, 'chats'))
    const opened=openAttachment(file('src.txt','dados'),home);if(!opened.ok)throw new Error(opened.reason)
    let e:ReturnType<ChatStore['append']>;try{e=s.append('t1','blue',entry('com anexo'),[{name:'../../evil.txt',fd:opened.fd,maxBytes:MAX_ATTACHMENT_BYTES,kind:'file'}])}finally{opened.close()}
    expect(e.attachments).toHaveLength(1)
    const a = e.attachments![0]!
    expect(a.name).toBe('evil.txt'); expect(readFileSync(s.attachmentPath('t1', 'blue', a.id)!, 'utf8')).toBe('dados')
    expect(s.attachmentPath('t1', 'blue', '../../../etc/passwd')).toBeNull()
    expect(s.findAttachment('t1', a.id)?.thread).toBe('blue')
  })
  it('limpa um tópico e apaga uma mensagem', () => {
    const s = new ChatStore(join(dir, 'chats')); const a = s.append('t1', 'blue', entry('a')), b = s.append('t1', 'blue', entry('b')); s.append('t1', 'red', entry('r'))
    s.deleteEntry('t1', 'blue', a.id); expect(s.tail('t1', 'blue', 9).map(e => e.id)).toEqual([b.id])
    s.clearThread('t1', 'blue'); expect(s.tail('t1', 'blue', 9)).toEqual([]); expect(s.tail('t1', 'red', 9)).toHaveLength(1)
    s.clearAll('t1'); expect(existsSync(join(dir, 'chats', 't1'))).toBe(false)
  })
  it('lista os tópicos que têm mensagens e o tópico ativo persiste', () => {
    const s = new ChatStore(join(dir, 'chats')); s.append('t1', 'pink', entry('p')); s.append('t1', 'green', entry('g'))
    expect(s.filledThreads('t1').sort()).toEqual(['green', 'pink']); expect(s.activeThread('t1')).toBe('blue')
    s.setActiveThread('t1', 'green'); expect(new ChatStore(join(dir, 'chats')).activeThread('t1')).toBe('green')
  })
})

describe('ChatService (turnos)', () => {
  const setup = () => {
    const delivered: Array<[string, string]> = [], written: Array<[string, string]> = [], events: string[] = []
    let now = 1000
    const timers: Array<{ at: number; fn(): void }> = []
    const dataListeners: Array<(id: string) => void> = []
    const svc = new ChatService({
      store: new ChatStore(join(dir, 'chats')), home,
      deliver: (id, text) => void delivered.push([id, text]), write: (id, data) => void written.push([id, data]),
      isRunning: id => id !== 'morto', isAgent: id => id !== 'shell',
      onTerminalData: cb => { dataListeners.push(cb); return () => {} },
      now: () => now, setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t }, clearTimer: t => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1) },
      settleMs: 8000
    })
    svc.onChange(e => events.push(`${e.kind}:${e.terminalId}`))
    const advance = (ms: number) => { now += ms; for (const t of [...timers]) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn() } }
    return { svc, delivered, written, events, advance, data: (id: string) => dataListeners.forEach(l => l(id)) }
  }
  it('enviar grava a mensagem do usuário ANTES de entregar e entrega com o cabeçalho', async () => {
    const { svc, delivered } = setup()
    const r = await svc.send('t1', { text: 'faça X', attachments: [] })
    expect(r.accepted).toBe(true)
    expect(svc.state('t1').entries.map(e => [e.role, e.text])).toEqual([['user', 'faça X']])
    expect(delivered[0]![1]).toContain('thread: blue\n---\nfaça X')
    expect(svc.state('t1').status).toBe('working')
  })
  it('recusa texto vazio, terminal parado e terminal que não é agente', async () => {
    const { svc, delivered } = setup()
    expect((await svc.send('t1', { text: '  ', attachments: [] })).accepted).toBe(false)
    expect((await svc.send('morto', { text: 'x', attachments: [] })).accepted).toBe(false)
    expect((await svc.send('shell', { text: 'x', attachments: [] }) as { cause: string }).cause).toBe('shell')
    expect(delivered).toEqual([])
  })
  it('say parcial mantém o turno; o último say fecha e conta como não lida', async () => {
    const { svc } = setup()
    await svc.send('t1', { text: 'x', attachments: [] })
    await svc.say('t1', { text: 'rodando…', progress: true })
    expect(svc.state('t1').status).toBe('working')
    await svc.say('t1', { text: 'pronto' })
    expect(svc.state('t1')).toMatchObject({ status: 'idle', unreadCount: 1 })
    expect(svc.state('t1').entries.map(e => e.kind)).toEqual(['message', 'progress', 'message'])
    svc.markRead('t1'); expect(svc.state('t1').unreadCount).toBe(0)
  })
  it('a resposta vai para o tópico da mensagem, mesmo que o usuário troque de tópico no meio', async () => {
    const { svc } = setup()
    await svc.send('t1', { text: 'x', attachments: [] }); svc.switchThread('t1', 'red')
    await svc.say('t1', { text: 'resposta' })
    expect(svc.state('t1', 'blue').entries.map(e => e.text)).toEqual(['x', 'resposta']); expect(svc.state('t1', 'red').entries).toEqual([])
    expect(svc.state('t1').thread).toBe('red')
  })
  it('say com pergunta guarda as opções; com menos de duas é recusado', async () => {
    const { svc } = setup()
    await svc.say('t1', { question: { prompt: 'Qual?', options: [{ label: 'A', recommended: true }, { label: 'B', detail: 'mais lento' }] } })
    expect(svc.state('t1').entries[0]).toMatchObject({ kind: 'question', question: { prompt: 'Qual?', options: [{ label: 'A', recommended: true }, { label: 'B', detail: 'mais lento' }] } })
    await expect(svc.say('t1', { question: { prompt: 'Só uma?', options: [{ label: 'A' }] } })).rejects.toThrow(/duas/)
    await expect(svc.say('t1', { text: '' })).rejects.toThrow()
  })
  it('say com anexo valida o caminho e o guarda no tópico; caminho ruim recusa o say inteiro', async () => {
    const { svc } = setup()
    await svc.say('t1', { text: 'veja', attach: [file('r.txt', 'dados')] })
    expect(svc.state('t1').entries[0]!.attachments![0]).toMatchObject({ name: 'r.txt', kind: 'file' })
    await expect(svc.say('t1', { text: 'x', attach: ['relativo.txt'] })).rejects.toThrow(/absolut/)
    expect(svc.state('t1').entries).toHaveLength(1)
  })
  it('interromper manda Esc ao terminal e marca o turno como interrompido', async () => {
    const { svc, written } = setup()
    await svc.send('t1', { text: 'x', attachments: [] }); expect(await svc.interrupt('t1')).toBe(true)
    expect(written).toEqual([['t1', '\x1b']]); expect(svc.state('t1').status).toBe('interrupted')
    expect(await svc.interrupt('t1')).toBe(false)
  })
  it('sem say final, o silêncio da saída fecha o turno pedindo atenção; saída nova adia', async () => {
    const { svc, advance, data } = setup()
    await svc.send('t1', { text: 'x', attachments: [] })
    advance(5000); data('t1'); advance(5000); expect(svc.state('t1').status).toBe('working')
    advance(3001); expect(svc.state('t1').status).toBe('needsAttention')
    svc.acknowledgeAttention('t1'); expect(svc.state('t1').status).toBe('idle')
  })
  it('o fim do turno do agente (hook) sem say final pede atenção na hora; com say final não muda nada', async () => {
    const { svc } = setup()
    await svc.send('t1', { text: 'x', attachments: [] }); svc.turnEnded('t1'); expect(svc.state('t1').status).toBe('needsAttention')
    await svc.send('t1', { text: 'y', attachments: [] }); await svc.say('t1', { text: 'ok' }); svc.turnEnded('t1'); expect(svc.state('t1').status).toBe('idle')
  })
  it('say depois do silêncio ainda entrega a resposta e fecha o turno', async () => {
    const { svc, advance } = setup()
    await svc.send('t1', { text: 'x', attachments: [] }); advance(9000)
    await svc.say('t1', { text: 'atrasada' }); expect(svc.state('t1')).toMatchObject({ status: 'idle', unreadCount: 1 })
  })
  it('recall devolve as últimas N voltas do tópico em texto, com os anexos por id', async () => {
    const { svc } = setup()
    await svc.send('t1', { text: 'a', attachments: [] }); await svc.say('t1', { text: 'ra', attach: [file('f.txt', 'z')] })
    await svc.send('t1', { text: 'b', attachments: [] }); await svc.say('t1', { text: 'rb' })
    const last = svc.recall('t1', { thread: 'blue', turns: 1 })
    expect(last).toContain('rb'); expect(last).not.toContain('ra')
    const all = svc.recall('t1', { thread: 'blue', all: true })
    expect(all).toMatch(/user.*a/s); expect(all).toMatch(/attachment [0-9A-F-]+: f\.txt/i)
    expect(svc.recall('t1', { list: true })).toContain('blue')
  })
  it('a prévia do terminal só existe durante o turno', async () => {
    const { svc } = setup()
    expect(svc.preview('t1')).toBe('')
    await svc.send('t1', { text: 'x', attachments: [] }); await svc.say('t1', { text: 'ok' }); expect(svc.preview('t1')).toBe('')
  })
  it('limpar tópico e histórico zeram o que a interface vê', async () => {
    const { svc } = setup()
    await svc.send('t1', { text: 'a', attachments: [] }); svc.clearThread('t1', 'blue'); expect(svc.state('t1').entries).toEqual([]); expect(svc.state('t1').status).toBe('idle')
  })
  it('avisa a interface a cada mudança', async () => {
    const { svc, events } = setup(); await svc.send('t1', { text: 'a', attachments: [] }); await svc.say('t1', { text: 'b' })
    expect(events.length).toBeGreaterThanOrEqual(2); expect(new Set(events)).toContain('changed:t1')
  })
})
