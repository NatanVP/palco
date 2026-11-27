#!/usr/bin/env node
// Gera src/shared/third-party-notices.json: o aviso de licença de tudo o que vai dentro do app (dependências de execução, com as
// delas, e o Electron). Os textos saem dos próprios pacotes instalados. Rode `npm run notices` quando as dependências mudarem.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LICENSE_FILE = /^(licen[sc]e|copying|notice)/i
/** Licença que o package.json não declara; conferida no arquivo de licença do pacote. */
const DECLARED = { khroma: 'MIT' }
/** Pacotes publicados sem o arquivo, cujo texto está em outro pacote do mesmo repositório. */
const SAME_REPOSITORY = { '@xterm/addon-serialize': '@xterm/xterm', '@xterm/headless': '@xterm/xterm' }
/** Código de terceiros que vem dentro de um pacote, com licença própria. */
const BUNDLED_INSIDE = { 'node-pty': ['deps/winpty/LICENSE'] }
const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`
const manifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const clean = (text) => text.replace(/\r\n/g, '\n').trim() + '\n'
const licenseFiles = (dir) => readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile()).sort().map((f) => join(dir, f))

/** Como o Node resolve: o node_modules mais próximo, subindo até a raiz do projeto. */
function find(root, name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dir === root || dir === dirname(dir)) return null
  }
}

export function collectNotices(root) {
  const found = new Map()
  const visit = (name, from, optional) => {
    const dir = find(root, name, from)
    if (!dir) { if (optional) return; throw new Error(`dependência não instalada: ${name}`) }
    const p = manifest(dir), key = `${p.name}@${p.version}`
    if (found.has(key)) return
    found.set(key, { dir, p })
    for (const next of Object.keys(p.dependencies ?? {})) visit(next, dir, false)
    for (const next of Object.keys(p.optionalDependencies ?? {})) visit(next, dir, true)
  }
  for (const name of Object.keys(manifest(root).dependencies ?? {})) visit(name, root, false)

  const texts = [], index = (text) => { const at = texts.indexOf(text); return at >= 0 ? at : texts.push(text) - 1 }
  const entry = ({ dir, p }) => {
    let files = licenseFiles(dir), note
    if (!files.length && SAME_REPOSITORY[p.name]) {
      files = licenseFiles(find(root, SAME_REPOSITORY[p.name], root))
      note = `O pacote não traz o arquivo; texto de ${SAME_REPOSITORY[p.name]}, do mesmo repositório.`
    }
    files.push(...(BUNDLED_INSIDE[p.name] ?? []).map((f) => join(dir, f)))
    const license = DECLARED[p.name] ?? (typeof p.license === 'string' ? p.license : undefined)
    if (!license) throw new Error(`pacote sem licença declarada: ${p.name}`)
    const own = files.map((f) => clean(readFileSync(f, 'utf8')))
    if (!own.length) {
      const author = typeof p.author === 'string' ? p.author : p.author?.name
      if (license !== 'MIT' || !author) throw new Error(`pacote sem texto de licença: ${p.name} (${license})`)
      own.push(MIT(author.replace(/\s*[<(].*$/, '')))
      note = 'O pacote não traz o arquivo; texto padrão da licença MIT com o autor declarado nele.'
    }
    return { name: p.name, version: p.version, license, texts: own.map(index), ...(note ? { note } : {}) }
  }

  // O Electron é dependência de desenvolvimento no package.json, mas é o runtime distribuído com o app.
  const electron = find(root, 'electron', root)
  const runtime = [...found.values()].filter(({ p }) => !p.name.startsWith('@types/'))
  runtime.push({ dir: electron, p: manifest(electron) })
  const order = (a, b) => a.p.name.localeCompare(b.p.name, 'en') || a.p.version.localeCompare(b.p.version, 'en', { numeric: true })
  return { packages: runtime.sort(order).map(entry), texts }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..'), notices = collectNotices(root)
  writeFileSync(join(root, 'src/shared/third-party-notices.json'), JSON.stringify(notices, null, 1) + '\n')
  console.log(`${notices.packages.length} pacotes, ${notices.texts.length} textos de licença`)
}
