import type { PartituraReview } from '../../../shared/partitura-review'
import { t } from '../i18n'

/** Caracteres de controle, invisíveis e de inversão de texto aparecem escritos: o comando mostrado é o que vai rodar. */
export const visible = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, c => `\\u{${c.charCodeAt(0).toString(16)}}`)

/** O que a partitura faz ao ser inserida: cada terminal com comando, pasta e ambiente, e o que ela abre. */
export function PartituraReviewList({ items }: { items: PartituraReview[] }) {
  return <div className="partitura-review-list">{items.map(item => <section key={item.name}>
    <h3>{visible(item.name)}</h3>
    {!item.terminals.length && <p>{t('partituras.review.noTerminals')}</p>}
    {item.terminals.map((terminal, i) => <dl key={i}>
      <dt>{visible(terminal.name)} · {terminal.agent}{terminal.maestro && <strong> · {t('partituras.review.maestro')}</strong>}</dt>
      <dd><span>{t('partituras.review.command')}</span>{terminal.command ? <code>{visible(terminal.command)}</code> : <em>{t('partituras.review.plainShell')}</em>}</dd>
      <dd><span>{t('partituras.review.folder')}</span>{visible(terminal.cwd) || '—'}</dd>
      <dd><span>{t('partituras.review.environment')}</span>{visible(terminal.environment)}</dd>
      {terminal.environmentUser !== undefined && <dd><span>{t('partituras.review.environmentUser')}</span>{terminal.environmentUser ? <code>{visible(terminal.environmentUser)}</code> : <em>{t('partituras.review.defaultUser')}</em>}</dd>}
      {terminal.role !== undefined && <dd><span>{t('partituras.review.role')}</span>{visible(terminal.role)}</dd>}
    </dl>)}
    {item.portals.length > 0 && <><h4>{t('partituras.review.portals')}</h4><ul>{item.portals.map((url, i) => <li key={i}>{visible(url)}</li>)}</ul></>}
    {item.paths.length > 0 && <><h4>{t('partituras.review.paths')}</h4><ul>{item.paths.map((path, i) => <li key={i}>{visible(path)}</li>)}</ul></>}
  </section>)}</div>
}
