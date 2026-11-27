import type { ActionDef } from '../options'

/** Botão que não é preferência (Alterar…, Gerenciar Backups…): desabilitado com o motivo até o bloco dono entregar o efeito. */
export function ActionRow({ def }: { def: ActionDef }) {
  const id = `action-${def.section}-${def.label}`.replace(/\W+/g, '-')
  return <div className="settings-option" data-action={def.label}>
    <div className="settings-row"><span className="settings-label">{def.label}</span>
      <button type="button" aria-describedby={id} disabled={!def.ready}>{def.label}</button></div>
    {(def.hint || def.pending) && <small id={id}>{def.ready ? def.hint : def.pending}</small>}
  </div>
}
