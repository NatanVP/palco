import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { NoteNode } from '../../../shared/model'
import { NOTE_FORMAT_EVENT, formatNote, type NoteFormatDetail } from '../canvas/contextual'
import { NoteSync } from './note-sync'
import { Markdown } from '../chat/Markdown'
import { t } from '../i18n'

const FAMILY: Record<NonNullable<NoteNode['fontFamily']>, string> = {
  mono: 'ui-monospace, monospace',
  sans: 'var(--font-sans)',
  serif: 'ui-serif, Georgia, serif'
}

/** Aparência do cartão: cor (fundo escurecido da cor escolhida), tamanho e família da fonte. */
export function noteStyle(note: Pick<NoteNode, 'color' | 'fontSize' | 'fontFamily'>): CSSProperties {
  return {
    // Por variável: o tema claro troca o fundo pelo papel pastel da cor (note-colors.ts).
    ...(note.color ? { ['--note-tint' as string]: `color-mix(in srgb, ${note.color} 22%, #16171a)` } : {}),
    ...(note.fontSize ? { fontSize: note.fontSize } : {}),
    ...(note.fontFamily ? { fontFamily: FAMILY[note.fontFamily] } : {})
  }
}

/**
 * Nota editável: grava 300 ms depois da última tecla; só regrava no blur se houve edição local.
 * Travada, fica só leitura e recusa os comandos de formatação da barra.
 */
export function NoteView({ id, content, color, fontSize, fontFamily, locked = false, render = 'raw' }: { id: string; content: string } & Pick<NoteNode, 'color' | 'fontSize' | 'fontFamily' | 'locked' | 'render'>) {
  const [editing, setEditing] = useState(false)
  const lockedRef = useRef(locked)
  lockedRef.current = locked
  const editor = useRef<HTMLTextAreaElement>(null)
  const sync = useRef(new NoteSync(content))
  const [text, setText] = useState(content)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const shown = sync.current.external(content)
    if (shown !== undefined) setText(shown)
  }, [content])

  useEffect(() => () => clearTimeout(timer.current), [])

  const save = (): void => {
    clearTimeout(timer.current)
    const toWrite = sync.current.flush()
    if (toWrite !== undefined) void window.palco.node.patch(id, { content: toWrite })
  }

  useEffect(() => {
    const area = editor.current
    if (!area) return
    const format = (event: Event): void => {
      const e = event as CustomEvent<NoteFormatDetail>
      e.preventDefault()
      if (lockedRef.current) { e.detail.error = t('nodes.NoteView.a_nota_esta_travada'); return }
      try {
        const next = formatNote(sync.current.text, area.selectionStart, area.selectionEnd, e.detail.command)
        sync.current.edit(next.text); setText(next.text)
        save()
        requestAnimationFrame(() => { if (area.isConnected) { area.focus(); area.setSelectionRange(next.start, next.end) } })
      } catch (err) { e.detail.error = err instanceof Error ? err.message : t('nodes.NoteView.nao_foi_possivel_formatar_a_no') }
    }
    area.addEventListener(NOTE_FORMAT_EVENT, format)
    return () => area.removeEventListener(NOTE_FORMAT_EVENT, format)
  }, [id])

  const formatted = render === 'markdown'
  const toggle = (
    <button type="button" className="note-render-toggle" aria-pressed={formatted} title={formatted ? t('nodes.NoteView.mostrar_texto_bruto') : t('nodes.NoteView.mostrar_formatado')} onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { setEditing(false); void window.palco.node.patch(id, { render: formatted ? 'raw' : 'markdown' }) }}>{formatted ? t('nodes.NoteView.formatado') : t('nodes.NoteView.texto_bruto')}</button>
  )
  // Formatado: o texto aparece renderizado (markdown seguro, o mesmo do chat); um clique (ou duplo clique, se travada) abre a edição.
  if (formatted && !editing) {
    return (
      <div className="note-wrap">
        {toggle}
        <div className="note-preview" role="document" aria-label={t('nodes.NoteView.nota_formatada')} style={noteStyle({ color, fontSize, fontFamily })} tabIndex={0} onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { if (!locked) setEditing(true) }} onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditing(true) } }}>
          {text.trim() ? <Markdown source={text} /> : <span className="note-placeholder">{locked ? t('nodes.NoteView.nota_vazia') : t('nodes.NoteView.clique_para_editar')}</span>}
        </div>
      </div>
    )
  }
  return (
    <div className="note-wrap">
      {toggle}
    <textarea
      ref={editor}
      className={`note-text${locked ? ' locked' : ''}`}
      style={noteStyle({ color, fontSize, fontFamily })}
      readOnly={locked}
      aria-readonly={locked}
      title={locked ? t('nodes.NoteView.nota_travada_destrave_na_barra') : undefined}
      value={text}
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      autoFocus={formatted}
      onFocus={() => sync.current.focus()}
      onBlur={() => { save(); if (formatted) setEditing(false) }}
      onChange={(e) => {
        sync.current.edit(e.target.value)
        setText(e.target.value)
        clearTimeout(timer.current)
        timer.current = setTimeout(save, 300)
      }}
    />
    </div>
  )
}
