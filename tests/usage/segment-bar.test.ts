import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SegmentBar } from '../../src/renderer/src/usage/UsagePanel'

/** Regras do CSS para um seletor exato (todas as ocorrências, na ordem do arquivo). */
const css = readFileSync('src/renderer/src/styles.css', 'utf8')
const rules = (selector: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]!)
const last = (selector: string, prop: string): string | undefined => {
  let value: string | undefined
  for (const body of rules(selector)) for (const d of body.split(';')) {
    const [k, ...v] = d.split(':')
    if (k!.trim() === prop) value = v.join(':').trim()
  }
  return value
}

describe('barras segmentadas de uso', () => {
  it('pílulas lisas: raio cheio, sem raio menor depois', () => {
    expect(last('.usage-segments span', 'border-radius')).toBe('9999px')
  })

  it('grid de 36 colunas minmax(1px, 1fr), 26 px, espaço medido no contêiner externo', () => {
    expect(last('.usage-segments', 'grid-template-columns')).toBe('repeat(36, minmax(1px, 1fr))')
    expect(last('.usage-segments', 'gap')).toBe('max(1px, round(down, 1cqw, 1px))')
    expect(last('.usage-segments', 'height')).toBe('26px')
    expect(last('.usage-segments', 'container-type')).toBeUndefined()
    expect(last('.usage-segments-wrap', 'container-type')).toBe('inline-size')
  })

  it('painel com 340 px de largura para dimensionar o espaçamento relativo das barras', () => {
    expect(last('.usage-panel', 'width')).toBe('340px')
  })

  it('o grid fica dentro do contêiner e cada segmento é um span sem nada dentro (sem bola na ponta)', () => {
    const html = renderToStaticMarkup(createElement(SegmentBar, { fraction: 0.5, color: '#D97757' }))
    expect(html.startsWith('<div aria-hidden="true" class="usage-segments-wrap"><div class="usage-segments">')).toBe(true)
    const spans = html.match(/<span[^>]*><\/span>/g) ?? []
    expect(spans).toHaveLength(36)
    expect(spans.filter((s) => s.includes('70%, white'))).toHaveLength(18)
  })
})
