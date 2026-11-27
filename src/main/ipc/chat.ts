import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { isThreadColor, type ThreadColor } from '../../shared/chat'
import type { IpcArea } from './area'

export const CHAT_CH = {
  state: 'palco:chat:state', older: 'palco:chat:older', send: 'palco:chat:send', interrupt: 'palco:chat:interrupt', acknowledge: 'palco:chat:acknowledge', markRead: 'palco:chat:markRead',
  switchThread: 'palco:chat:switchThread', clearThread: 'palco:chat:clearThread', clearHistory: 'palco:chat:clearHistory', deleteEntry: 'palco:chat:deleteEntry', attachment: 'palco:chat:attachment', preview: 'palco:chat:preview',
  changed: 'palco:chat:changed'
} as const
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }
const id = (v: unknown): string => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(v)) throw new Error('terminal inválido'); return v }
const thread = (v: unknown): ThreadColor => { if (!isThreadColor(v)) throw new Error('tópico inválido'); return v }

/** Chat do terminal: estado, envio, interrupção, tópicos e anexos. O agente escreve pelo `palco say` (rota do socket), não por aqui. */
export const chatArea: IpcArea = ({ handle, send, deps }) => {
  const chat = () => { if (!deps.chat) throw new Error('chat indisponível'); return deps.chat }
  handle(CHAT_CH.state, (t, th) => chat().state(id(t), th === undefined ? undefined : thread(th)))
  handle(CHAT_CH.older, (t, th, before) => { if (typeof before !== 'string') throw new Error('mensagem inválida'); return chat().older(id(t), thread(th), before) })
  handle(CHAT_CH.send, (t, raw) => {
    const o = raw as { text?: unknown; attachments?: unknown } | null
    if (!o || typeof o.text !== 'string' || o.text.length > 200_000 || (o.attachments !== undefined && (!Array.isArray(o.attachments) || o.attachments.length > 10 || o.attachments.some(p => typeof p !== 'string')))) throw new Error('mensagem inválida')
    return chat().send(id(t), { text: o.text, attachments: (o.attachments as string[] | undefined) ?? [] })
  })
  handle(CHAT_CH.preview, t => chat().preview(id(t)))
  handle(CHAT_CH.interrupt, t => chat().interrupt(id(t)))
  handle(CHAT_CH.acknowledge, t => { chat().acknowledgeAttention(id(t)) })
  handle(CHAT_CH.markRead, t => { chat().markRead(id(t)) })
  handle(CHAT_CH.switchThread, (t, th) => { chat().switchThread(id(t), thread(th)) })
  handle(CHAT_CH.clearThread, (t, th) => { chat().clearThread(id(t), thread(th)) })
  handle(CHAT_CH.clearHistory, t => { chat().clearHistory(id(t)) })
  handle(CHAT_CH.deleteEntry, (t, th, entry) => { if (typeof entry !== 'string') throw new Error('mensagem inválida'); chat().deleteEntry(id(t), thread(th), entry) })
  /** Imagem do histórico como data URL (a janela não lê arquivos do disco). Só imagens, só do histórico do próprio terminal. */
  handle(CHAT_CH.attachment, (t, attachmentId) => {
    if (typeof attachmentId !== 'string') throw new Error('anexo inválido')
    const path = chat().attachmentPath(id(t), attachmentId)
    const mime = path ? MIME[extname(path).toLowerCase()] : undefined
    if (!path || !mime) return null
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`
  })
  return deps.chat?.onChange(e => send(CHAT_CH.changed, e.terminalId))
}
