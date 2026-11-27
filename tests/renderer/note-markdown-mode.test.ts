// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileView } from '../../src/renderer/src/nodes/FileView'
import { NoteView } from '../../src/renderer/src/nodes/NoteView'
import { OPTIONS } from '../../src/renderer/src/settings/options'
import { adoptPreferences } from '../../src/renderer/src/settings/preferences'
import { parseNodePatch, parseNewNode } from '../../src/main/validate'
import { invalidNodeExtras } from '../../src/main/domain/node-extras'
import { defaultPreferences } from '../../src/shared/preferences'

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, patch: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); adoptPreferences(defaultPreferences()); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  patch = vi.fn(async () => {}); read = vi.fn(async () => ({ kind: 'text', data: '# Título\n\n| a | b |\n|---|---|\n| 1 | 2 |', truncated: false }))
  Object.assign(window, { palco: { node: { patch }, files: { read }, shell: { openExternal: vi.fn() } } })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async (props: Record<string, unknown>) => { await act(async () => root.render(createElement(NoteView, { id: 'n1', content: '# Olá\n\n**negrito** e `código`', ...props } as never))); await flush() }

it('a opção "Renderizar como" e "Renderizar Markdown" do arquivo estão ativas', () => {
  for (const k of ['defaultNoteRender', 'fileEditorRendersMarkdown']) expect(OPTIONS.find(o => o.key === k)?.ready, k).toBe(true)
})
it('nota formatada mostra o markdown renderizado, sem HTML cru', async () => {
  await mount({ render: 'markdown', content: '# Olá\n\n**negrito** <script>x</script> <img src=x onerror=alert(1)>' })
  expect(host.querySelector('.note-preview h1')?.textContent).toBe('Olá'); expect(host.querySelector('.note-preview strong')?.textContent).toBe('negrito')
  expect(host.querySelector('script')).toBeNull(); expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('textarea')).toBeNull()
})
it('nota em texto bruto (ou sem o campo) continua sendo o campo de texto', async () => {
  await mount({}); expect(host.querySelector('textarea')).toBeTruthy(); expect(host.querySelector('.note-preview')).toBeNull()
  await mount({ render: 'raw' }); expect(host.querySelector('textarea')).toBeTruthy()
})
it('clique abre a edição; sair do campo volta ao formatado; travada não abre', async () => {
  await mount({ render: 'markdown' })
  await act(async () => host.querySelector<HTMLElement>('.note-preview')!.click()); await flush()
  expect(host.querySelector('textarea')).toBeTruthy(); await act(async () => { host.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush()
  expect(host.querySelector('.note-preview')).toBeTruthy()
  await mount({ render: 'markdown', locked: true }); await act(async () => host.querySelector<HTMLElement>('.note-preview')!.click()); await flush(); expect(host.querySelector('textarea')).toBeNull()
})
it('nota vazia pede "Clique para editar…"; o botão alterna Formatado ↔ Texto bruto no nó', async () => {
  await mount({ render: 'markdown', content: '' }); expect(host.textContent).toContain('Clique para editar…')
  await act(async () => host.querySelector<HTMLButtonElement>('.note-render-toggle')!.click()); expect(patch).toHaveBeenCalledWith('n1', { render: 'raw' })
  await mount({ render: 'raw' }); await act(async () => host.querySelector<HTMLButtonElement>('.note-render-toggle')!.click()); expect(patch).toHaveBeenLastCalledWith('n1', { render: 'markdown' })
})
it('o main valida render: só markdown ou raw, só nota', () => {
  expect(parseNodePatch({ render: 'markdown' }, 'note')).toEqual({ render: 'markdown' }); expect(() => parseNodePatch({ render: 'html' }, 'note')).toThrow(); expect(() => parseNodePatch({ render: 'raw' }, 'terminal')).toThrow()
  expect(invalidNodeExtras('note', { render: 'x' })).toEqual(['render']); expect(invalidNodeExtras('note', { render: 'raw' })).toEqual([])
  expect(parseNewNode({ kind: 'note', floorId: null, name: 'N', content: '', render: 'markdown', pos: { x: 0, y: 0 }, size: { w: 100, h: 100 } })).toMatchObject({ render: 'markdown' })
})
it('arquivo .md com a opção ligada vira markdown; desligada ou outra extensão fica texto', async () => {
  await act(async () => root.render(createElement(FileView, { path: '/p/LEIA.md' }))); await flush()
  expect(host.querySelector('.file-markdown h1')?.textContent).toBe('Título'); expect(host.querySelector('.file-markdown table')).toBeTruthy(); expect(host.querySelector('pre.file-text')).toBeNull()
  await act(async () => root.render(createElement(FileView, { path: '/p/a.txt' }))); await flush(); expect(host.querySelector('pre.file-text')).toBeTruthy()
  adoptPreferences({ ...defaultPreferences(), fileEditorRendersMarkdown: false }); await act(async () => root.render(createElement(FileView, { path: '/p/LEIA.md' }))); await flush(); expect(host.querySelector('pre.file-text')).toBeTruthy()
})
