import { useEffect, useRef, useState } from 'react'
import { AArrowDown, AArrowUp } from 'lucide-react'
import { TextDraft, TEXT_LIMIT, textDraftStorage } from './text-draft'
import { t } from '../i18n'
const MIN_FONT = 8
const MAX_FONT = 200

export function TextView({ id, text, fontSize }: { id: string; text: string; fontSize: number }) {
  const draft = useRef<TextDraft | null>(null)
  if (!draft.current) draft.current = new TextDraft(id, text, textDraftStorage())
  const editor = draft.current
  const [value, setValue] = useState(editor.value), [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const alive = useRef(true)
  const save = (): void => {
    clearTimeout(timer.current)
    void editor.save(v => window.palco.node.patch(id, { text: v })).then(() => { if (alive.current) setError('') }).catch(e => {
      if (alive.current) setError(t('nodes.TextView.nao_foi_salvo_rascunho_preserv', { v1: e instanceof Error ? e.message : String(e) }))
    })
  }
  useEffect(() => { editor.receive(text); setValue(editor.value) }, [editor, text])
  useEffect(() => {
    alive.current = true
    if (editor.dirty) timer.current = setTimeout(save, 400)
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [editor, id])
  const font = (delta: number): void => {
    const next = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(fontSize * (delta > 0 ? 1.2 : 1 / 1.2))))
    if (next !== fontSize) void window.palco.node.patch(id, { fontSize: next }).catch(e => setError(String(e)))
  }
  return <div className="textbox">
    <textarea className="text-free" value={value} maxLength={TEXT_LIMIT} placeholder={t('nodes.TextView.texto')} spellCheck={false} style={{ fontSize }}
      onPointerDown={e => e.stopPropagation()} onBlur={save}
      onPaste={e => {
        const input = e.currentTarget, inserted = e.clipboardData.getData('text')
        if (value.length - (input.selectionEnd - input.selectionStart) + inserted.length > TEXT_LIMIT) {
          e.preventDefault(); setError(t('nodes.TextView.colagem_nao_aplicada_limite_de', { TEXT_LIMIT }))
        }
      }}
      onChange={e => {
        try { editor.edit(e.target.value); setValue(editor.value); setError(''); clearTimeout(timer.current); timer.current = setTimeout(save, 400) }
        catch (e) { setError(e instanceof Error ? e.message : String(e)) }
      }} />
    <div className="text-tools" onPointerDown={e => e.stopPropagation()}>
      <small>{value.length}/{TEXT_LIMIT}</small>
      <button className="icon-btn" title={t('nodes.TextView.fonte_menor')} onClick={() => font(-1)}><AArrowDown size={14} /></button>
      <button className="icon-btn" title={t('nodes.TextView.fonte_maior')} onClick={() => font(1)}><AArrowUp size={14} /></button>
    </div>
    {error && <div role="alert">{error}</div>}
  </div>
}
