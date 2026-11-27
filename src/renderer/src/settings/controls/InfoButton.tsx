import { useId, useState } from 'react'
import { Info } from 'lucide-react'

/** O ícone (i) ao lado do rótulo: a explicação aparece ao passar o mouse e fica aberta com um clique; Esc fecha. */
export function InfoButton({ label, text }: { label: string; text: string }) {
  const [hover, setHover] = useState(false), [pinned, setPinned] = useState(false), id = useId()
  const open = hover || pinned, close = (): void => { setHover(false); setPinned(false) }
  return <span className="settings-info" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
    <button type="button" className="settings-info-button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
      onClick={() => { if (pinned) close(); else setPinned(true) }} onBlur={close} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); close() } }}><Info size={14} aria-hidden="true" /></button>
    {open && <span role="tooltip" id={id} className="settings-popover">{text}</span>}
  </span>
}
