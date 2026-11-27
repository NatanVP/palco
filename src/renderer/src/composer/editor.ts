/** Plain serialization of our own editor DOM. Never interpret pasted HTML. */
export function readEditor(root: Node): string {
  // O `<br>` no fim do editor nunca é texto: é o apoio que mostra a última linha vazia (nosso, ou o que o Chromium deixa).
  // As quebras de linha do rascunho são `\n` em nós de texto.
  const last = root.lastChild
  if (last?.nodeName === 'BR' && !(root instanceof HTMLElement && root.dataset.composerValue !== undefined)) {
    const kept = [...root.childNodes].slice(0, -1)
    return kept.map((child, i) => serialize(child, i > 0 ? kept[i - 1]! : null)).join('')
  }
  return serialize(root, null)
}
function serialize(root: Node, previous: Node | null): string {
  const block = previous !== null && root instanceof HTMLElement && ['DIV', 'P'].includes(root.tagName)
  const prefix = block && !serialize(previous!, null).endsWith('\n') ? '\n' : ''
  if (root.nodeType === Node.TEXT_NODE) return prefix + (root.textContent ?? '')
  if (root instanceof HTMLElement) {
    if (root.dataset.composerValue !== undefined) return prefix + root.dataset.composerValue
    if (root.tagName === 'BR') return prefix + '\n'
  }
  const children = [...root.childNodes]
  return prefix + children.map((child, i) => serialize(child, i > 0 ? children[i - 1]! : null)).join('')
}
export function editorSelection(root: HTMLElement): { start: number; end: number } {
  const selection = document.getSelection()
  if (!selection?.rangeCount) return { start: readEditor(root).length, end: readEditor(root).length }
  const selected = selection.getRangeAt(0)
  if (!root.contains(selected.commonAncestorContainer)) return { start: readEditor(root).length, end: readEditor(root).length }
  const before = document.createRange(); before.selectNodeContents(root); before.setEnd(selected.startContainer, selected.startOffset)
  const through = document.createRange(); through.selectNodeContents(root); through.setEnd(selected.endContainer, selected.endOffset)
  return { start: readEditor(before.cloneContents()).length, end: readEditor(through.cloneContents()).length }
}
export function setEditorSelection(root: HTMLElement | null, start: number, end = start): void {
  if (!root) return
  const point = (offset: number): [Node, number] => {
    let remaining = offset
    const walk = (node: Node): [Node, number] | null => {
      if (node instanceof HTMLElement && node.dataset.composerValue !== undefined) {
        const length = node.dataset.composerValue.length
        if (remaining <= length) return [node.parentNode!, [...node.parentNode!.childNodes].indexOf(node) + (remaining > 0 ? 1 : 0)]
        remaining -= length; return null
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.textContent?.length ?? 0
        if (remaining <= length) return [node, remaining]
        remaining -= length; return null
      }
      for (const child of node.childNodes) { const found = walk(child); if (found) return found }
      return null
    }
    return walk(root) ?? [root, root.childNodes.length]
  }
  const range = document.createRange(), a = point(start), b = point(end)
  range.setStart(...a); range.setEnd(...b)
  const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
}
export interface EditorPill { label: string; expanded: string; path?: string; removeLabel?: string }
/** Redesenha o editor quando o DOM não corresponde ao rascunho; devolve `true` se redesenhou (e o cursor precisa ser reposto). */
export function paintEditor(root: HTMLElement, value: string, pills: ReadonlyMap<string, EditorPill>): boolean {
  // Texto que termina em quebra precisa do `<br>` de apoio, senão o Chromium não mostra a linha nova e o cursor fica antes dela.
  const needsFiller = value.endsWith('\n')
  if (readEditor(root) === value && root.dataset.painted === 'true' && (!needsFiller || root.lastChild?.nodeName === 'BR')) return false
  const parts: Node[] = []
  let offset = 0
  const keys = [...pills.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  while (offset < value.length) {
    let at = value.length, token = ''
    for (const key of keys) { const found = value.indexOf(key, offset); if (found >= 0 && found < at) { at = found; token = key } }
    if (at > offset) parts.push(document.createTextNode(value.slice(offset, at)))
    if (!token) break
    const pill = document.createElement('span'), data = pills.get(token)!
    pill.contentEditable = 'false'; pill.dataset.composerPill = 'true'; pill.dataset.composerValue = token
    pill.textContent = data.label
    if (data.path) {
      pill.dataset.composerAttachment = data.path
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'
      remove.dataset.removeAttachment = data.path; remove.setAttribute('aria-label', data.removeLabel ?? data.label); pill.append(remove)
    }
    pill.title = data.expanded; pill.className = 'composer-pill'; parts.push(pill)
    offset = at + token.length
  }
  if (needsFiller) parts.push(document.createElement('br'))
  root.replaceChildren(...parts); root.dataset.painted = 'true'
  return true
}
