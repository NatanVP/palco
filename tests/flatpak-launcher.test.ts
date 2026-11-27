import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const root = process.cwd()
const launcher = join(root, 'packaging/flatpak/palco-launcher.sh')

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'palco-flatpak-test-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/**
 * Roda o lançador real com um `flatpak-spawn` falso que só grava os argumentos recebidos.
 * O `/.flatpak-info` só existe dentro do sandbox: a cópia temporária aponta para um arquivo de teste.
 */
function run(options: { info?: string; args?: string[]; env?: Record<string, string>; exit?: number } = {}) {
  const info = join(dir, 'flatpak-info'), record = join(dir, 'argv'), script = join(dir, 'launcher.sh')
  if (options.info !== undefined) writeFileSync(info, options.info)
  const source = readFileSync(launcher, 'utf8')
  expect(source).toContain('/.flatpak-info')
  writeFileSync(script, source.replaceAll('/.flatpak-info', info))
  const spawn = join(dir, 'flatpak-spawn')
  writeFileSync(spawn, `#!/bin/sh\nprintf '%s\\0' "$@" > '${record}'\nexit ${options.exit ?? 0}\n`)
  chmodSync(spawn, 0o755)
  const result = spawnSync('/bin/sh', [script, ...(options.args ?? [])], {
    encoding: 'utf8', env: { PATH: `${dir}:/usr/bin:/bin`, HOME: '/home/pessoa de teste', ...options.env }
  })
  const argv = existsSync(record) ? readFileSync(record, 'utf8').split('\0').slice(0, -1) : undefined
  return { ...result, argv }
}

const appPath = '/home/pessoa de teste/.local/share/flatpak/app/io.github.NatanVP.palco/x86_64/master/abc123/files'
const info = [
  '[Application]', 'name=io.github.NatanVP.palco', '', '[Instance]', 'instance-id=1',
  'original-app-path=/caminho/errado', `app-path=${appPath}`, 'runtime-path=/var/lib/flatpak/runtime/x/files', ''
].join('\n')

describe('lançador do Flatpak', () => {
  it('abre no sistema o binário que está dentro do app-path, mesmo com espaços no caminho', () => {
    const result = run({ info })
    expect(result.status).toBe(0)
    expect(result.argv).toEqual(['--host', '--watch-bus', '--directory=/home/pessoa de teste', `${appPath}/palco/palco`])
  })

  it('repassa os argumentos sem dividir, expandir nem perder os vazios', () => {
    const args = ['--ozone-platform=headless', 'com espaço', '', '*', `aspas "e" 'apóstrofo' $HOME`]
    const result = run({ info, args })
    expect(result.argv?.slice(result.argv.indexOf(`${appPath}/palco/palco`) + 1)).toEqual(args)
  })

  it('repassa só as variáveis do lançamento gráfico, antes do comando', () => {
    const result = run({
      info,
      env: {
        XDG_ACTIVATION_TOKEN: 'token com espaço', DESKTOP_STARTUP_ID: 'inicio-1',
        XDG_CONFIG_HOME: '/sandbox/config', XDG_DATA_HOME: '/sandbox/data', XDG_CACHE_HOME: '/sandbox/cache',
        XDG_RUNTIME_DIR: '/run/user/1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/flatpak/bus',
        WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':99.0', XAUTHORITY: '/run/flatpak/Xauthority', SEGREDO: 'nao'
      }
    })
    expect(result.argv).toEqual([
      '--host', '--watch-bus', '--directory=/home/pessoa de teste',
      '--env=XDG_ACTIVATION_TOKEN=token com espaço', '--env=DESKTOP_STARTUP_ID=inicio-1',
      `${appPath}/palco/palco`
    ])
  })

  it('não inventa variáveis vazias', () => {
    const result = run({ info, env: { XDG_ACTIVATION_TOKEN: '', DESKTOP_STARTUP_ID: '' } })
    expect(result.argv?.some((arg) => arg.startsWith('--env'))).toBe(false)
  })

  it('devolve o código de saída do app', () => {
    expect(run({ info, exit: 7 }).status).toBe(7)
  })

  it.each([
    ['sem o arquivo de informações', undefined],
    ['sem app-path', '[Instance]\noriginal-app-path=/caminho/errado\n']
  ])('falha com mensagem e sem abrir nada %s', (_name, content) => {
    const result = run(content === undefined ? {} : { info: content })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('palco: ')
    expect(result.argv).toBeUndefined()
  })
})

describe('pacote Flatpak', () => {
  const id = 'io.github.NatanVP.palco'
  const read = (path: string): string => readFileSync(join(root, path), 'utf8')

  it('pede somente a permissão de lançar no sistema', () => {
    const script = read('scripts/dist-flatpak.sh')
    expect(script.match(/--(talk-name|own-name|filesystem|share|socket|device|allow)=\S+/g)).toEqual(['--talk-name=org.freedesktop.Flatpak'])
    expect(script).not.toMatch(/^\s*(flatpak-builder|curl|wget)\b/m)
  })

  it('usa o mesmo id na janela, no atalho, no ícone e nos metadados', () => {
    const desktop = read(`packaging/flatpak/${id}.desktop`)
    expect(desktop).toMatch(/^Exec=palco-launcher$/m)
    expect(desktop).toMatch(new RegExp(`^Icon=${id}$`, 'm'))
    expect(desktop).toMatch(new RegExp(`^StartupWMClass=${id}$`, 'm'))
    const metainfo = read(`packaging/flatpak/${id}.metainfo.xml`)
    expect(metainfo).toContain(`<id>${id}</id>`)
    expect(metainfo).toContain(`<launchable type="desktop-id">${id}.desktop</launchable>`)
    expect(read('scripts/dist-flatpak.sh')).toContain(`id=${id}`)
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['dist:flatpak']).toContain(`-c.extraMetadata.desktopName=${id}.desktop`)
    expect(pkg.scripts['dist:flatpak']).toContain('bash scripts/dist-flatpak.sh')
  })
})
