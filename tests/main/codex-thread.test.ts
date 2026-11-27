import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexThread } from '../../src/main/agents/codex-thread'
import { SessionStore } from '../../src/main/system/sessions'
import type { TerminalNode } from '../../src/shared/model'

const MAIN = '00000000-0000-7000-8000-00000000000a'
const SUB = '00000000-0000-7000-8000-00000000000b'

const homes: string[] = []
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** CODEX_HOME temporário com a primeira linha de cada rollout, como o Codex grava. */
function codexHome(metas: Array<Record<string, unknown>>): string {
  const home = mkdtempSync(join(tmpdir(), 'palco-codex-')); homes.push(home)
  const day = join(home, 'sessions', '2026', '11', '27'); mkdirSync(day, { recursive: true })
  for (const meta of metas) {
    const line = JSON.stringify({ type: 'session_meta', payload: { base_instructions: 'x'.repeat(200_000), ...meta } })
    writeFileSync(join(day, `rollout-2026-11-27T08-00-00-${String(meta.id)}.jsonl`), `${line}\n{"type":"event_msg"}\n`)
  }
  return home
}

const main = { id: MAIN, session_id: MAIN, thread_source: 'user', source: 'cli' }
const sub = {
  id: SUB, session_id: MAIN, parent_thread_id: MAIN, thread_source: 'subagent',
  source: { subagent: { thread_spawn: { parent_thread_id: MAIN, depth: 1 } } }
}

describe('threads do Codex', () => {
  it('conversa principal é a própria raiz', () => {
    expect(codexThread(MAIN, codexHome([main]))).toEqual({ subagent: false, root: MAIN })
  })

  it('subagente aponta para a conversa principal', () => {
    expect(codexThread(SUB, codexHome([main, sub]))).toEqual({ subagent: true, root: MAIN })
  })

  it('prefere o rollout encontrado no dia mais novo', () => {
    const home = mkdtempSync(join(tmpdir(), 'palco-codex-datas-')); homes.push(home)
    const sessions = join(home, 'sessions')
    const oldDay = join(sessions, '2026', '11', '26')
    const newDay = join(sessions, '2026', '11', '27')
    mkdirSync(oldDay, { recursive: true }); mkdirSync(newDay, { recursive: true })
    const writeMeta = (dir: string, root: string): void => writeFileSync(join(dir, `rollout-2026-11-27T08-00-00-${SUB}.jsonl`), `${JSON.stringify({ type: 'session_meta', payload: { ...sub, session_id: root } })}\n`)
    writeMeta(oldDay, MAIN)
    const newerRoot = '00000000-0000-7000-8000-00000000000c'
    writeMeta(newDay, newerRoot)
    expect(codexThread(SUB, home)).toEqual({ subagent: true, root: newerRoot })
  })

  it('continua encontrando rollouts diretamente em sessions', () => {
    const home = codexHome([])
    writeFileSync(join(home, 'sessions', `rollout-2026-11-27T08-00-00-${SUB}.jsonl`), `${JSON.stringify({ type: 'session_meta', payload: sub })}\n`)
    expect(codexThread(SUB, home)).toEqual({ subagent: true, root: MAIN })
  })

  it('limita a quantidade de entradas lidas', () => {
    const home = codexHome([sub])
    expect(codexThread(SUB, home, 2)).toEqual({ subagent: false, root: SUB })
  })

  it('sem session_id da raiz, sobe pelos pais', () => {
    const neto = '00000000-0000-7000-8000-00000000000d'
    const home = codexHome([main, { ...sub, session_id: SUB }, { ...sub, id: neto, session_id: neto, parent_thread_id: SUB }])
    expect(codexThread(neto, home)).toEqual({ subagent: true, root: MAIN })
  })

  it('sem arquivo, arquivo ilegível ou id estranho, trata como conversa principal', () => {
    const home = codexHome([])
    expect(codexThread(SUB, home)).toEqual({ subagent: false, root: SUB })
    expect(codexThread(SUB, join(home, 'nao-existe'))).toEqual({ subagent: false, root: SUB })
    expect(codexThread('../x', home)).toEqual({ subagent: false, root: '../x' })
    writeFileSync(join(home, 'sessions', `rollout-x-${SUB}.jsonl`), 'não é json')
    expect(codexThread(SUB, home)).toEqual({ subagent: false, root: SUB })
  })

  it('sessão de subagente já gravada reabre a conversa principal', () => {
    const home = codexHome([main, sub])
    const node = { id: 't', agent: 'codex', command: 'codex', cwd: '/tmp' } as TerminalNode
    const file = join(home, 'palco-sessions.json')
    new SessionStore(file).remember(node, SUB)
    const store = new SessionStore(file, id => codexThread(id, home).root)
    expect(store.forRelaunch(node, true).command).toBe(`codex resume ${MAIN}`)
  })

  it('o Claude não passa pela leitura do Codex', () => {
    const home = codexHome([])
    const node = { id: 't', agent: 'claude', command: 'claude', cwd: '/tmp' } as TerminalNode
    const store = new SessionStore(join(home, 'palco-sessions.json'), () => 'outro')
    store.remember(node, 'sessao-claude')
    expect(store.forRelaunch(node, true).command).toBe('claude --resume sessao-claude')
  })
})
