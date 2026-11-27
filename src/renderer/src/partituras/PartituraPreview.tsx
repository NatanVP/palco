import { useEffect, useState } from 'react'
import type { Partitura } from '../../../shared/model'

/** Miniatura do conteúdo persistido, sem executar comandos nem carregar portais. */
export function PartituraPreview({ name }: { name: string }) {
  const [partitura, setPartitura] = useState<Partitura | null>(null)
  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => window.palco.partitura.export(name)).then(document => {
      const p = JSON.parse(document).partituras[0] as Partitura
      if (live) setPartitura(p)
    }).catch(() => {})
    return () => { live = false }
  }, [name])
  const nodes = partitura?.nodes ?? []
  const width = Math.max(1, ...nodes.map(n => n.pos.x + n.size.w)), height = Math.max(1, ...nodes.map(n => n.pos.y + n.size.h))
  return <svg className="partitura-preview" viewBox={`-12 -12 ${width + 24} ${height + 24}`} aria-hidden="true">
    {partitura?.connections.map((c, i) => { const a = nodes.find(n => n.key === c.a), b = nodes.find(n => n.key === c.b); return a && b ? <line key={i} x1={a.pos.x + a.size.w / 2} y1={a.pos.y + a.size.h / 2} x2={b.pos.x + b.size.w / 2} y2={b.pos.y + b.size.h / 2} stroke="var(--muted)" strokeWidth={2} /> : null })}
    {nodes.map(n => <rect key={n.key} x={n.pos.x} y={n.pos.y} width={n.size.w} height={n.size.h} rx={8} fill={n.kind === 'note' ? 'var(--note)' : 'var(--accent)'} fillOpacity={.25} stroke="var(--muted)" />)}
  </svg>
}
