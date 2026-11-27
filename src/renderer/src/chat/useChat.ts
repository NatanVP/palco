import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEntry, ChatState } from '../../../shared/chat'

/**
 * Estado do chat de um terminal: lê ao montar e a cada aviso do main; mensagens antigas carregadas sob demanda ficam à frente.
 * Resposta atrasada nunca passa por cima de uma mais nova, nem põe mensagens de um tópico em outro.
 */
export function useChat(terminalId: string): { state: ChatState | null; entries: ChatEntry[]; loadOlder(): Promise<void> } {
  const [state, setState] = useState<ChatState | null>(null)
  const [older, setOlder] = useState<ChatEntry[]>([])
  // `asked`/`shown`: última leitura pedida e última aplicada. `view` muda a cada tópico ou terminal exibido.
  const asked = useRef(0), shown = useRef(0), view = useRef(0), topic = useRef(''), olderAsked = useRef(0)
  const load = useCallback(() => {
    const request = ++asked.current
    void window.palco.chat.state(terminalId).then(s => {
      if (request <= shown.current) return
      shown.current = request
      const key = `${terminalId}:${s.thread}`
      if (topic.current !== key) { topic.current = key; view.current++; setOlder([]) }
      setState(s)
    }).catch(() => {})
  }, [terminalId])
  useEffect(() => {
    load()
    const off = window.palco.chat.onChange(id => { if (id === terminalId) load() })
    // O que estiver em voo deixa de valer.
    return () => { off(); shown.current = asked.current; view.current++; topic.current = ''; setState(null); setOlder([]) }
  }, [terminalId, load])
  const entries = state ? [...older, ...state.entries] : []
  const loadOlder = useCallback(async () => {
    const first = entries[0]
    if (!state || !first) return
    const from = view.current, request = ++olderAsked.current
    const page = await window.palco.chat.older(terminalId, state.thread, first.id)
    // Pedido repetido ou tópico trocado no caminho: a página não serve mais.
    if (from === view.current && request === olderAsked.current && page.length) setOlder(prev => [...page, ...prev])
  }, [entries, state, terminalId])
  return { state, entries, loadOlder }
}
