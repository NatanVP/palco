// @vitest-environment happy-dom
// a revisão de uma partitura importada mostra com qual usuário os terminais de Docker e Sandbox rodam.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reviewPartitura } from '../src/main/partituras/partitura-store'
import { PartituraReviewList } from '../src/renderer/src/partituras/PartituraReviewList'
import type { Environment } from '../src/shared/environment'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const terminal = (name: string, environment?: Environment) => ({ kind: 'terminal', name, agent: 'shell', command: '', cwd: '/w', pos: { x: 0, y: 0 }, size: { w: 400, h: 300 }, ...(environment ? { environment } : {}) })
const review = (...nodes: object[]) => reviewPartitura({ name: 'Fora', version: 1, nodes, connections: [] } as never)

/** Rótulo → valor das linhas do terminal na posição dada. */
async function rows(index: number, ...nodes: object[]): Promise<Record<string, string>> {
  await act(async () => root.render(<PartituraReviewList items={[review(...nodes)]} />))
  const list = host.querySelectorAll('dl')[index]!
  return Object.fromEntries([...list.querySelectorAll('dd')].map((dd) => [dd.querySelector('span')!.textContent!, dd.textContent!.slice(dd.querySelector('span')!.textContent!.length)]))
}

it.each<[Environment, string]>([
  [{ kind: 'docker', context: '', container: 'banco', user: 'root' }, 'root'],
  [{ kind: 'sandbox', name: 'caixa', user: '1000:1000' }, '1000:1000']
])('mostra o usuário do ambiente %o', async (environment, user) => {
  const found = await rows(0, terminal('T', environment))
  expect(found['Usuário']).toBe(user)
})

it('sem usuário informado, diz que vale o padrão do ambiente', async () => {
  expect((await rows(0, terminal('D', { kind: 'docker', context: '', container: 'banco', user: '' })))['Usuário']).toBe('padrão do ambiente')
  expect((await rows(0, terminal('S', { kind: 'sandbox', name: 'caixa', user: '' })))['Usuário']).toBe('padrão do ambiente')
})

it('local, tmux e SSH não ganham a linha (no SSH o usuário já aparece junto do servidor)', async () => {
  const nodes = [terminal('L'), terminal('T', { kind: 'tmux' }), terminal('R', { kind: 'ssh', host: 'servidor', user: 'ana', port: 22 })]
  for (let i = 0; i < nodes.length; i++) expect(Object.keys(await rows(i, ...nodes))).not.toContain('Usuário')
  expect((await rows(2, ...nodes))['Ambiente']).toBe('ssh · ana@servidor')
})
