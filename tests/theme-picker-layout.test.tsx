import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// O happy-dom não mede texto: aqui se garante a regra; a medida (nenhum nome cortado) é conferida no app real.
const css = readFileSync('src/renderer/src/settings/settings.css', 'utf8')
const rule = (selector: string): string => { const at = css.indexOf(selector + ' {'); expect(at, selector).toBeGreaterThanOrEqual(0); return css.slice(at, css.indexOf('}', at)) }

it('o diálogo é largo o bastante e vence a largura de 380 px das confirmações', () => {
  const width = /width: min\((\d+)px, 92vw\)/.exec(rule('.settings-confirm-back .settings-confirm.theme-modal'))
  expect(Number(width?.[1])).toBeGreaterThanOrEqual(560)
})
it('o nome do tema nunca é cortado com reticências: se faltar espaço, quebra a linha', () => {
  const name = rule('.settings-confirm-back .theme-modal .theme-card > span:last-child')
  expect(name).not.toMatch(/ellipsis|nowrap|overflow: hidden/)
  expect(name).toContain('overflow-wrap')
})
it('a grade continua com quatro colunas iguais', () => {
  expect(rule('.settings-confirm-back .theme-modal .theme-grid')).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
})
