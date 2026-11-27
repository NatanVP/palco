import 'katex/dist/katex.min.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { normalizeMath, safeHref } from './math'
import { t } from '../i18n'

const text = (node: ReactNode): string => (typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : '')

/** Diagrama Mermaid: a biblioteca só é carregada quando aparece o primeiro bloco; `securityLevel: strict` descarta script e HTML do diagrama. */
function MermaidBlock({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
      const { svg } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, source)
      if (alive && host.current) host.current.innerHTML = svg
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : t('chat.Markdown.diagrama_invalido')) })
    return () => { alive = false }
  }, [source])
  return error ? <pre className="chat-code" data-error>{source}</pre> : <div className="chat-mermaid" ref={host} role="img" aria-label={t('chat.Markdown.diagrama')} />
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="chat-codeblock">
    <div className="chat-code-bar"><span>{language || t('chat.Markdown.codigo')}</span>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}>{copied ? t('chat.Markdown.copiado') : t('chat.Markdown.copiar_codigo')}</button></div>
    <pre className="chat-code"><code>{code}</code></pre>
  </div>
}

const components: Components = {
  // Sem HTML cru: o conteúdo vem do agente. Imagens remotas não carregam (só texto alternativo); links só http(s), abertos pelo navegador do sistema.
  img: ({ alt }) => <span className="chat-img-alt">{alt ? t('chat.Markdown.imagem_alt', { alt }) : t('chat.Markdown.imagem')}</span>,
  a: ({ href, children }) => {
    const safe = safeHref(href)
    return safe ? <a href={safe} onClick={e => { e.preventDefault(); void window.palco.shell.openExternal(safe).catch(() => {}) }}>{children}</a> : <span>{children}</span>
  },
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const language = /language-([\w-]+)/.exec(className ?? '')?.[1] ?? ''
    const code = text(children).replace(/\n$/, '')
    if (!className && !code.includes('\n')) return <code className="chat-inline-code">{code}</code>
    return language === 'mermaid' ? <MermaidBlock source={code} /> : <CodeBlock language={language} code={code} />
  }
}

/** Markdown do agente: GFM (tabelas, listas de tarefa), código com Copiar, matemática TeX (KaTeX) e Mermaid. Nunca HTML cru. */
export function Markdown({ source }: { source: string }) {
  return <div className="chat-md"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]} components={components} skipHtml>{normalizeMath(source)}</ReactMarkdown></div>
}
