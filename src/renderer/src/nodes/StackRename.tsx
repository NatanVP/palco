import { useRef } from 'react'
import { MAX_GROUP_NAME } from '../../../shared/groups'
import { t } from '../i18n'

/** Nome do fichário em edição: Enter ou sair grava (vazio limpa o nome), Escape desiste. */
export function StackRename({ name, onDone }: { name: string; onDone(next: string | null): void }) {
  const done = useRef(false)
  const finish = (next: string | null): void => { if (done.current) return; done.current = true; onDone(next === null ? null : next.trim()) }
  return (
    <input
      className="stack-rename" autoFocus defaultValue={name} maxLength={MAX_GROUP_NAME} aria-label={t('nodes.StackRename.nome')} placeholder={t('nodes.StackRename.nome')}
      onFocus={(e) => e.target.select()} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(e.currentTarget.value); else if (e.key === 'Escape') finish(null) }}
    />
  )
}
