// Instala o lançador do palco no Linux para o usuário atual (~/.local/share), apontando para este checkout.
// Opcional e manual: `npm run install:desktop` (e `npm run install:desktop -- --remove` para desfazer).
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

if (process.platform !== 'linux') { console.log('Só para Linux.'); process.exit(0) }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data = process.env.XDG_DATA_HOME || join(process.env.HOME ?? '', '.local/share')
const id = 'palco', sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const desktop = join(data, 'applications', `${id}.desktop`)
if (process.argv.includes('--remove')) {
  rmSync(desktop, { force: true })
  for (const n of sizes) rmSync(join(data, 'icons/hicolor', `${n}x${n}`, 'apps', `${id}.png`), { force: true })
  console.log('Lançador do palco removido.'); process.exit(0)
}
if (!existsSync(join(root, 'out/main/index.js'))) { console.error('Rode npm run build antes.'); process.exit(1) }
const electron = createRequire(import.meta.url)('electron')
const quote = (s) => `"${String(s).replace(/(["\\`$])/g, '\\$1')}"`
for (const n of sizes) {
  const dir = join(data, 'icons/hicolor', `${n}x${n}`, 'apps'); mkdirSync(dir, { recursive: true })
  copyFileSync(join(root, 'resources/icons', `palco-${n}.png`), join(dir, `${id}.png`))
}
mkdirSync(dirname(desktop), { recursive: true })
writeFileSync(desktop, ['[Desktop Entry]', 'Type=Application', 'Name=palco', 'Comment=Canvas para agentes de código',
  `Exec=${quote(electron)} ${quote(root)} %U`, `Icon=${id}`, 'Terminal=false', 'Categories=Development;', `StartupWMClass=${id}`, ''].join('\n'), { mode: 0o644 })
console.log(`Lançador instalado: ${desktop}`)
