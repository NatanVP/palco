import type { InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked'> & { label?: string; checked: boolean; onChange(checked: boolean): void }
/** A chave deslizante das Configurações: por baixo é uma caixa nativa (teclado e leitor de tela de graça), desenhada como switch. */
export function Toggle({ label, checked, onChange, ...rest }: Props) {
  return <input {...rest} type="checkbox" role="switch" className="s-toggle" {...(label === undefined ? {} : { 'aria-label': label })} checked={checked} onChange={e => onChange(e.target.checked)} />
}
/** Marcador redondo para escolher itens de uma lista (preset ativo, responsabilidades selecionadas). */
export function CheckMark({ label, checked, onChange, ...rest }: Props) {
  return <input {...rest} type="checkbox" className="s-check" {...(label === undefined ? {} : { 'aria-label': label })} checked={checked} onChange={e => onChange(e.target.checked)} />
}
