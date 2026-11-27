import { useEffect, useState } from 'react'

/** Terminais com turno concluído ainda não visto (o selo ✓ do card); vem do snapshot do sistema, sem consultar a tela. */
export function useCompletionBadges(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const api = window.palco?.system
    if (!api) return
    let alive = true, revision = 0
    const adopt = (s: { badgeTerminalIds: string[] }): void => { if (alive) setIds(new Set(s.badgeTerminalIds)) }
    const off = api.onChange((s) => { revision++; adopt(s) }), initial = revision
    void api.snapshot().then((s) => { if (initial === revision) adopt(s) }).catch(() => {})
    return () => { alive = false; off() }
  }, [])
  return ids
}
