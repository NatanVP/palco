import type { TerminalNode } from '../../../shared/model'
import { TerminalView } from '../nodes/TerminalView'
import { ChatView } from './ChatView'
import { t, tr } from '../i18n'
import { usePreferences } from '../settings/preferences'
import { formatBinding } from '../../../shared/shortcuts'

/** O card do terminal: o xterm fica sempre montado (o processo e a tela seguem vivos); em modo de chat a face de conversa vai por cima. */
export function TerminalFace({ node }: { node: TerminalNode }) {
  const chat = node.chatMode === true && node.agent !== 'shell'
  return <>
    <div className="terminal-face" style={chat ? { visibility: 'hidden', pointerEvents: 'none' } : undefined} aria-hidden={chat}><TerminalView id={node.id} fontSize={node.fontSize} fontFamily={node.fontFamily} themeId={node.themeId} darkThemeId={node.darkThemeId} /></div>
    {chat && <ChatView terminalId={node.id} name={node.name} showsShell={node.chatShowsShell !== false} look={{ fontFamily: node.chatFontFamily, fontSize: node.chatFontSize }} shell={node} />}
  </>
}

/** A combinação atual de "Alternar entre chat e terminal", para a dica e para `aria-keyshortcuts`. */
export function useChatShortcut(label: string): { title: string; keys: string | undefined } {
  const bindings = usePreferences().shortcuts.chatSwap.map((b) => formatBinding(b, tr('Espaço')))
  if (!bindings.length) return { title: label, keys: undefined }
  return { title: `${label} (${bindings.join(' / ')})`, keys: bindings.join(' ').replace(/Ctrl\/Cmd|Ctrl/g, 'Control') }
}

/** O botão do cabeçalho do card. */
export function ChatHeaderButton({ node }: { node: TerminalNode }) {
  const face = chatToggle(node), shortcut = useChatShortcut(face.label)
  return (
    <button type="button" className="chat-toggle" aria-pressed={face.chat} aria-label={face.label} title={shortcut.title} aria-keyshortcuts={shortcut.keys} onPointerDown={(e) => e.stopPropagation()} onClick={face.run}>
      {face.chat ? '⌨' : '💬'}
    </button>
  )
}

/** Alterna entre as duas faces (botões do cabeçalho e da barra). Só terminal de agente tem chat. */
export function chatToggle(node: TerminalNode): { visible: boolean; chat: boolean; label: string; run(): void } {
  const chat = node.chatMode === true
  return { visible: node.agent !== 'shell', chat, label: chat ? t('chat.TerminalFace.mostrar_terminal') : t('chat.TerminalFace.mostrar_chat'), run: () => { void window.palco.node.patch(node.id, { chatMode: !chat }) } }
}
