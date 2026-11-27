import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import type { TerminalNode } from '../../../shared/model'
import { toXtermTheme } from '../../../shared/terminal-themes'
import { terminalLook } from '../nodes/look'
import { TerminalFeed } from '../nodes/terminal-feed'
import { terminalHandle } from '../nodes/terminal-registry'
import { useAppearanceIsLight, usePreferences } from '../settings/preferences'

/** Altura da prévia, em linhas do terminal. */
const WINDOW = 12

/** Primeira linha da janela: ela mostra o pé do que há na tela (último texto ou cursor, o que estiver mais baixo). */
export function previewTop(line: (row: number) => string, cursor: number, rows: number, height: number): number {
  let end = cursor
  for (let row = rows - 1; row > end; row--) if (line(row).trim() !== '') { end = row; break }
  return Math.max(0, end - height + 1)
}

export type MirrorLook = Pick<TerminalNode, 'fontFamily' | 'fontSize' | 'themeId' | 'darkThemeId'>

/**
 * A prévia do chat: o próprio terminal, só de leitura. Um segundo xterm com a mesma fonte, cores e colunas, alimentado pelo
 * mesmo fluxo do PTY; ele nunca escreve no processo nem muda o tamanho dele.
 */
export function TerminalMirror({ id, label, look = {} }: { id: string; label: string; look?: MirrorLook }) {
  const preferences = usePreferences()
  const light = useAppearanceIsLight()
  const { fontFamily, fontSize, theme } = terminalLook(look, preferences, light)
  const colors = JSON.stringify(theme)
  const box = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null)
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => {
    const el = host.current!, frame = box.current!
    const term = new Terminal({ fontFamily, fontSize, theme: toXtermTheme(themeRef.current), disableStdin: true, cursorBlink: false, scrollback: 0 })
    term.open(el)
    let disposed = false
    /** Mostra só o pé da tela, encolhida quando o chat é mais estreito que o terminal. */
    const place = (): void => {
      if (disposed) return
      const screen = el.querySelector<HTMLElement>('.xterm-screen')
      if (!screen?.offsetHeight) return
      const buffer = term.buffer.active
      const top = previewTop((row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '', buffer.cursorY, term.rows, WINDOW)
      const scale = Math.min(1, frame.clientWidth / screen.offsetWidth || 1), cell = (screen.offsetHeight / term.rows) * scale
      el.style.transform = `translateY(${-top * cell}px) scale(${scale})`
      frame.style.height = `${Math.min(WINDOW, term.rows - top) * cell}px`
    }
    const resize = (size: { cols?: number; rows?: number } | undefined): void => {
      if (size?.cols && size.rows && (size.cols !== term.cols || size.rows !== term.rows)) term.resize(size.cols, size.rows)
    }
    const feed: TerminalFeed = new TerminalFeed({
      write: (data) => term.write(data, place),
      reset: () => term.reset(),
      requestAttach: () => { void window.palco.terminal.attach(id).then((snap) => { if (disposed) return; resize(snap); feed.applySnapshot(snap) }).catch(() => {}) }
    })
    const off = window.palco.terminal.onData((from, data, seq, gen) => {
      if (from !== id) return
      // O terminal de verdade manda no tamanho: a prévia o segue antes de desenhar o que chegou.
      resize(terminalHandle(id)?.size?.())
      feed.onData(data, seq, gen)
    })
    feed.start()
    const observer = new ResizeObserver(place)
    observer.observe(frame)
    return () => { disposed = true; observer.disconnect(); off(); term.dispose(); el.replaceChildren() }
  }, [id, fontFamily, fontSize, colors])
  return <div ref={box} className="chat-preview" role="img" aria-label={label} style={{ background: theme.colors.background }}><div ref={host} className="chat-preview-screen" /></div>
}
