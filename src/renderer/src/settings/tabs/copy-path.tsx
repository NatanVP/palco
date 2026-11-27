import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { t } from '../../i18n'

/** "Copiar Caminho": o ícone vira ✓ por um instante. Sem caminho, fica desabilitado. */
export function CopyPathButton({ path, onError }: { path: string | null; onError(message: string): void }) {
  const [copied, setCopied] = useState(false), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { clearTimeout(timer.current); setCopied(false) }, [path])
  const copy = (): void => {
    if (!path) return
    void navigator.clipboard.writeText(path).then(() => { setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1500) }).catch(() => onError(t('settings.agentes.nao_foi_possivel_copiar')))
  }
  const Icon = copied ? Check : Copy
  return <button type="button" disabled={!path} title={path ?? undefined} onClick={copy}><Icon size={12} aria-hidden="true" />{copied ? t('settings.agentes.copiado') : t('settings.agentes.copiar_caminho')}</button>
}
