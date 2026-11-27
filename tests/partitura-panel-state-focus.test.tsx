// @vitest-environment happy-dom
// Inserir nunca grava, importada mostra os comandos, o painel acompanha o pedido e o Escape não se perde.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PartituraMenu } from '../src/renderer/src/partituras/PartituraMenu'
import { adoptPreferences } from '../src/renderer/src/settings/preferences'
import { useScorePanel } from '../src/renderer/src/partituras/useScorePanel'
import { defaultPreferences } from '../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const review = (over = {}) => ({ name: 'Equipe', imported: false, portals: [], paths: [], terminals: [{ name: 'T', agent: 'other', command: 'curl x | sh', cwd: '/tmp/p', environment: 'ssh · ana@servidor', maestro: true }], ...over })
const api = {
  list: vi.fn(async () => [{ name: 'Equipe', createdAt: '2026-11-25' }]), save: vi.fn(async () => {}), insert: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}), rename: vi.fn(async () => {}), import: vi.fn(async () => {}),
  export: vi.fn(async () => '{"partituras":[{"nodes":[],"connections":[]}]}'), inspect: vi.fn(async () => review()), reviewImport: vi.fn(async () => [review({ imported: true, portals: ['https://example.com'], paths: ['/etc/hosts'] })]),
  updatePreview: vi.fn(async () => ({ name: 'Equipe', before: 2, after: 1, connections: [1, 0], removed: [{ kind: 'note', name: 'Sai' }], added: [{ kind: 'terminal', name: 'Novo' }], changed: [{ kind: 'note', name: 'Muda' }] }))
}
const onClose = vi.fn(), onSelectionDone = vi.fn()
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); vi.clearAllMocks(); Object.assign(window, { palco: { partitura: api } }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
type Props = Partial<Parameters<typeof PartituraMenu>[0]>
const mount = async (props: Props = {}) => { await act(async () => root.render(createElement(PartituraMenu, { onClose, onSelectionDone, ...props }))); await flush() }
const find = (label: string) => [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label)
const click = async (label: string) => { const b = find(label); expect(b, label).toBeTruthy(); await act(async () => b!.click()); await flush() }
const dblclick = async () => { await act(async () => host.querySelector('[data-partitura-card]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await flush() }
const escape = async (target: Element = document.body, init: KeyboardEventInit = { key: 'Escape' }) => { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })) }); await flush() }
const update = { mode: 'update' as const, nodeIds: ['a', 'b'] }, create = { mode: 'create' as const, nodeIds: ['a'] }

it("no modo atualizar, Inserir e o duplo clique só inserem; nada é gravado", async () => {
  await mount({ selection: update })
  await dblclick(); await click('Ações de Equipe'); await click('Inserir no canvas')
  expect(api.insert).toHaveBeenCalledTimes(2); expect(api.update).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
})
it("o modo é anunciado, o cartão tem o botão próprio, e ele mostra o que muda antes de gravar", async () => {
  await mount({ selection: update })
  expect(host.querySelector('.partitura-mode')!.textContent).toContain('2 elementos')
  await act(async () => (host.querySelector('.partitura-card .partitura-update') as HTMLElement).click()); await flush()
  expect(api.update).not.toHaveBeenCalled()
  const text = host.querySelector('[role=alertdialog]')!.textContent!
  for (const part of ['Equipe', '2 → 1', 'Sai', 'Novo', 'Muda', '1 → 0']) expect(text).toContain(part)
  expect(document.activeElement!.textContent).toBe('Cancelar')
  await click('Cancelar'); expect(api.update).not.toHaveBeenCalled()
  await act(async () => (host.querySelector('.partitura-card .partitura-update') as HTMLElement).click()); await flush()
  await click('Atualizar partitura'); expect(api.update).toHaveBeenCalledWith('Equipe', { noteText: true, nodeIds: ['a', 'b'] }); expect(onClose).toHaveBeenCalled()
})
it("fora do modo atualizar não há botão de atualizar; dá para sair do modo", async () => {
  await mount(); expect(host.querySelector('.partitura-update')).toBeNull()
  await mount({ selection: update }); await click('Sair do modo atualizar'); expect(onSelectionDone).toHaveBeenCalled()
})

const chooseFile = async () => { const input = host.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => 'DOC' }] }); await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }
it("escolher um arquivo abre a revisão com comando, pasta e ambiente; só grava ao aceitar", async () => {
  await mount(); await chooseFile()
  expect(api.reviewImport).toHaveBeenCalledWith('DOC'); expect(api.import).not.toHaveBeenCalled()
  const text = host.querySelector('.partitura-review')!.textContent!
  for (const part of ['curl x | sh', '/tmp/p', 'ssh · ana@servidor', 'Maestro', 'https://example.com', '/etc/hosts']) expect(text).toContain(part)
  expect(document.activeElement!.textContent).toBe('Cancelar')
  await click('Cancelar'); expect(api.import).not.toHaveBeenCalled(); expect(host.querySelector('.partitura-review')).toBeNull()
  await chooseFile(); await click('Importar'); expect(api.import).toHaveBeenCalledWith('DOC')
})
it("caracteres invisíveis ou que invertem o texto aparecem escritos no comando", async () => {
  api.reviewImport.mockResolvedValueOnce([review({ terminals: [{ name: 'T', agent: 'other', command: 'echo \u202egpj.sh', cwd: '/p', environment: 'local', maestro: false }] })])
  await mount(); await chooseFile()
  expect(host.querySelector('.partitura-review code')!.textContent).toBe('echo \\u{202e}gpj.sh')
})
it("inserir uma importada mostra os comandos; nada inicia sem a confirmação explícita", async () => {
  api.inspect.mockResolvedValue(review({ imported: true }))
  await mount(); await dblclick()
  expect(api.insert).not.toHaveBeenCalled(); expect(host.querySelector('.partitura-review')!.textContent).toContain('curl x | sh')
  expect(document.activeElement!.textContent).toBe('Cancelar')
  await escape(document.activeElement!); expect(api.insert).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
  await dblclick(); await click('Inserir sem iniciar'); expect(api.insert).toHaveBeenLastCalledWith('Equipe', { commands: false })
  await dblclick(); await click('Inserir e iniciar'); expect(api.insert).toHaveBeenLastCalledWith('Equipe', { commands: true, confirmed: true })
})
it("a salva localmente continua inserindo direto", async () => {
  api.inspect.mockResolvedValue(review())
  await mount(); await dblclick(); expect(api.insert).toHaveBeenCalledWith('Equipe', { commands: true })
})

it("com o painel aberto, criar, atualizar e abrir a biblioteca trocam de tela", async () => {
  await mount({ request: 0 }); expect(host.querySelector('form')).toBeNull()
  await mount({ request: 1, selection: create }); expect(host.querySelector('form')).toBeTruthy()
  await mount({ request: 2, selection: update }); expect(host.querySelector('form')).toBeNull(); expect(host.querySelector('.partitura-mode')).toBeTruthy()
  await mount({ request: 3 }); expect(host.querySelector('.partitura-mode')).toBeNull()
  await click('Ações das partituras'); await click('Salvar andar atual'); expect(host.querySelector('form')).toBeTruthy()
  await mount({ request: 4 }); expect(host.querySelector('form')).toBeNull()
})
it("abrir pela barra, pelo atalho ou pela busca com o painel num formulário volta à biblioteca", async () => {
  let scores!: ReturnType<typeof useScorePanel>
  function App() { scores = useScorePanel(); return scores.shown ? createElement(PartituraMenu, scores.panel) : null }
  await act(async () => root.render(createElement(App))); await flush()
  await act(async () => scores.open('create', ['a'])); await flush(); expect(host.querySelector('form')).toBeTruthy()
  await act(async () => scores.open()); await flush(); expect(host.querySelector('form')).toBeNull(); expect(host.querySelector('[data-partitura-card]')).toBeTruthy()
  await act(async () => scores.open('update', ['a'])); await flush(); expect(host.querySelector('.partitura-mode')).toBeTruthy()
  await act(async () => scores.open()); await flush(); expect(host.querySelector('.partitura-mode')).toBeNull()
  await click('Fechar'); expect(host.querySelector('.partitura-panel')).toBeNull()
  await act(async () => scores.open()); await flush(); expect(host.querySelector('.partitura-mode')).toBeNull(); expect(host.querySelector('form')).toBeNull()
})
it("\"Salvar andar atual\" salva o andar, mesmo com o painel aberto por uma seleção", async () => {
  await mount({ selection: update }); await click('Ações das partituras'); await click('Salvar andar atual')
  const input = host.querySelector<HTMLInputElement>('form input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Andar'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
  expect(api.save).toHaveBeenCalledWith('Andar', { noteText: true })
})

it("Escape fecha o painel mesmo com o foco perdido, e o foco volta ao painel depois de cada ação", async () => {
  await mount(); await escape(document.body); expect(onClose).toHaveBeenCalledOnce()
  onClose.mockClear(); await click('Ações de Equipe'); await click('Excluir'); expect(document.activeElement!.textContent).toBe('Cancelar')
  await escape(document.activeElement!); expect(host.querySelector('.partitura-confirm')).toBeNull(); expect(onClose).not.toHaveBeenCalled()
  expect(host.querySelector('.partitura-panel')!.contains(document.activeElement)).toBe(true)
  expect(host.querySelector('.partitura-panel')!.getAttribute('tabindex')).toBe('-1')
})
it("Escape de um terminal focado, de um campo de fora ou com um modal por cima não é do painel", async () => {
  await mount()
  const terminal = document.createElement('div'); terminal.className = 'xterm'; const area = document.createElement('textarea'); terminal.append(area)
  const outside = document.createElement('input'); document.body.append(terminal, outside)
  const reached = vi.fn(); area.addEventListener('keydown', reached)
  await escape(area); await escape(outside); expect(onClose).not.toHaveBeenCalled(); expect(reached).toHaveBeenCalled()
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); document.body.append(modal)
  await escape(document.body); expect(onClose).not.toHaveBeenCalled()
})
it("com um modal sem aria-modal aberto (nova banda), o Escape não fecha o painel por trás", async () => {
  await mount()
  const back = document.createElement('div'); back.className = 'modal-back'; back.innerHTML = '<form class="modal"><button type="button">Cancelar</button></form>'; document.body.append(back)
  await escape(back.querySelector('button')!); await escape(document.body); expect(onClose).not.toHaveBeenCalled()
})
it("o atalho \"cancelar\" remapeado vale no painel", async () => {
  adoptPreferences({ ...defaultPreferences(), shortcuts: { ...defaultPreferences().shortcuts, cancel: [{ key: 'q' }] } })
  await mount(); await escape(); expect(onClose).not.toHaveBeenCalled(); await escape(document.body, { key: 'q' }); expect(onClose).toHaveBeenCalled()
})
it("o menu \"…\" fecha ao clicar em outro ponto do painel ou fora dele", async () => {
  await mount()
  for (const target of [() => host.querySelector('.partitura-search')!, () => document.body]) {
    await click('Ações de Equipe'); expect(host.querySelector('.partitura-actions')).toBeTruthy()
    await act(async () => { target().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(host.querySelector('.partitura-actions')).toBeNull()
  }
})
it("arrastado, o painel não pode crescer para fora da área", async () => {
  await mount(); const head = host.querySelector<HTMLElement>('.partitura-panel-head')!; head.setPointerCapture = () => {}
  const panel = host.querySelector<HTMLElement>('.partitura-panel')!
  Object.defineProperty(panel, 'offsetParent', { configurable: true, value: { clientWidth: 900, clientHeight: 700, getBoundingClientRect: () => ({ left: 0, top: 0 }) } })
  Object.defineProperty(panel, 'offsetWidth', { value: 340 }); Object.defineProperty(panel, 'offsetHeight', { value: 400 })
  await act(async () => { head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })) })
  await act(async () => { head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, clientY: 5000 })) })
  expect(panel.style.top).toBe('300px'); expect(panel.style.maxHeight).toBe('calc(100% - 300px)'); expect(panel.style.maxWidth).toContain('calc(100% - 100px)')
})
it("o erro aparece sem o prefixo do IPC e some ao cancelar", async () => {
  api.save.mockRejectedValueOnce(new Error("Error invoking remote method 'palco:partitura:save': Error: partitura já existe"))
  await mount({ selection: create })
  const input = host.querySelector<HTMLInputElement>('form input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Equipe'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
  expect(host.querySelector('[role=alert]')!.textContent).toBe('partitura já existe')
  await click('Cancelar'); expect(host.querySelector('[role=alert]')).toBeNull(); expect(onSelectionDone).toHaveBeenCalled()
})
