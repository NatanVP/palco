// @vitest-environment happy-dom
import { injectable, pageClick, pageFill, pageSnapshot, pageText } from '../../src/main/portal/page-scripts'

beforeEach(() => { document.body.innerHTML = ''; document.head.innerHTML = '' })
it('snapshots visible controls in DOM order with accessible names, refs and values', () => {
  document.body.innerHTML = `<form><label for="q">Busca</label><input id="q" value="palco"><button>Enviar</button><a href="/next">Próxima</a><select aria-label="Cor"><option>Azul</option></select><textarea aria-label="Nota">Texto</textarea><div role="button" aria-label="Abrir">+</div></form>`
  const snapshot = pageSnapshot(document, 2000)
  expect(snapshot).toContain('@e1 input type=text "Busca" value="palco" [')
  expect(snapshot).toContain('@e2 button "Enviar"')
  expect(snapshot).toContain('@e3 a "Próxima" href=')
  expect(snapshot).toContain('@e4 select "Cor" value="Azul" [')
  expect(snapshot).toContain('@e5 textarea "Nota" value="Texto" [')
  expect(snapshot).toContain('@e6 div role=button "Abrir" [')
  expect(snapshot).toContain('---')
  expect(document.querySelector('#q')!.getAttribute('data-palco-ref')).toBe('e1')
})
it('excludes hidden controls/text, scripts and styles, including hidden ancestors', () => {
  document.body.innerHTML = `<div hidden><button>Hidden ancestor</button></div><button style="display:none">None</button><button style="visibility:hidden">Invisible</button><div style="opacity:0"><a href="/">Transparent</a></div><button aria-hidden="true">Aria hidden</button><input type="hidden" value="private"><script>script text</script><style>.hidden { color: red }</style><p>Visible text</p><button>Visible button</button>`
  const snapshot = pageSnapshot(document, 2000)
  expect(snapshot).toContain('@e1 button "Visible button"')
  expect(snapshot).not.toMatch(/Hidden ancestor|None|Invisible|Transparent|Aria hidden|private|script text|color: red/)
  expect(pageText(document, 2000)).toBe('Visible text Visible button')
})
it('uses aria-labelledby before fallback label text and escapes line-breaking names', () => {
  document.body.innerHTML = `<span id="a">Nome</span><span id="b">completo</span><input aria-labelledby="a b" aria-label="fallback"><label>Outro<input id="wrapped"></label><button aria-label='Say &quot;hello&quot;&#10;now'></button>`
  const snapshot = pageSnapshot(document, 2000)
  expect(snapshot).toContain('@e1 input type=text "Nome completo"')
  expect(snapshot).toContain('@e2 input type=text "Outro"')
  expect(snapshot).toContain('@e3 button "Say \\"hello\\" now"')
})
it('clicks refs and CSS selectors after scrolling to the target', () => {
  document.body.innerHTML = '<a href="#">Link</a><button id="send">Enviar</button>'
  pageSnapshot(document, 1000)
  const button = document.querySelector<HTMLButtonElement>('#send')!
  const click = vi.fn(), scroll = vi.fn()
  button.addEventListener('click', click)
  button.scrollIntoView = scroll
  expect(pageClick(document, 'e2')).toBe('ok')
  expect(click).toHaveBeenCalledTimes(1)
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(pageClick(document, '#send')).toBe('ok')
  expect(click).toHaveBeenCalledTimes(2)
})
it('uses the native input setter and bubbles input/change after the value changes', () => {
  document.body.innerHTML = '<form><input id="name" value="old"></form>'
  pageSnapshot(document, 1000)
  const input = document.querySelector<HTMLInputElement>('#name')!
  const ownSetter = vi.fn(), events: string[] = []
  Object.defineProperty(input, 'value', { configurable: true, get() { return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(this) }, set: ownSetter })
  document.querySelector('form')!.addEventListener('input', () => events.push('input:' + input.value))
  document.querySelector('form')!.addEventListener('change', () => events.push('change:' + input.value))
  expect(pageFill(document, 'e1', 'new')).toBe('ok')
  expect(input.value).toBe('new')
  expect(ownSetter).not.toHaveBeenCalled()
  expect(events).toEqual(['input:new', 'change:new'])
})
it('fills textarea and select using their native setters', () => {
  document.body.innerHTML = '<textarea id="t"></textarea><select id="s"><option value="a">A</option><option value="b">B</option></select>'
  pageFill(document, '#t', 'multi\nline'); pageFill(document, '#s', 'b')
  expect(document.querySelector<HTMLTextAreaElement>('#t')!.value).toBe('multi\nline')
  expect(document.querySelector<HTMLSelectElement>('#s')!.value).toBe('b')
})
it.each(['e999', '#absent', '['])('normalizes missing or invalid targets to a clear error: %s', target => {
  expect(() => pageClick(document, target)).toThrow('elemento não encontrado: ' + target)
  expect(() => pageFill(document, target, 'x')).toThrow('elemento não encontrado: ' + target)
})
it('clears stale refs and renumbers only controls that remain visible', () => {
  document.body.innerHTML = '<button id="one">One</button><button id="two">Two</button>'
  pageSnapshot(document, 1000)
  document.querySelector<HTMLButtonElement>('#one')!.hidden = true
  pageSnapshot(document, 1000)
  expect(document.querySelector('#one')!.hasAttribute('data-palco-ref')).toBe(false)
  expect(document.querySelector('#two')!.getAttribute('data-palco-ref')).toBe('e1')
  expect(() => pageClick(document, 'e2')).toThrow('elemento não encontrado: e2')
})
it('bounds text and the entire snapshot by the supplied character limit', () => {
  document.body.innerHTML = '<p>1234567890</p><button>abcdefghij</button>'
  expect(pageText(document, 5)).toBe('12345')
  expect(pageSnapshot(document, 12)).toHaveLength(12)
  expect(pageText(document, 0)).toBe('')
})
it('executes all four serialized functions in a fresh lexical scope, safely passing strings as JSON', () => {
  document.body.innerHTML = '<p>Visible</p><textarea id="x"></textarea><button id="b">Send</button>'
  const run = (fn: Function, ...args: unknown[]): unknown => new Function('document', 'return ' + injectable(fn, ...args))(document)
  expect(eval(injectable(pageText, 7))).toBe('Visible')
  expect(run(pageText, 7)).toBe('Visible')
  expect(run(pageSnapshot, 1000)).toContain('@e1 textarea')
  const value = '";globalThis.bad = true;//\nline\\'
  expect(run(pageFill, 'e1', value)).toBe('ok')
  expect(document.querySelector<HTMLInputElement>('#x')!.value).toBe(value)
  const clicked = vi.fn()
  document.querySelector('#b')!.addEventListener('click', clicked)
  expect(run(pageClick, 'e2')).toBe('ok')
  expect(clicked).toHaveBeenCalledTimes(1)
  expect(Reflect.get(globalThis, 'bad')).toBeUndefined()
})
it('reports an input submit as a button using its value as accessible name', () => {
  document.body.innerHTML = '<input type="submit" value="Save">'
  expect(pageSnapshot(document, 1000)).toContain('@e1 input type=submit "Save"')
})
it('omits hidden descendants when deriving a button name', () => {
  document.body.innerHTML = '<button><span hidden>Hidden</span>Visible</button>'
  expect(pageSnapshot(document, 1000)).toContain('@e1 button "Visible"')
})
it('keeps password refs and names without serializing their synthetic test values', () => {
  document.body.innerHTML = '<label for="pw">Password</label><input type="password" id="pw">'
  document.querySelector<HTMLInputElement>('#pw')!.value = 'synthetic-test-password-not-a-real-secret'
  const snapshot = pageSnapshot(document, 1000)
  expect(snapshot).toContain('@e1 input type=password "Password"')
  expect(snapshot).not.toContain('synthetic-test-password-not-a-real-secret')
  expect(snapshot).not.toContain('value=')
})
it('shows only the first summary of closed details, then exposes contents when opened', () => {
  document.body.innerHTML = '<details><summary>Public summary <button>Summary action</button></summary><p>Collapsed text <button id="inside">Hidden action</button></p><summary>Second summary</summary></details>'
  const closed = pageSnapshot(document, 1000)
  expect(closed).toContain('@e1 button "Summary action"')
  expect(closed).not.toMatch(/Collapsed text|Hidden action|Second summary/)
  expect(document.querySelector('#inside')!.hasAttribute('data-palco-ref')).toBe(false)
  expect(pageText(document, 1000)).toBe('Public summary Summary action')
  document.querySelector<HTMLDetailsElement>('details')!.open = true
  const opened = pageSnapshot(document, 1000)
  expect(opened).toContain('@e2 button "Hidden action"')
  expect(pageText(document, 1000)).toContain('Collapsed text Hidden action Second summary')
})
it('does not expose text from closed details even without taking a snapshot first', () => {
  document.body.innerHTML = '<details><summary>Summary</summary><p>Collapsed text</p></details>'
  expect(pageText(document, 1000)).toBe('Summary')
})
it('formato da skill palco-portal: cabeçalho viewport/url/title e [x,y LxA] por ref, com *focused*', () => {
  document.title = 'Example'
  document.body.innerHTML = '<a href="https://example.com/login">Sign In</a><input type="text" aria-label="Search">'
  document.querySelector<HTMLInputElement>('input')!.focus()
  const lines = pageSnapshot(document, 5000).split('\n')
  expect(lines[0]).toMatch(/^viewport: \d+x\d+  url: \S+  title: Example$/)
  expect(lines[1]).toMatch(/^@e1 a "Sign In" href=https:\/\/example\.com\/login \[-?\d+,-?\d+ \d+x\d+\]$/)
  expect(lines[2]).toMatch(/^@e2 input type=text "Search" value="" \[-?\d+,-?\d+ \d+x\d+\] \*focused\*$/)
})
