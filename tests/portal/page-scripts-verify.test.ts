// @vitest-environment happy-dom
import { pageClick, pageFill, pageSnapshot, pageText } from '../../src/main/portal/page-scripts'

beforeEach(() => { document.body.innerHTML = ''; document.head.innerHTML = '' })

const box = (width = 100, height = 40): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) })

describe('fill verifica o resultado', () => {
  it.each([['true', true], ['on', true], ['TRUE', true], ['false', false], ['off', false]])('checkbox com %s', (value, expected) => {
    document.body.innerHTML = '<input type="checkbox" id="c">'
    document.querySelector<HTMLInputElement>('#c')!.checked = !expected
    expect(pageFill(document, '#c', value)).toBe('ok')
    expect(document.querySelector<HTMLInputElement>('#c')!.checked).toBe(expected)
  })

  it('checkbox: valor que não é booleano é recusado e o estado não muda', () => {
    document.body.innerHTML = '<input type="checkbox" id="c" checked>'
    expect(() => pageFill(document, '#c', 'talvez')).toThrow(/true, false, on ou off/)
    expect(document.querySelector<HTMLInputElement>('#c')!.checked).toBe(true)
  })

  it('radio: marca com true; desmarcar um radio é recusado', () => {
    document.body.innerHTML = '<input type="radio" name="g" id="a"><input type="radio" name="g" id="b">'
    expect(pageFill(document, '#b', 'on')).toBe('ok')
    expect(document.querySelector<HTMLInputElement>('#b')!.checked).toBe(true)
    expect(() => pageFill(document, '#b', 'false')).toThrow(/radio/)
    expect(document.querySelector<HTMLInputElement>('#b')!.checked).toBe(true)
  })

  it('checkbox dispara input e change uma vez cada quando o estado muda', () => {
    document.body.innerHTML = '<input type="checkbox" id="c">'
    const seen: string[] = []
    for (const type of ['input', 'change']) document.querySelector('#c')!.addEventListener(type, () => seen.push(type))
    pageFill(document, '#c', 'true')
    expect(seen).toEqual(['input', 'change'])
  })

  it('select: por value, depois pelo texto da opção; sem correspondência é erro e a seleção fica', () => {
    document.body.innerHTML = '<select id="s"><option value="a">Alfa</option><option value="b">Beta</option><option value="c">Gama</option></select>'
    const select = document.querySelector<HTMLSelectElement>('#s')!
    expect(pageFill(document, '#s', 'b')).toBe('ok')
    expect(select.value).toBe('b')
    expect(pageFill(document, '#s', 'Gama')).toBe('ok')
    expect(select.value).toBe('c')
    expect(pageFill(document, '#s', '  Alfa ')).toBe('ok')
    expect(select.value).toBe('a')
    expect(() => pageFill(document, '#s', 'Delta')).toThrow('opção não encontrada: Delta (opções: Alfa, Beta, Gama)')
    expect(select.value).toBe('a')
  })

  it('select: o value tem prioridade sobre um texto igual de outra opção', () => {
    document.body.innerHTML = '<select id="s"><option value="x">b</option><option value="b">outra</option></select>'
    pageFill(document, '#s', 'b')
    expect(document.querySelector<HTMLSelectElement>('#s')!.value).toBe('b')
  })

  it('input file é recusado com mensagem clara', () => {
    document.body.innerHTML = '<input type="file" id="f">'
    expect(() => pageFill(document, '#f', 'C:/x.txt')).toThrow('campo de arquivo não pode ser preenchido')
  })

  it('contenteditable: preenche o texto e dispara input', () => {
    document.body.innerHTML = '<div id="ce" contenteditable="true">velho</div>'
    const seen: string[] = []
    document.querySelector('#ce')!.addEventListener('input', () => seen.push(document.querySelector('#ce')!.textContent ?? ''))
    expect(pageFill(document, '#ce', 'novo texto')).toBe('ok')
    expect(document.querySelector('#ce')!.textContent).toBe('novo texto')
    expect(seen).toEqual(['novo texto'])
  })

  it('um div comum continua não sendo campo', () => {
    document.body.innerHTML = '<div id="d">x</div>'
    expect(() => pageFill(document, '#d', 'y')).toThrow('elemento não é campo: #d')
  })

  it('valor que o campo recusa (ex.: input number) vira erro, não "ok"', () => {
    document.body.innerHTML = '<input type="number" id="n">'
    expect(() => pageFill(document, '#n', 'abc')).toThrow(/recusou/)
    expect(pageFill(document, '#n', '42')).toBe('ok')
    expect(document.querySelector<HTMLInputElement>('#n')!.value).toBe('42')
  })

  it('campo desabilitado ou somente leitura é erro', () => {
    document.body.innerHTML = '<input id="d" disabled><input id="r" readonly><fieldset disabled><input id="f"></fieldset>'
    expect(() => pageFill(document, '#d', 'x')).toThrow('elemento desabilitado')
    expect(() => pageFill(document, '#f', 'x')).toThrow('elemento desabilitado')
    expect(() => pageFill(document, '#r', 'x')).toThrow('elemento somente leitura')
  })

  it('foco antes e blur depois, com input e change no meio', () => {
    document.body.innerHTML = '<input id="i">'
    const seen: string[] = []
    for (const type of ['focus', 'input', 'change', 'blur']) document.querySelector('#i')!.addEventListener(type, () => seen.push(type))
    pageFill(document, '#i', 'x')
    expect(seen).toEqual(['focus', 'input', 'change', 'blur'])
  })
})

describe('click verifica antes de clicar', () => {
  it('botão desabilitado (inclusive por fieldset ou aria-disabled) é erro e não clica', () => {
    document.body.innerHTML = '<button id="a" disabled>A</button><fieldset disabled><button id="b">B</button></fieldset><div role="button" aria-disabled="true" id="c">C</div>'
    const clicked = vi.fn()
    for (const id of ['a', 'b', 'c']) document.querySelector('#' + id)!.addEventListener('click', clicked)
    for (const id of ['#a', '#b', '#c']) expect(() => pageClick(document, id)).toThrow('elemento desabilitado')
    expect(clicked).not.toHaveBeenCalled()
  })

  it('elemento coberto por outro: erro com a descrição de quem cobre, sem clicar', () => {
    document.body.innerHTML = '<button id="b">Alvo</button><div id="ov" class="modal">cobre</div>'
    const button = document.querySelector<HTMLButtonElement>('#b')!
    const overlay = document.querySelector<HTMLElement>('#ov')!
    button.getBoundingClientRect = () => box()
    document.elementFromPoint = () => overlay
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    expect(() => pageClick(document, '#b')).toThrow(/coberto por <div#ov\.modal>/)
    expect(clicked).not.toHaveBeenCalled()
  })

  it('o ponto central cai no próprio elemento ou num descendente: clica', () => {
    document.body.innerHTML = '<button id="b"><span id="s">texto</span></button>'
    const button = document.querySelector<HTMLButtonElement>('#b')!
    button.getBoundingClientRect = () => box()
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    document.elementFromPoint = () => button
    expect(pageClick(document, '#b')).toBe('ok')
    document.elementFromPoint = () => document.querySelector('#s')
    expect(pageClick(document, '#b')).toBe('ok')
    expect(clicked).toHaveBeenCalledTimes(2)
  })

  it('fora da janela (elementFromPoint devolve null) ou sem caixa de layout: não bloqueia', () => {
    document.body.innerHTML = '<button id="b">x</button>'
    const button = document.querySelector<HTMLButtonElement>('#b')!
    button.getBoundingClientRect = () => box()
    document.elementFromPoint = () => null
    expect(pageClick(document, '#b')).toBe('ok')
    button.getBoundingClientRect = () => box(0, 0)
    document.elementFromPoint = () => document.body
    expect(pageClick(document, '#b')).toBe('ok')
  })
})

describe('snapshot desce em shadow DOM e iframes', () => {
  it('shadow root aberto: controles e texto aparecem, e ref funciona em click e fill', () => {
    document.body.innerHTML = '<button id="fora">Fora</button><div id="host"></div>'
    const root = document.querySelector('#host')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<p>texto no shadow</p><button id="dentro">Dentro</button><input id="campo" aria-label="Nome">'
    const snapshot = pageSnapshot(document, 5000)
    expect(snapshot).toContain('@e1 button "Fora"')
    expect(snapshot).toContain('@e2 button "Dentro"')
    expect(snapshot).toContain('@e3 input type=text "Nome"')
    expect(snapshot).toContain('texto no shadow')
    expect(pageText(document, 5000)).toContain('texto no shadow')
    const clicked = vi.fn()
    root.querySelector('#dentro')!.addEventListener('click', clicked)
    expect(pageClick(document, 'e2')).toBe('ok')
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(pageFill(document, 'e3', 'Ana')).toBe('ok')
    expect(root.querySelector<HTMLInputElement>('#campo')!.value).toBe('Ana')
    // seletor CSS também alcança dentro do shadow
    expect(pageClick(document, '#dentro')).toBe('ok')
    expect(clicked).toHaveBeenCalledTimes(2)
  })

  it('host escondido esconde o conteúdo do shadow; shadow fechado não é lido', () => {
    document.body.innerHTML = '<div id="h1" hidden></div><div id="h2"></div>'
    document.querySelector('#h1')!.attachShadow({ mode: 'open' }).innerHTML = '<button>Escondido</button>'
    document.querySelector('#h2')!.attachShadow({ mode: 'closed' }).innerHTML = '<button>Fechado</button>'
    const snapshot = pageSnapshot(document, 5000)
    expect(snapshot).not.toMatch(/Escondido|Fechado/)
  })

  it('iframe same-origin: desce, numeração continua e a ref funciona', () => {
    document.body.innerHTML = '<button id="topo">Topo</button><iframe id="fr"></iframe>'
    const inner = new DOMParser().parseFromString('<body><p>dentro do frame</p><button id="b">No frame</button></body>', 'text/html')
    Object.defineProperty(document.querySelector('#fr')!, 'contentDocument', { configurable: true, get: () => inner })
    const snapshot = pageSnapshot(document, 5000)
    expect(snapshot).toContain('@e1 button "Topo"')
    expect(snapshot).toContain('@e2 button "No frame"')
    expect(snapshot).toContain('dentro do frame')
    const clicked = vi.fn()
    inner.querySelector('#b')!.addEventListener('click', clicked)
    expect(pageClick(document, 'e2')).toBe('ok')
    expect(clicked).toHaveBeenCalledTimes(1)
    expect(pageText(document, 5000)).toContain('dentro do frame')
  })

  it('iframe sem acesso (outro origin) vira uma linha informativa, sem ref', () => {
    document.body.innerHTML = '<iframe src="https://outro.example/pagamento"></iframe><button>Ok</button>'
    const snapshot = pageSnapshot(document, 5000)
    expect(snapshot).toContain('[iframe] https://outro.example/pagamento (não acessível)')
    expect(snapshot).toContain('@e1 button "Ok"')
    expect(snapshot.indexOf('[iframe]')).toBeLessThan(snapshot.indexOf('@e1'))
  })

  it('iframe escondido não é listado', () => {
    document.body.innerHTML = '<iframe src="https://x.example/" hidden></iframe><button>Ok</button>'
    expect(pageSnapshot(document, 5000)).not.toContain('[iframe]')
  })
})

describe('visibilidade linear', () => {
  it('getComputedStyle é chamado no máximo uma vez por elemento, mesmo em árvores fundas', () => {
    const depth = 300
    let html = ''
    for (let i = 0; i < depth; i++) html += '<div>'
    html += '<button>fundo</button>'
    for (let i = 0; i < 300; i++) html += `<span>t${i}</span>`
    html += '</div>'.repeat(depth)
    document.body.innerHTML = html
    const original = window.getComputedStyle.bind(window)
    let calls = 0
    window.getComputedStyle = ((el: Element) => { calls++; return original(el) }) as typeof window.getComputedStyle
    const elements = document.body.querySelectorAll('*').length
    pageSnapshot(document, 1e9)
    const forSnapshot = calls
    calls = 0
    pageText(document, 1e9)
    window.getComputedStyle = original
    // O algoritmo antigo fazia ~ (nós de texto × profundidade) chamadas (≈ 90 mil aqui).
    expect(forSnapshot).toBeLessThanOrEqual(elements * 2)
    expect(calls).toBeLessThanOrEqual(elements * 2)
  })
})
