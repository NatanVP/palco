import { useSyncExternalStore } from 'react'
import { getLocale, subscribeLocale } from '../../shared/i18n/runtime'

export { fmt, getLocale, subscribeLocale, t, tr } from '../../shared/i18n/runtime'
export type { MessageKey } from '../../shared/i18n/runtime'
/** O idioma em uso; quem chama re-renderiza quando ele troca. A raiz da App usa isto, então tudo o que depende de `t()` atualiza na hora. */
export const useLocale = () => useSyncExternalStore(subscribeLocale, getLocale, getLocale)
