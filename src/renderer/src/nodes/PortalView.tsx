import { createElement, useEffect, useRef, useState, type FormEvent } from 'react'
import type { PortalNode } from '../../../shared/model'
import { portalPartitionFor } from '../../../shared/portal-settings'
import { t } from '../i18n'

/** O que o renderer usa do elemento <webview> do Electron. */
interface WebviewElement extends HTMLElement {
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  getURL(): string
  goBack(): void
  reload(): void
  setAudioMuted?(muted: boolean): void
}

/** Endereço digitado na barra: sem esquema vira https; só http, https e file passam. */
export function normalizePortalUrl(input: string): string | null {
  const text = input.trim()
  if (text === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(\/|$)/.test(text) ? text : `https://${text}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' ? u.href : null
  } catch {
    return null
  }
}

/**
 * Nó portal: navegador isolado (<webview>, partição do armazenamento escolhido, sem preload). O main controla a página
 * pelo `webContents`; aqui só avisamos qual webContents pertence ao nó e mostramos a barra de endereço.
 * Trocar o armazenamento ou o agente de usuário recria o webview (a partição só vale na criação), que recarrega a página.
 */
export function PortalView({ node, workspaceId, onFocus }: { node: PortalNode; workspaceId: string; onFocus?(): void }) {
  const partition = portalPartitionFor(node.storage, node.id, workspaceId)
  return <PortalSurface key={`${partition}|${node.userAgent ?? ''}`} node={node} partition={partition} onFocus={onFocus} />
}

function PortalSurface({ node, partition, onFocus }: { node: PortalNode; partition: string; onFocus?(): void }) {
  const view = useRef<WebviewElement | null>(null)
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  // O src só vale na criação: depois, quem navega é a barra (ou o agente, pelo main). Reaplicar node.url recarregaria a página.
  const initialUrl = useRef(node.url)
  const [address, setAddress] = useState(node.url)
  const [problem, setProblem] = useState<string | null>(null)

  // "Silenciar": vale na hora e de novo a cada página carregada (antes do dom-ready o webview recusa a chamada).
  useEffect(() => {
    const el = view.current
    if (!el) return
    const apply = (): void => { try { el.setAudioMuted?.(node.muted === true) } catch { /* ainda sem guest */ } }
    apply()
    el.addEventListener('dom-ready', apply)
    return () => el.removeEventListener('dom-ready', apply)
  }, [node.muted])

  useEffect(() => {
    const el = view.current
    if (!el) return
    const register = (): void => {
      try {
        window.palco.portal.register(node.id, el.getWebContentsId())
      } catch {
        /* ainda sem guest: o próximo dom-ready tenta de novo */
      }
    }
    const navigated = (event: Event): void => {
      const url = (event as Event & { url?: string }).url
      if (typeof url !== 'string' || url === '') return
      setAddress(url)
      setProblem(null)
      if (url !== node.url) void window.palco.node.patch(node.id, { url }).catch(() => {})
    }
    const failed = (event: Event): void => {
      const e = event as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      if (e.isMainFrame && e.errorCode !== -3) setProblem(e.errorDescription ?? t('nodes.PortalView.falha_ao_carregar'))
    }
    const focused = (): void => onFocusRef.current?.()
    el.addEventListener('dom-ready', register)
    el.addEventListener('did-attach', register)
    el.addEventListener('did-navigate', navigated)
    el.addEventListener('did-navigate-in-page', navigated)
    el.addEventListener('did-fail-load', failed)
    el.addEventListener('focus', focused)
    return () => {
      el.removeEventListener('dom-ready', register)
      el.removeEventListener('did-attach', register)
      el.removeEventListener('did-navigate', navigated)
      el.removeEventListener('did-navigate-in-page', navigated)
      el.removeEventListener('did-fail-load', failed)
      el.removeEventListener('focus', focused)
    }
  }, [node.id, node.url])

  const go = (event: FormEvent): void => {
    event.preventDefault()
    const url = normalizePortalUrl(address)
    if (url === null) {
      setProblem(t('nodes.PortalView.use_um_endereco_http_https_ou_'))
      return
    }
    setProblem(null)
    view.current?.loadURL(url).catch(() => {})
  }

  return (
    <div className="portalbox" onPointerDown={(e) => e.stopPropagation()}>
      <form className="portal-bar" hidden={node.chromeHidden === true} onSubmit={go}>
        <button type="button" title={t('nodes.PortalView.voltar')} onClick={() => view.current?.goBack()}>
          ‹
        </button>
        <button type="button" title={t('nodes.PortalView.recarregar')} onClick={() => view.current?.reload()}>
          ↻
        </button>
        <input value={address} spellCheck={false} onChange={(e) => setAddress(e.target.value)} aria-label={t('nodes.PortalView.endereco')} />
        <button type="submit">{t('nodes.PortalView.ir')}</button>
      </form>
      {problem && <div className="portal-problem">{problem}</div>}
      {createElement('webview', {
        ref: view,
        className: 'portal-view',
        src: initialUrl.current,
        partition,
        ...(node.userAgent ? { useragent: node.userAgent } : {})
      })}
    </div>
  )
}
