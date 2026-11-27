/**
 * Funções de página do portal. Cada uma é AUTOCONTIDA: o código-fonte serializado (`fn.toString()`) roda em outro
 * realm, então nada aqui pode importar ou referenciar variáveis de módulo. Os trechos repetidos entre as funções
 * (visibilidade, travessia, busca por ref) são cópias de propósito.
 */

export function pageSnapshot(doc: Document, limit: number): string {
  // Visibilidade com memória: cada elemento calcula só o PRÓPRIO estilo e herda o veredito do pai (linear no DOM).
  const cache = new Map<Element, boolean>()
  const parentOf = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement
    const host = (el.getRootNode() as ShadowRoot).host
    if (host) return host
    return (el.ownerDocument.defaultView?.frameElement as Element | null | undefined) ?? null
  }
  const own = (el: Element): boolean => {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD'].includes(el.tagName) || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
    if (el.tagName === 'INPUT' && el.getAttribute('type')?.toLowerCase() === 'hidden') return false
    const parent = el.parentElement
    if (parent && parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && el !== Array.from(parent.children).find(child => child.tagName === 'SUMMARY')) return false
    const style = (el.ownerDocument.defaultView ?? doc.defaultView)?.getComputedStyle(el)
    return !(style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0')
  }
  const visible = (element: Element): boolean => {
    const chain: Element[] = []
    let known: boolean | undefined
    for (let current: Element | null = element; current; current = parentOf(current)) {
      known = cache.get(current)
      if (known !== undefined) break
      chain.push(current)
    }
    let ok = known ?? true
    for (let i = chain.length - 1; i >= 0; i--) {
      ok = ok && own(chain[i]!)
      cache.set(chain[i]!, ok)
    }
    return ok
  }
  const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const labelIndex = new Map<Node, Map<string, Element[]>>()
  const textOf = (root: Element): string => {
    const parts: string[] = []
    const walker = root.ownerDocument.createTreeWalker(root, 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && visible(node.parentElement)) parts.push(node.textContent ?? '')
    }
    return compact(parts.join(' '))
  }
  const accessibleName = (element: Element): string => {
    const root = element.getRootNode() as Document | ShadowRoot
    const labelled = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)
      .map(id => root.getElementById?.(id)?.textContent ?? '').join(' ')
    if (compact(labelled)) return compact(labelled)
    const aria = element.getAttribute('aria-label')
    if (aria) return compact(aria)
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    // `element.labels` varre o documento a cada primeiro acesso (quadrático com muitos controles): índice de <label for> por raiz.
    let byFor = labelIndex.get(root)
    if (!byFor) {
      byFor = new Map<string, Element[]>()
      for (const label of Array.from(root.querySelectorAll('label[for]'))) {
        const id = label.getAttribute('for') ?? ''
        byFor.set(id, [...(byFor.get(id) ?? []), label])
      }
      labelIndex.set(root, byFor)
    }
    const labelList = element.id ? [...(byFor.get(element.id) ?? [])] : []
    const wrapper = element.closest('label')
    if (wrapper && !wrapper.hasAttribute('for') && wrapper.querySelector('input,select,textarea,button,meter,output,progress') === element) labelList.push(wrapper)
    const labels = labelList.map(label => textOf(label)).join(' ')
    if (compact(labels)) return compact(labels)
    if (element.tagName === 'INPUT' && ['submit', 'reset', 'button'].includes((element as HTMLInputElement).type)) return compact(field.value)
    return compact(textOf(element) || element.querySelector('img[alt]')?.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || '')
  }

  const lines: string[] = []
  const texts: string[] = []
  let refs = 0
  // Leituras de estilo e escritas de atributo não se misturam: escrever no meio da travessia invalidaria o estilo e
  // cada leitura seguinte recalcularia a árvore. A travessia só lê; os atributos são aplicados depois.
  const stale: Element[] = []
  const assign: Array<[Element, string]> = []
  const frameDocument = (frame: Element): Document | null => {
    try { return (frame as HTMLIFrameElement).contentDocument } catch { return null }
  }
  // Uma passada só: limpa refs antigas, numera controles e junta o texto, descendo em shadow roots abertos e iframes do mesmo origin.
  const box = (element: Element, ox: number, oy: number): string => {
    const r = element.getBoundingClientRect()
    return `[${Math.round(r.left + ox)},${Math.round(r.top + oy)} ${Math.round(r.width)}x${Math.round(r.height)}]`
  }
  const active = (d: Document): Element | null => d.activeElement
  const walk = (root: Node, ox: number, oy: number): void => {
    const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 5)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const owner = node.parentElement ?? (node.parentNode as ShadowRoot | null)?.host
        if (owner && visible(owner)) texts.push(node.textContent ?? '')
        continue
      }
      const element = node as Element
      if (element.hasAttribute('data-palco-ref')) stale.push(element)
      if (element.matches('a[href],button,input,select,textarea,[role="button"]') && visible(element)) {
        const ref = `e${++refs}`
        assign.push([element, ref])
        // Formato da skill palco-portal: `@e2 input type=text "Search" [200,50 300x32] *focused*`.
        const tag = element.tagName.toLowerCase()
        const type = tag === 'input' ? ` type=${(element as HTMLInputElement).type || 'text'}` : ''
        const role = element.getAttribute('role') && tag !== 'button' ? ` role=${element.getAttribute('role')}` : ''
        const href = tag === 'a' ? ` href=${(element as HTMLAnchorElement).href}` : ''
        const kind = tag === 'input' ? (element as HTMLInputElement).type : ''
        const value = ['input', 'select', 'textarea'].includes(tag) && !['password', 'submit', 'reset', 'button'].includes(kind)
          ? ` value=${JSON.stringify((element as HTMLInputElement).value)}` : ''
        const checked = tag === 'input' && ['checkbox', 'radio'].includes(kind) && (element as HTMLInputElement).checked ? ' *checked*' : ''
        const focused = active(element.ownerDocument) === element ? ' *focused*' : ''
        lines.push(`@${ref} ${tag}${type}${role} ${JSON.stringify(accessibleName(element))}${href}${value} ${box(element, ox, oy)}${checked}${focused}`)
      }
      if (element.shadowRoot && visible(element)) walk(element.shadowRoot, ox, oy)
      if ((element.tagName === 'IFRAME' || element.tagName === 'FRAME') && visible(element)) {
        const inner = frameDocument(element)
        const r = element.getBoundingClientRect()
        if (inner) walk(inner.body ?? inner.documentElement, ox + r.left, oy + r.top)
        else lines.push(`[iframe] ${element.getAttribute('src') ?? ''} (não acessível)`)
      }
    }
  }
  walk(doc.body ?? doc.documentElement, 0, 0)
  for (const element of stale) element.removeAttribute('data-palco-ref')
  for (const [element, ref] of assign) element.setAttribute('data-palco-ref', ref)
  const view = doc.defaultView
  const header = `viewport: ${view?.innerWidth ?? 0}x${view?.innerHeight ?? 0}  url: ${doc.location?.href ?? ''}  title: ${compact(doc.title ?? '')}`
  return [header, ...lines, '---', compact(texts.join(' '))].join('\n').slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0)
}

export function pageClick(doc: Document, target: string): string {
  const frameDocument = (frame: Element): Document | null => {
    try { return (frame as HTMLIFrameElement).contentDocument } catch { return null }
  }
  // Procura no documento e, se não achar, em shadow roots abertos e iframes do mesmo origin (refs e seletores CSS).
  let element: Element | null = null
  try {
    const selector = /^e\d+$/.test(target) ? `[data-palco-ref="${target}"]` : target
    const roots: Array<Document | ShadowRoot> = [doc]
    for (let i = 0; i < roots.length && !element; i++) {
      element = roots[i]!.querySelector(selector)
      if (element) break
      for (const candidate of roots[i]!.querySelectorAll('*')) {
        if (candidate.shadowRoot) roots.push(candidate.shadowRoot)
        if (candidate.tagName === 'IFRAME' || candidate.tagName === 'FRAME') {
          const inner = frameDocument(candidate)
          if (inner) roots.push(inner)
        }
      }
    }
  } catch { element = null /* seletor inválido também é alvo ausente */ }
  if (!element) throw new Error(`elemento não encontrado: ${target}`)

  const disabled = (el: Element): boolean => {
    if (el.getAttribute('aria-disabled') === 'true') return true
    for (let current: Element | null = el; current; current = current.parentElement) {
      if (current.hasAttribute('disabled') && ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET', 'OPTION', 'OPTGROUP'].includes(current.tagName)
        && (current === el || current.tagName === 'FIELDSET')) return true
    }
    return false
  }
  if (disabled(element)) throw new Error(`elemento desabilitado: ${target}`)

  element.scrollIntoView?.({ block: 'center', inline: 'nearest' })

  // O que um clique real acertaria no centro do elemento: se for outra coisa, quem cobre é quem receberia o clique.
  const rect = element.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    const root = element.getRootNode() as Document | ShadowRoot
    const hit = root.elementFromPoint?.(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (hit && hit !== element && !element.contains(hit)) {
      const label = element.closest('label')
      const related = hit.closest('label')
      const sameLabel = (label && label.contains(hit)) || (related && (related as HTMLLabelElement).control === element)
      if (!sameLabel) {
        const classes = Array.from(hit.classList).slice(0, 2).map(name => `.${name}`).join('')
        throw new Error(`elemento coberto por <${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${classes}>: ${target}`)
      }
    }
  }

  if (typeof (element as HTMLElement).click === 'function') (element as HTMLElement).click()
  else {
    const view = element.ownerDocument.defaultView ?? doc.defaultView
    if (!view) throw new Error('documento sem janela')
    element.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  return 'ok'
}

export function pageFill(doc: Document, target: string, value: string): string {
  const frameDocument = (frame: Element): Document | null => {
    try { return (frame as HTMLIFrameElement).contentDocument } catch { return null }
  }
  let element: Element | null = null
  try {
    const selector = /^e\d+$/.test(target) ? `[data-palco-ref="${target}"]` : target
    const roots: Array<Document | ShadowRoot> = [doc]
    for (let i = 0; i < roots.length && !element; i++) {
      element = roots[i]!.querySelector(selector)
      if (element) break
      for (const candidate of roots[i]!.querySelectorAll('*')) {
        if (candidate.shadowRoot) roots.push(candidate.shadowRoot)
        if (candidate.tagName === 'IFRAME' || candidate.tagName === 'FRAME') {
          const inner = frameDocument(candidate)
          if (inner) roots.push(inner)
        }
      }
    }
  } catch { element = null /* seletor inválido também é alvo ausente */ }
  if (!element) throw new Error(`elemento não encontrado: ${target}`)
  const view = element.ownerDocument.defaultView ?? doc.defaultView
  if (!view) throw new Error('documento sem janela')

  const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  const tag = element.tagName
  const editable = ['', 'true', 'plaintext-only'].includes(element.getAttribute('contenteditable') ?? 'não')
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !editable) throw new Error(`elemento não é campo: ${target}`)

  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('disabled') && ['INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET'].includes(current.tagName)
      && (current === element || current.tagName === 'FIELDSET')) throw new Error(`elemento desabilitado: ${target}`)
  }
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && (field as HTMLInputElement).readOnly) throw new Error(`elemento somente leitura: ${target}`)

  const type = tag === 'INPUT' ? (field as HTMLInputElement).type.toLowerCase() : ''
  const fire = (name: string): void => void element!.dispatchEvent(new view.Event(name, { bubbles: true }))
  const focusable = element as HTMLElement
  if (type === 'file') throw new Error(`campo de arquivo não pode ser preenchido: ${target}`)

  focusable.focus?.()
  try {
    if (type === 'checkbox' || type === 'radio') {
      const word = value.trim().toLowerCase()
      const wanted = ['true', 'on'].includes(word) ? true : ['false', 'off'].includes(word) ? false : null
      if (wanted === null) throw new Error(`valor inválido para ${type}: use true, false, on ou off`)
      const input = field as HTMLInputElement
      if (type === 'radio' && !wanted) throw new Error('um radio não pode ser desmarcado: marque outro da mesma opção')
      if (input.checked !== wanted) {
        input.click() // o clique alterna o estado e dispara input/change como numa interação real
        if (input.checked !== wanted) {
          input.checked = wanted
          fire('input')
          fire('change')
        }
      }
      if (input.checked !== wanted) throw new Error(`o campo recusou o valor: ${target}`)
    } else if (tag === 'SELECT') {
      const select = field as HTMLSelectElement
      const options = Array.from(select.options)
      const wanted = options.find(option => option.value === value) ?? options.find(option => (option.text ?? '').trim() === value.trim())
      if (!wanted) throw new Error(`opção não encontrada: ${value} (opções: ${options.map(option => (option.text ?? '').trim()).join(', ')})`)
      const setter = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, wanted.value)
      if (select.value !== wanted.value) throw new Error(`o campo recusou o valor: ${target}`)
      fire('input')
      fire('change')
    } else if (editable && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      element.textContent = value
      const Input = (view as unknown as { InputEvent?: typeof InputEvent }).InputEvent
      element.dispatchEvent(Input ? new Input('input', { bubbles: true, inputType: 'insertText', data: value }) : new view.Event('input', { bubbles: true }))
    } else {
      const prototype = tag === 'INPUT' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      if (!setter) throw new Error(`elemento não é campo: ${target}`)
      setter.call(element, value)
      // O navegador pode sanitizar (type=number com texto, quebras de linha em input): conferir antes de dizer ok.
      const normalize = (text: string): string => (tag === 'TEXTAREA' ? text.replace(/\r\n?/g, '\n') : text)
      if (normalize(field.value) !== normalize(value)) throw new Error(`o campo recusou o valor (${type || 'textarea'}): ${value}`)
      fire('input')
      fire('change')
    }
  } finally {
    focusable.blur?.()
  }
  return 'ok'
}

export function pageText(doc: Document, limit: number): string {
  // Mesma visibilidade linear do snapshot, copiada: fn.toString() precisa conter tudo o que usa.
  const cache = new Map<Element, boolean>()
  const parentOf = (el: Element): Element | null => {
    if (el.parentElement) return el.parentElement
    const host = (el.getRootNode() as ShadowRoot).host
    if (host) return host
    return (el.ownerDocument.defaultView?.frameElement as Element | null | undefined) ?? null
  }
  const own = (el: Element): boolean => {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD'].includes(el.tagName) || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
    if (el.tagName === 'INPUT' && el.getAttribute('type')?.toLowerCase() === 'hidden') return false
    const parent = el.parentElement
    if (parent && parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && el !== Array.from(parent.children).find(child => child.tagName === 'SUMMARY')) return false
    const style = (el.ownerDocument.defaultView ?? doc.defaultView)?.getComputedStyle(el)
    return !(style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0')
  }
  const visible = (element: Element): boolean => {
    const chain: Element[] = []
    let known: boolean | undefined
    for (let current: Element | null = element; current; current = parentOf(current)) {
      known = cache.get(current)
      if (known !== undefined) break
      chain.push(current)
    }
    let ok = known ?? true
    for (let i = chain.length - 1; i >= 0; i--) {
      ok = ok && own(chain[i]!)
      cache.set(chain[i]!, ok)
    }
    return ok
  }
  const texts: string[] = []
  const frameDocument = (frame: Element): Document | null => {
    try { return (frame as HTMLIFrameElement).contentDocument } catch { return null }
  }
  const walk = (root: Node): void => {
    const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 5)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const owner = node.parentElement ?? (node.parentNode as ShadowRoot | null)?.host
        if (owner && visible(owner)) texts.push(node.textContent ?? '')
        continue
      }
      const element = node as Element
      if (element.shadowRoot && visible(element)) walk(element.shadowRoot)
      if ((element.tagName === 'IFRAME' || element.tagName === 'FRAME') && visible(element)) {
        const inner = frameDocument(element)
        if (inner) walk(inner.body ?? inner.documentElement)
      }
    }
  }
  walk(doc.body ?? doc.documentElement)
  return texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0)
}

export function injectable(fn: Function, ...args: unknown[]): string {
  return `(${fn.toString()})(document, ...${JSON.stringify(args)})`
}

/**
 * Como `injectable`, mas a exceção da página volta como dado: o `executeJavaScript` do Electron esconde a mensagem
 * de qualquer exceção ("Script failed to execute…"), e o agente precisa ler "elemento desabilitado", "opção não encontrada"…
 * Devolve `{ok:true,value}` ou `{ok:false,error}`.
 */
export function guarded(fn: Function, ...args: unknown[]): string {
  return `(()=>{try{return {ok:true,value:${injectable(fn, ...args)}}}catch(error){return {ok:false,error:error&&error.message?String(error.message):String(error)}}})()`
}
