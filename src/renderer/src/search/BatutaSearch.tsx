import { useEffect, useMemo, useRef, useState } from 'react'
import { filterSearch, type SearchEntry } from './search-index'
import { t } from '../i18n'

const KIND_LABEL: Record<SearchEntry['kind'], string> = { get node() { return t('search.BatutaSearch.elemento') }, get workspace() { return t('search.BatutaSearch.espaco') }, command: 'Comando' }

/** Batuta Search: um campo só que acha elementos do andar, espaços de trabalho e comandos. ↑↓ escolhem, Enter abre, Esc fecha, ">" só comandos. */
export function BatutaSearch({ entries, onPick, onClose }: { entries: readonly SearchEntry[]; onPick(entry: SearchEntry): void; onClose(): void }) {
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => filterSearch(entries, query), [entries, query])
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])
  const pick = (e: SearchEntry | undefined): void => { if (e) { onClose(); onPick(e) } }
  return <div className="modal-back" onPointerDown={onClose}>
    <div className="modal batuta" role="dialog" aria-label={t('search.BatutaSearch.batuta_search')} onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(shown.length - 1, i + 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)) }
        else if (e.key === 'Enter') { e.preventDefault(); pick(shown[index]) }
      }}>
      <input ref={input} aria-label={t('search.BatutaSearch.buscar')} placeholder={t('search.BatutaSearch.buscar_elementos_espacos_e_com')} value={query} onChange={e => setQuery(e.target.value)} />
      <ul role="listbox" aria-label={t('search.BatutaSearch.resultados')}>
        {shown.slice(0, 50).map((e, i) => <li key={`${e.kind}:${e.id}`} role="option" aria-selected={i === index} className={i === index ? 'active' : ''} onPointerEnter={() => setIndex(i)} onClick={() => pick(e)}>
          <span className="batuta-kind">{KIND_LABEL[e.kind]}</span><span className="batuta-label">{e.label}{e.active ? ` ${t('search.BatutaSearch.atual')}` : ''}</span>{e.hint && <small>{e.hint}</small>}
        </li>)}
        {!shown.length && <li className="empty">{t('search.BatutaSearch.nada_encontrado')}</li>}
      </ul>
    </div>
  </div>
}
