import { useCallback, useState } from 'react'
import type { ScoreAction } from '../canvas/menu-items'

type Selection = { mode: 'create' | 'update'; nodeIds: string[] }

/** Estado do painel de Partituras: todo pedido de abrir (barra, atalho, busca, botão direito) leva à tela certa, mesmo com ele aberto. */
export function useScorePanel() {
  const [shown, setShown] = useState(false)
  const [selection, setSelection] = useState<Selection>()
  const [request, setRequest] = useState(0)
  const open = useCallback((action: ScoreAction = 'open', nodeIds: string[] = []) => {
    setRequest(n => n + 1); setSelection(action === 'open' ? undefined : { mode: action, nodeIds }); setShown(true)
  }, [])
  return { shown, open, panel: { selection, request, onSelectionDone: () => setSelection(undefined), onClose: () => { setShown(false); setSelection(undefined) } } }
}
