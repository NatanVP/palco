import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
it('o mínimo de Node acompanha o Electron e o lockfile, e a versão escolhida atende esse mínimo', () => {
  const pkg = json('package.json'), lock = json('package-lock.json'), electron = json('node_modules/electron/package.json')
  expect(pkg.engines?.node).toBe(electron.engines.node)
  expect(lock.packages[''].engines).toEqual(pkg.engines)
  const major = Number(readFileSync('.nvmrc', 'utf8').trim())
  expect(Number.isInteger(major)).toBe(true)
  expect(major).toBeGreaterThanOrEqual(Number(electron.engines.node.match(/\d+/)[0]))
})
it('o selo aponta para o workflow no repositório do palco', () => {
  const readme = readFileSync('README.md', 'utf8')
  // o selo fica no cabeçalho (antes da primeira seção) e o link leva ao workflow
  const cabecalho = readme.split('\n## ')[0]
  expect(cabecalho).toContain('https://github.com/NatanVP/palco/actions/workflows/ci.yml/badge.svg')
  expect(cabecalho).toMatch(/https:\/\/github\.com\/NatanVP\/palco\/actions\/workflows\/ci\.yml[")]/)
  expect(existsSync('.github/workflows/ci.yml')).toBe(true)
})
