import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRuntimePaths } from '../src/main/runtime-paths'

const root = process.cwd()

describe('caminhos do aplicativo instalado', () => {
  it('usa recursos fora do asar quando empacotado e a árvore do checkout em desenvolvimento', () => {
    expect(resolveRuntimePaths({ packaged: true, resourcesPath: '/opt/palco/resources', appPath: '/opt/palco/resources/app.asar' })).toEqual({
      cli: '/opt/palco/resources/palco-cli/bin/palco',
      cliBundle: '/opt/palco/resources/palco-cli/out/cli/palco.cjs',
      skills: '/opt/palco/resources/skills',
      icons: '/opt/palco/resources/icons'
    })
    expect(resolveRuntimePaths({ packaged: false, resourcesPath: '/unused', appPath: '/work/palco' })).toEqual({
      cli: '/work/palco/bin/palco', cliBundle: '/work/palco/out/cli/palco.cjs',
      skills: '/work/palco/resources/skills', icons: '/work/palco/resources/icons'
    })
  })

  it('mantém o lançador executável para os terminais', () => {
    expect(statSync(join(root, 'bin/palco')).mode & 0o111).not.toBe(0)
    const launcher = readFileSync(join(root, 'bin/palco'), 'utf8')
    expect(launcher).toContain('ELECTRON_RUN_AS_NODE=1 exec')
    expect(launcher).toContain('exec node "$DIR/out/cli/palco.cjs" "$@"')
  })
})

describe('configuração de distribuição Linux', () => {
  it('declara os dois pacotes x64 e recursos fora do asar', () => {
    const config = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    expect(config).toMatch(/^productName: palco$/m)
    expect(config).toMatch(/^executableName: palco$/m)
    expect(config).toMatch(/^appId: io\.github\.palco$/m)
    expect(config).toMatch(/target: AppImage[\s\S]*arch:[\s\S]*x64/)
    expect(config).toMatch(/target: deb[\s\S]*arch:[\s\S]*x64/)
    expect(config).toMatch(/category: Development/)
    expect(config).toMatch(/maintainer: Natan/)
    expect(config).toMatch(/deb:[\s\S]*packageName: palco/)
    expect(config).toMatch(/StartupWMClass: palco/)
    for (const resource of ['from: bin', 'from: out/cli', 'palco.cjs', 'to: palco-cli/bin', 'to: palco-cli/out/cli', 'resources/skills', 'resources/icons', '!out/cli/**']) expect(config).toContain(resource)
    expect(config).toMatch(/node-pty/)
  })

  it('publica os artefatos gerados e documenta a instalação', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { desktopName: string; scripts: Record<string, string> }
    expect(pkg.desktopName).toBe('palco')
    expect(pkg.scripts['dist:linux']).toBe('npm run build && electron-builder --linux AppImage deb --publish never')
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^dist\/$/m)
    const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    expect(workflow).toContain('npm ci')
    for (const gate of ['npm run typecheck', 'npm test', 'npm run build', 'npm run dist:linux']) expect(workflow).toContain(gate)
    expect(workflow).toContain('gh release create'); expect(workflow).toContain('--verify-tag')
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('GITHUB_TOKEN')
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    for (const instruction of ['chmod +x ./palco-*.AppImage', 'sudo apt install ./palco_*.deb', 'npm run dist:linux']) expect(readme).toContain(instruction)
  })
})
