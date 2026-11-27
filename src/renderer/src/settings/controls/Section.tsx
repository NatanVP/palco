import { useId, type ReactNode } from 'react'

/** Uma seção das Configurações: título em caixa alta, opcionalmente um botão ao lado, e o conteúdo. */
export function SettingsSection({ title, accessory, children }: { title: string; accessory?: ReactNode; children: ReactNode }) {
  const id = useId()
  return <section className="settings-section" aria-labelledby={id}>
    <div className="settings-section-head"><h3 id={id} className="settings-section-title">{title}</h3>{accessory}</div>
    <div className="settings-section-body">{children}</div>
  </section>
}
export const SettingsDivider = () => <hr className="settings-divider" />
