import { matchesShortcut } from '../settings/preferences'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { HOME_PAGE_ID, type Sidebar, type SidebarPage } from '../../../shared/model'
import { ColorRow, IconGrid } from '../dialogs/AppearanceFields'
import { Glyph, WORKSPACE_ICONS } from './workspace-icons'
import { t } from '../i18n'

interface Props {
  sidebar: Sidebar
  onError(title: string, err: unknown): void
  /** Menu de contexto da barra (o mesmo estilo do resto da barra lateral). */
  onMenu(e: React.MouseEvent, items: Array<{ label: string; icon: ReactNode; danger?: boolean; disabled?: boolean; run(): void }>): void
}

type Pop = { kind: 'new' } | { kind: 'edit'; page: SidebarPage }

/** Nome, ícone e cor de um Espaço (popover "Novo espaço" e "Editar espaço"). */
function PageForm({ initial, submit, onSubmit }: { initial: { name: string; icon: string; color: string | null }; submit: string; onSubmit(v: { name: string; icon: string; color: string | null }): void }) {
  const [name, setName] = useState(initial.name)
  const [icon, setIcon] = useState(initial.icon)
  const [color, setColor] = useState<string | null>(initial.color)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const send = (): void => { if (name.trim() !== '') onSubmit({ name: name.trim(), icon, color }) }
  return (
    <form className="page-form" onSubmit={(e) => { e.preventDefault(); send() }}>
      <input ref={ref} className="nt-input small" aria-label={t('sidebar.SpaceBar.nome_do_espaco')} placeholder={t('sidebar.SpaceBar.nome_do_espaco')} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <IconGrid icon={icon} icons={WORKSPACE_ICONS} onIcon={setIcon} fallback="folder" />
      <ColorRow color={color} onColor={setColor} allowNone />
      <div className="page-form-actions"><button type="submit" className="primary" disabled={name.trim() === ''}>{submit}</button></div>
    </form>
  )
}

/**
 * Rodapé da barra lateral: um ícone por Espaço (página inteira da barra) e o "+" para criar outro.
 * Clique troca de Espaço; clique no ativo abre "Editar espaço"; botão direito, o menu.
 */
export function SpaceBar({ sidebar, onError, onMenu }: Props) {
  const [pop, setPop] = useState<Pop | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const row = useRef<HTMLDivElement>(null)
  const api = window.palco
  const run = (title: string, p: Promise<unknown>): void => void p.catch((err: unknown) => onError(title, err))

  useEffect(() => {
    if (!pop) return
    const onKey = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e)) setPop(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pop])

  // O popover sai da barra (que corta o que transborda): posição fixa logo acima do rodapé.
  const open = (next: Pop): void => {
    const box = row.current?.getBoundingClientRect()
    setAnchor(box ? { left: box.left + 8, bottom: window.innerHeight - box.top + 8 } : { left: 8, bottom: 48 })
    setPop(next)
  }

  const remove = (page: SidebarPage): void => run(t('sidebar.SpaceBar.nao_foi_possivel_apagar_o_espa'), api.pages.remove(page.id))

  return (
    <div className="space-bar" ref={row}>
      <div className="space-icons" role="group" aria-label={t('sidebar.SpaceBar.espacos')}>
        {sidebar.pages.map((page) => {
          const active = page.id === sidebar.activePage
          const count = sidebar.workspaces.filter((w) => (w.pageId ?? HOME_PAGE_ID) === page.id).length
          return (
            <button
              key={page.id}
              type="button"
              className={`space-icon${active ? ' active' : ''}`}
              aria-current={active ? 'true' : undefined}
              aria-label={page.name}
              title={`${t('sidebar.SpaceBar.nome_n_workspaces', { name: page.name, count })}${active ? ` ${t('sidebar.SpaceBar.clique_para_editar')}` : ''}`}
              style={active ? { color: page.color ?? 'var(--sidebar-fg)' } : undefined}
              onClick={() => (active ? open({ kind: 'edit', page }) : run(t('sidebar.SpaceBar.nao_foi_possivel_trocar_de_esp'), api.pages.switch(page.id)))}
              onContextMenu={(e) => onMenu(e, [
                { label: t('sidebar.SpaceBar.editar_espaco'), icon: <Pencil size={14} />, run: () => open({ kind: 'edit', page }) },
                { label: t('sidebar.SpaceBar.excluir_espaco'), icon: <Trash2 size={14} />, danger: true, disabled: page.id === HOME_PAGE_ID, run: () => remove(page) }
              ])}
            >
              <Glyph icon={page.icon} color={active ? page.color ?? undefined : undefined} size={13} />
            </button>
          )
        })}
      </div>
      <button type="button" className="space-new" title={t('sidebar.SpaceBar.novo_espaco')} aria-label={t('sidebar.SpaceBar.novo_espaco')} onClick={() => open({ kind: 'new' })}>
        <Plus size={14} strokeWidth={2.25} />
      </button>

      {pop && anchor && (
        <>
          <div className="top-menu-back" onPointerDown={() => setPop(null)} />
          <div className="space-pop" role="dialog" aria-label={pop.kind === 'new' ? t('sidebar.SpaceBar.novo_espaco') : t('sidebar.SpaceBar.editar_espaco')} style={{ left: anchor.left, bottom: anchor.bottom }}>
            <h2>{pop.kind === 'new' ? t('sidebar.SpaceBar.novo_espaco') : t('sidebar.SpaceBar.editar_espaco')}</h2>
            {pop.kind === 'new' ? (
              <PageForm
                initial={{ name: 'Novo espaço', icon: 'folder', color: null }}
                submit={t('sidebar.SpaceBar.criar')}
                onSubmit={(v) => {
                  setPop(null)
                  run(t('sidebar.SpaceBar.nao_foi_possivel_criar_o_espac'), api.pages.create({ name: v.name, icon: v.icon, ...(v.color ? { color: v.color } : {}) }).then((id) => api.pages.switch(id)))
                }}
              />
            ) : (
              <>
                <PageForm
                  key={pop.page.id}
                  initial={{ name: pop.page.name, icon: pop.page.icon, color: pop.page.color ?? null }}
                  submit={t('sidebar.SpaceBar.salvar')}
                  onSubmit={(v) => { setPop(null); run(t('sidebar.SpaceBar.nao_foi_possivel_salvar_o_espa'), api.pages.edit(pop.page.id, { name: v.name, icon: v.icon, color: v.color })) }}
                />
                {pop.page.id !== HOME_PAGE_ID && (
                  <button type="button" className="space-delete" onClick={() => { setPop(null); remove(pop.page) }}>
                    <Trash2 size={13} /> {t('sidebar.SpaceBar.excluir_espaco_destino', { name: sidebar.pages[0]?.name ?? '' })}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
