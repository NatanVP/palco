import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd(), icons = join(root, 'resources/icons')
const pngSize = (file: string): [number, number] => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)] }

describe("ícone do palco", () => {
  it('gera os PNG em cada tamanho, com o tamanho certo', () => {
    for (const n of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) expect(pngSize(join(icons, `palco-${n}.png`))).toEqual([n, n])
  })
  it('gera a bandeja preta e branca, em 1x e 2x', () => {
    for (const c of ['black', 'white']) {
      expect(pngSize(join(icons, `palco-tray-${c}.png`))).toEqual([32, 32])
      expect(pngSize(join(icons, `palco-tray-${c}@2x.png`))).toEqual([64, 64])
    }
  })
  it('gera ICO e ICNS válidos', () => {
    const ico = readFileSync(join(icons, 'palco.ico')), icns = readFileSync(join(icons, 'palco.icns'))
    expect(ico.readUInt16LE(2)).toBe(1); expect(ico.readUInt16LE(4)).toBe(7)
    expect(icns.toString('ascii', 0, 4)).toBe('icns'); expect(icns.readUInt32BE(4)).toBe(icns.length)
  })
  it('liga o ícone na janela e na bandeja', () => {
    expect(readFileSync(join(root, 'src/main/index.ts'), 'utf8')).toContain("icon: join(runtimePaths.icons, 'palco-512.png')")
    expect(readFileSync(join(root, 'src/main/index.ts'), 'utf8')).toContain('resolveRuntimePaths({ packaged: app.isPackaged')
    const ports = readFileSync(join(root, 'src/main/system/electron-ports.ts'), 'utf8')
    expect(ports).toContain('resolveRuntimePaths({ packaged: app.isPackaged')
    expect(ports).toContain('palco-tray-'); expect(ports).toContain("nativeTheme.on('updated'")
  })
  it('o script de ícones não instala nada no sistema; o lançador é opcional e manual', () => {
    const build = readFileSync(join(root, 'scripts/build-icons.mjs'), 'utf8')
    expect(build).not.toMatch(/\.local\/share|XDG_DATA_HOME|applications/)
    const install = readFileSync(join(root, 'scripts/install-desktop.mjs'), 'utf8')
    expect(install).toContain('StartupWMClass=${id}'); expect(install).toContain("const id = 'palco'")
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; scripts: Record<string, string> }
    expect(pkg.name).toBe('palco'); expect(pkg.scripts['install:desktop']).toBe('node scripts/install-desktop.mjs')
  })
})
