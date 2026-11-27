// Gera os ícones do palco a partir de resources/icons-src (precisa do ImageMagick, `magick`).
// Não instala nada no sistema: para o lançador do Linux, use `npm run install:desktop`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'resources/icons-src'), out = join(root, 'resources/icons')
const run = (args) => { const r = spawnSync('magick', args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || 'ImageMagick falhou') }
mkdirSync(out, { recursive: true })

// Uma única arte (o terminal com a cortina) em todos os tamanhos.
for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  run([join(src, 'palco-app.png'), '-filter', 'Lanczos', '-resize', `${n}x${n}`, '-define', 'png:color-type=6', join(out, `palco-${n}.png`)])
}
// Bandeja: silhueta preta (tema claro) e branca (tema escuro), 32 px e @2x.
for (const [name, negate] of [['black', false], ['white', true]]) {
  for (const [suffix, n] of [['', 32], ['@2x', 64]]) {
    run([join(src, 'palco-tray.png'), '-trim', '-gravity', 'center', '-background', 'none', '-resize', `${n - 4}x${n - 4}`, '-extent', `${n}x${n}`, ...(negate ? ['-channel', 'RGB', '-negate', '+channel'] : []), '-strip', '-define', 'png:color-type=6', join(out, `palco-tray-${name}${suffix}.png`)])
  }
}
run([...[16, 24, 32, 48, 64, 128, 256].map((n) => join(out, `palco-${n}.png`)), join(out, 'palco.ico')])
// ICNS montado à mão: cada bloco é um PNG.
const types = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }, chunks = []
for (const [n, type] of Object.entries(types)) {
  const data = readFileSync(join(out, `palco-${n}.png`)), head = Buffer.alloc(8)
  head.write(type); head.writeUInt32BE(data.length + 8, 4); chunks.push(head, data)
}
const body = Buffer.concat(chunks), head = Buffer.alloc(8)
head.write('icns'); head.writeUInt32BE(body.length + 8, 4)
writeFileSync(join(out, 'palco.icns'), Buffer.concat([head, body]))
console.log('Ícones gerados em resources/icons.')
