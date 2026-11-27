import type { ModelId, VoiceProgress } from '../../../shared/voice'
import { t } from '../i18n'

export const megabytes = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`
export const modelName = (id: ModelId): string => (id === 'base' ? t('voice.model.base') : id === 'small' ? t('voice.model.small') : t('voice.model.smallQ5'))
export const stage = (p: VoiceProgress): string => (p.what === 'runtime' ? t('voice.downloading.runtime') : t('voice.downloading.model'))
/** O erro do main chega embrulhado pelo Electron; só a mensagem interessa. */
export const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
