import { matchesZoomWheel, usePreferences } from '../settings/preferences'
import { useCallback, useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Markdown } from '../chat/Markdown'
import { t } from '../i18n'

type Content = { kind: 'text' | 'image' | 'binary'; data: string; truncated: boolean }

/** Arquivo do disco, só leitura: imagem ou as primeiras 400 linhas de texto (o main aplica os tetos). */
export function FileView({ path }: { path: string }) {
  const prefs = usePreferences()
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    window.palco.files.read(path).then(setContent).catch((err: unknown) => {
      setContent(null)
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    })
  }, [path])
  useEffect(load, [load])

  return (
    <div className="filebox" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => !matchesZoomWheel(e.nativeEvent) && e.stopPropagation()}>
      <div className="file-bar" title={path}>
        <span className="file-path">{`\u200e${path}\u200e`}</span>
        {content?.truncated && <span className="file-flag">{content.data === '' ? t('nodes.FileView.acima_de_2_mb') : t('nodes.FileView.primeiras_400_linhas')}</span>}
        <button className="icon-btn" title={t('nodes.FileView.recarregar')} onClick={load}><RotateCw size={12} /></button>
      </div>
      <div className="file-body">
        {error && <div className="file-msg">{t('nodes.FileView.nao_foi_possivel_ler', { error })}</div>}
        {content?.kind === 'image' && content.data !== '' && <img className="file-image" src={content.data} alt={path} draggable={false} />}
        {content?.kind === 'text' && content.data !== '' && prefs.fileEditorRendersMarkdown && /\.(md|markdown)$/i.test(path) && <div className="file-markdown" style={{ fontSize: prefs.fileEditorFontSize }}><Markdown source={content.data} /></div>}
        {content?.kind === 'text' && content.data !== '' && !(prefs.fileEditorRendersMarkdown && /\.(md|markdown)$/i.test(path)) && <pre className="file-text" style={{ fontFamily: prefs.fileEditorFontFamily, fontSize: prefs.fileEditorFontSize, tabSize: prefs.fileEditorTabWidth }}>{content.data}</pre>}
        {content?.kind === 'binary' && <div className="file-msg">{t('nodes.FileView.arquivo_binario_sem_previa')}</div>}
        {content && content.data === '' && content.kind !== 'binary' && <div className="file-msg">{content.truncated ? t('nodes.FileView.arquivo_grande_demais_para_mos') : t('nodes.FileView.arquivo_vazio')}</div>}
      </div>
    </div>
  )
}
