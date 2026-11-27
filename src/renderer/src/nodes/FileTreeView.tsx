import { matchesZoomWheel, usePreferences } from '../settings/preferences'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, File, Folder, FolderOpen, RotateCw } from 'lucide-react'
import { folderName, folderTrail, parentFolder } from '../../../shared/tree-path'
import { t } from '../i18n'

type Entry = { name: string; dir: boolean }
type Listing = Entry[] | { error: string }

const LIMIT = 500
const join = (dir: string, name: string): string => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

/**
 * Árvore de pastas a partir da pasta atual (abaixo de `root`), carregada sob demanda. Duplo clique numa pasta entra nela e num
 * arquivo abre um nó arquivo; voltar, avançar e a hierarquia navegam sem passar da raiz.
 */
export function FileTreeView({ root, current, onNavigate = () => {}, onOpenFile }: { root: string; current?: string; onNavigate?(path: string): void; onOpenFile(path: string): void }) {
  const here = current ?? root
  const [forward, setForward] = useState<string[]>([])
  const [trail, setTrail] = useState<{ x: number; y: number } | null>(null)
  const [listings, setListings] = useState<Record<string, Listing>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set([here]))
  const prefs = usePreferences()
  // Menu de contexto de uma entrada (Copiar Caminho, Renomear, Mover para a Lixeira), renomeação em linha e a confirmação de exclusão.
  const [menu, setMenu] = useState<{ path: string; dir: boolean; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [problem, setProblem] = useState('')
  const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'
  const fail = (e: unknown): void => setProblem(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
  const trash = (path: string): void => { setDeleting(null); setProblem(''); void window.palco.files.trash(path).then(() => load(parentOf(path))).catch(fail) }
  const rename = (path: string, name: string): void => { setRenaming(null); if (!name.trim() || name === path.split('/').pop()) return; setProblem(''); void window.palco.files.rename(path, name).then(() => load(parentOf(path))).catch(fail) }

  const load = useCallback((dir: string): void => {
    window.palco.files.list(dir)
      .then((list) => setListings((all) => ({ ...all, [dir]: list })))
      .catch((err: unknown) => setListings((all) => ({ ...all, [dir]: { error: String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') } })))
  }, [])

  useEffect(() => {
    setListings({})
    setOpen(new Set([here]))
    load(here)
  }, [here, load])
  useEffect(() => { setForward([]) }, [root])
  /** Entrar ou saltar começa um caminho novo; voltar guarda de onde saiu. */
  const enter = (path: string): void => { setForward([]); setTrail(null); onNavigate(path) }
  const back = (): void => { setForward((list) => [...list, here]); onNavigate(parentFolder(here)) }
  const advance = (): void => { const next = forward.at(-1); if (next === undefined) return; setForward(forward.slice(0, -1)); onNavigate(next) }

  const toggle = (dir: string): void => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        if (!listings[dir]) load(dir)
      }
      return next
    })
  }

  const render = (dir: string, depth: number): ReactNode => {
    const listing = listings[dir]
    if (!listing) return <div className="tree-msg" style={{ paddingLeft: 8 + depth * 14 }}>{t('nodes.FileTreeView.carregando')}</div>
    if (!Array.isArray(listing)) return <div className="tree-msg" style={{ paddingLeft: 8 + depth * 14 }}>{listing.error}</div>
    return (
      <>
        {listing.map((e) => {
          const path = join(dir, e.name)
          const expanded = open.has(path)
          return (
            <div key={path}>
              <div
                className={`tree-row${e.dir ? ' dir' : ''}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                title={path}
                onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setMenu({ path, dir: e.dir, x: ev.clientX, y: ev.clientY }) }}
                onClick={() => e.dir && toggle(path)}
                onDoubleClick={() => (e.dir ? enter(path) : onOpenFile(path))}
              >
                {e.dir ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-gap" />}
                {e.dir ? (expanded ? <FolderOpen size={13} /> : <Folder size={13} />) : <File size={13} />}
                {renaming === path
                  ? <input className="tree-rename" aria-label={t('nodes.FileTreeView.novo_nome')} autoFocus defaultValue={e.name} onClick={(ev) => ev.stopPropagation()} onBlur={() => setRenaming(null)} onKeyDown={(ev) => { if (ev.key === 'Enter') rename(path, ev.currentTarget.value); if (ev.key === 'Escape') setRenaming(null) }} />
                  : <span className="tree-name">{e.name}</span>}
              </div>
              {e.dir && expanded && render(path, depth + 1)}
            </div>
          )
        })}
        {listing.length >= LIMIT && <div className="tree-msg" style={{ paddingLeft: 8 + depth * 14 }}>{t('nodes.FileTreeView.mostrando_so_as_primeiras', { limit: LIMIT })}</div>}
        {listing.length === 0 && <div className="tree-msg" style={{ paddingLeft: 8 + depth * 14 }}>{t('nodes.FileTreeView.vazia')}</div>}
      </>
    )
  }

  return (
    <div className="treebox" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => !matchesZoomWheel(e.nativeEvent) && e.stopPropagation()}>
      <div className="tree-nav" role="group" aria-label={t('nodes.FileTreeView.navegacao')}>
        <button type="button" className="icon-btn" aria-label={t('nodes.FileTreeView.voltar')} title={t('nodes.FileTreeView.voltar')} disabled={here === root} onClick={back}><ChevronLeft size={14} /></button>
        <button type="button" className="icon-btn" aria-label={t('nodes.FileTreeView.avancar')} title={t('nodes.FileTreeView.avancar')} disabled={!forward.length} onClick={advance}><ChevronRight size={14} /></button>
        <button type="button" className="tree-here" title={here} aria-haspopup="menu" onClick={(ev) => { const box = ev.currentTarget.getBoundingClientRect(); setTrail({ x: box.left, y: box.bottom + 4 }) }}>{folderName(here)}</button>
      </div>
      <div className="file-bar" title={root}>
        <span className="file-path">{`\u200e${root}\u200e`}</span>
        <button className="icon-btn" title={t('nodes.FileTreeView.recarregar')} onClick={() => { setListings({}); for (const d of open) load(d) }}><RotateCw size={12} /></button>
      </div>
      {problem && <div className="tree-msg" role="alert">{problem}</div>}
      <div className="tree-body">{render(here, 0)}</div>
      {trail && createPortal(<><div className="tree-menu" role="menu" aria-label={t('nodes.FileTreeView.hierarquia')} style={{ left: trail.x, top: trail.y }} onPointerDown={(ev) => ev.stopPropagation()}>
        {folderTrail(here, root).map((path, i) => <button key={path} type="button" role="menuitem" disabled={i === 0} onClick={() => enter(path)}>{folderName(path)}</button>)}
      </div><div className="tree-menu-back" onPointerDown={(ev) => { ev.stopPropagation(); setTrail(null) }} /></>, document.body)}
      {menu && createPortal(<><div className="tree-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(ev) => ev.stopPropagation()}>
        {menu.dir && <button type="button" role="menuitem" onClick={() => { const p = menu.path; setMenu(null); enter(p) }}>{t('nodes.FileTreeView.abrir')}</button>}
        <button type="button" role="menuitem" onClick={() => { void navigator.clipboard.writeText(menu.path).catch(() => {}); setMenu(null) }}>{t('nodes.FileTreeView.copiar_caminho')}</button>
        <button type="button" role="menuitem" onClick={() => { setRenaming(menu.path); setMenu(null) }}>{t('nodes.FileTreeView.renomear')}</button>
        <button type="button" role="menuitem" onClick={() => { const p = menu.path; setMenu(null); if (prefs.confirmFileDelete) setDeleting(p); else trash(p) }}>{t('nodes.FileTreeView.mover_para_a_lixeira')}</button>
      </div><div className="tree-menu-back" onPointerDown={(ev) => { ev.stopPropagation(); setMenu(null) }} /></>, document.body)}
      {deleting && <div className="tree-confirm" role="alertdialog" aria-label={t('nodes.FileTreeView.mover_para_a_lixeira_2')}><p>{t('nodes.FileTreeView.mover_name_para_a_lixeira', { name: deleting.split('/').pop() ?? deleting })}</p><div><button type="button" onClick={() => setDeleting(null)}>{t('nodes.FileTreeView.cancelar')}</button><button type="button" className="danger" onClick={() => trash(deleting)}>{t('nodes.FileTreeView.mover_para_a_lixeira')}</button></div></div>}
    </div>
  )
}
