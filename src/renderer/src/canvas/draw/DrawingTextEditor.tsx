import { useLayoutEffect, useRef } from 'react'
import type { Drawing } from '../../../../shared/model'
import { TEXT_SIZE_DEFAULT, textColor, textColumn, textOffsetY } from './text'
import { t } from '../../i18n'

/**
 * Caixa de texto dentro da forma (duplo clique): centrada, com a cor, fonte e coluna do texto final, e a altura acompanhando o conteúdo.
 * Esc ou clicar fora confirma (texto vazio apaga); as coordenadas são as do mundo, como o resto do canvas.
 */
export function DrawingTextEditor({ drawing, value, onChange, onCommit }: { drawing: Drawing; value: string; onChange(v: string): void; onCommit(): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const a = drawing.points[0]!, b = drawing.points[drawing.points.length - 1]!
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
  const size = drawing.textSize ?? TEXT_SIZE_DEFAULT, line = Math.ceil(size * 1.2), col = textColumn(w)
  useLayoutEffect(() => { const t = ref.current; if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length) } }, [drawing.id])
  useLayoutEffect(() => { const t = ref.current; if (t) { t.style.height = '0px'; t.style.height = `${Math.max(line, t.scrollHeight)}px` } }, [line, value, col])
  return (
    <textarea
      ref={ref} aria-label={t('canvas.draw.DrawingTextEditor.texto_da_forma')} data-drawing-text-editor="true" className="drawing-text-editor" value={value} wrap="soft" spellCheck
      onChange={(e) => onChange(e.target.value)} onBlur={onCommit} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onCommit() } }}
      style={{ position: 'absolute', left: x0 + w / 2, top: y0 + h / 2 + textOffsetY(drawing.tool ?? 'rect', h), transform: 'translate(-50%, -50%)', width: col, minHeight: line, color: textColor(drawing), fontFamily: 'system-ui, sans-serif', fontSize: size, lineHeight: 1.2, textAlign: 'center', resize: 'none', overflow: 'hidden', border: 0, background: 'transparent', padding: 0, outline: 'none', zIndex: 10 }}
    />
  )
}
