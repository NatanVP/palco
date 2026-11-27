import { debouncedCopy } from './copy-on-select'
import { getPreferences, useAppearanceIsLight, usePreferences } from '../settings/preferences'
import { toXtermTheme } from '../../../shared/terminal-themes'
import { terminalLook } from './look'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { isGlobalShortcut } from '../shortcuts'
import { TerminalFeed } from './terminal-feed'
import { registerTerminal } from './terminal-registry'
import { t } from '../i18n'

/** Terminal xterm ligado ao PTY do main: snapshot + seq, descartando chunks já incluídos no snapshot. */
export function TerminalView({ id, fontSize: explicitFontSize, fontFamily: explicitFamily, themeId, darkThemeId }: { id: string; fontSize?: number; fontFamily?: string; themeId?: string; darkThemeId?: string }) {
  const preferences = usePreferences()
  const light = useAppearanceIsLight()
  const theme = terminalLook({ fontFamily: explicitFamily, fontSize: explicitFontSize, themeId, darkThemeId }, preferences, light).theme
  const family = explicitFamily ?? preferences.terminalFontFamily
  const themeRef = useRef(theme)
  themeRef.current = theme
  const fontSize = explicitFontSize ?? preferences.terminalFontSize
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null)
  const fontRef = useRef(fontSize)
  const familyRef = useRef(family)
  familyRef.current = family
  fontRef.current = fontSize
  const [exited, setExited] = useState<number | null>(null)

  // Fonte trocada na edição: aplica no xterm vivo e reajusta as colunas.
  useEffect(() => {
    const t = termRef.current
    if (!t || t.term.options.fontSize === fontSize) return
    t.term.options.fontSize = fontSize
    try { t.fit.fit() } catch { /* host ainda sem tamanho */ }
  }, [fontSize])

  // Tema (e o par claro/escuro) trocado nas Configurações: vale no terminal aberto, sem reiniciar.
  useEffect(() => { if (termRef.current) termRef.current.term.options.theme = toXtermTheme(theme) }, [theme])

  // Espaçamento do terminal: o FitAddon desconta o padding do contêiner, então basta reajustar as colunas.
  useEffect(() => { try { termRef.current?.fit.fit() } catch { /* host ainda sem tamanho */ } }, [preferences.terminalPaddingHorizontal, preferences.terminalPaddingVertical])

  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.term.options.fontFamily = family
    t.term.options.cursorBlink = preferences.terminalCursorBlink
    t.term.options.scrollback = preferences.terminalScrollback
    try { t.fit.fit() } catch { /* host still measuring */ }
  }, [family, preferences.terminalCursorBlink, preferences.terminalScrollback])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const term = new Terminal({
      fontFamily: familyRef.current,
      fontSize: fontRef.current,
      cursorBlink: getPreferences().terminalCursorBlink,
      scrollback: getPreferences().terminalScrollback,
      theme: toXtermTheme(themeRef.current)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    // Atalhos globais do app não vão ao PTY (Ctrl+Shift+L abre Partituras; Ctrl+L continua sendo do shell).
    term.attachCustomKeyEventHandler((e) => !isGlobalShortcut(e))
    // Foco do teclado neste terminal: o aviso de "Monitorar Atividade" dele fica calado enquanto isso.
    const onFocus = (): void => window.palco.terminal.setFocused(id)
    const onBlur = (): void => window.palco.terminal.setFocused(null)
    term.textarea?.addEventListener('focus', onFocus)
    term.textarea?.addEventListener('blur', onBlur)
    termRef.current = { term, fit }
    const unregister = registerTerminal(id, { selection: () => term.getSelection(), paste: (text) => term.paste(text), selectAll: () => term.selectAll(), focus: () => term.focus(), size: () => ({ cols: term.cols, rows: term.rows }) })

    let disposed = false
    const feed = new TerminalFeed({
      write: (d) => term.write(d),
      reset: () => {
        term.reset()
        setExited(null)
        // Processo novo (restart): reenvia o tamanho atual da tela, sem esperar o contêiner mudar.
        requestAnimationFrame(() => {
          if (disposed) return
          try { window.palco.terminal.resize(id, term.cols, term.rows) } catch { /* tela sem tamanho ainda */ }
        })
      },
      requestAttach: () => {
        void window.palco.terminal.attach(id).then((snap) => {
          if (!disposed) feed.applySnapshot(snap)
        })
      }
    })

    const offData = window.palco.terminal.onData((tid, data, seq, gen) => {
      if (tid === id) feed.onData(data, seq, gen)
    })
    const offExit = window.palco.terminal.onExit((tid, code) => {
      if (tid === id) setExited(code)
    })
    feed.start()

    const autoCopy = debouncedCopy((text) => void navigator.clipboard.writeText(text).catch(() => {}), 150)
    const selection = term.onSelectionChange(() => {
      if (getPreferences().copyOnSelect) autoCopy.push(term.getSelection())
    })
    const input = term.onData((d) => window.palco.terminal.write(id, d))
    const sync = (): void => {
      try {
        fit.fit()
        window.palco.terminal.resize(id, term.cols, term.rows)
      } catch {
        /* contêiner ainda sem tamanho */
      }
    }
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    sync()

    return () => {
      disposed = true
      unregister()
      ro.disconnect()
      selection.dispose()
      autoCopy.dispose()
      input.dispose()
      term.textarea?.removeEventListener('focus', onFocus)
      term.textarea?.removeEventListener('blur', onBlur)
      if (term.textarea && document.activeElement === term.textarea) window.palco.terminal.setFocused(null)
      offData()
      offExit()
      window.palco.terminal.detach(id)
      term.dispose()
    }
  }, [id])

  return (
    <div className="terminal-wrap" style={{ background: theme.colors.background, padding: 0 }}>
      <div className="terminal-host" ref={host} style={{ background: theme.colors.background, padding: `${preferences.terminalPaddingVertical}px ${preferences.terminalPaddingHorizontal}px` }} onPointerDown={(e) => {
        e.stopPropagation()
        // Na margem em volta do texto o xterm não pega o foco sozinho; sem isto o teclado ficaria no canvas.
        if (e.button !== 0 || e.target !== e.currentTarget) return
        e.preventDefault()
        termRef.current?.term.focus()
      }} />
      {exited !== null && (
        <div className="terminal-exited">
          <span>{t('nodes.TerminalView.processo_encerrado_codigo', { code: String(exited) })}</span>
          <button
            onClick={() => {
              setExited(null)
              void window.palco.terminal.restart(id)
            }}
          >
            {t('nodes.TerminalView.reiniciar')}
          </button>
        </div>
      )}
    </div>
  )
}
