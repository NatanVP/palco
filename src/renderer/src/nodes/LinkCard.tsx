import { Link2 } from 'lucide-react'
import { linkText } from '../../../shared/link'
import type { LinkNode } from '../../../shared/model'
import { t } from '../i18n'

/**
 * Cartão de link: ícone, título e endereço. O duplo clique (navegador; com Shift, portal) é tratado no cabeçalho
 * do cartão, que captura o ponteiro no arrasto e por isso recebe o evento.
 */
export function LinkCard({ node, onOpen }: { node: LinkNode; onOpen(inPortal: boolean): void }) {
  const shown = linkText(node.url)
  return (
    <div
      className="link-card" role="link" tabIndex={0} title={node.url} aria-label={t('nodes.LinkCard.rotulo', { label: node.name === shown ? shown : `${node.name}, ${shown}` })}
      onKeyDown={(e) => { if (e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); e.stopPropagation(); onOpen(e.shiftKey) }}
    >
      <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="link-text"><span className="link-title">{node.name}</span><span className="link-url">{shown}</span></span>
    </div>
  )
}
