/** Ditado local: o que a interface sabe do whisper.cpp e dos modelos instalados. */
export const VOICE_MODELS = ['base', 'small-q5', 'small'] as const
export type ModelId = (typeof VOICE_MODELS)[number]
export const VOICE_LANGUAGES = ['app', 'auto', 'pt', 'en', 'es'] as const
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]
export interface VoiceProgress { what: 'runtime' | 'model'; received: number; total: number }
export interface VoiceStatus {
  /** Há binário fixado para esta plataforma. */
  supported: boolean
  runtime: boolean
  /** Programa e modelo escolhido instalados. */
  ready: boolean
  runtimeSize: number
  selected: ModelId
  models: Array<{ id: ModelId; size: number; installed: boolean }>
}
/** Gravação mais longa aceita, em segundos. */
export const MAX_DICTATION_SECONDS = 600
