import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'install.sh')
const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const PACMAN = 'palco-x86_64.pkg.tar.zst'
const FLATPAK = 'palco-x86_64.flatpak'
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

interface Options {
  tools?: string[]
  sums?: string
  arch?: string
  running?: boolean
}

// PATH só com o necessário e programas falsos: nada baixa nem instala de verdade.
function run(args: string[], options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'palco-install-')); temps.push(dir)
  const bin = join(dir, 'bin'), release = join(dir, 'release'), work = join(dir, 'tmp'), log = join(dir, 'log')
  for (const path of [bin, release, work]) mkdirSync(path)
  writeFileSync(join(release, PACMAN), 'pacote arch fictício')
  writeFileSync(join(release, FLATPAK), 'pacote flatpak fictício')
  writeFileSync(join(release, 'SHA256SUMS'), options.sums ?? `${hash('pacote arch fictício')}  ${PACMAN}\n${hash('pacote flatpak fictício')}  ${FLATPAK}\n`)
  for (const tool of ['bash', 'mktemp', 'rm', 'sha256sum', 'awk', 'cp', 'cat']) {
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec ${found} "$@"\n`); chmodSync(join(bin, tool), 0o755)
  }
  const fake = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!${join(bin, 'bash')}\n${body}\n`); chmodSync(join(bin, name), 0o755)
  }
  fake('uname', `echo ${options.arch ?? 'x86_64'}`)
  fake('curl', 'echo "curl $*" >> "$LOG"\nwhile [ $# -gt 1 ]; do [ "$1" = -o ] && out=$2; shift; done\ncp "$RELEASE/${1##*/}" "$out"')
  const tools = options.tools ?? ['pacman', 'flatpak']
  fake('sudo', 'echo "sudo $*" >> "$LOG"\n"$@"')
  if (tools.includes('pacman')) fake('pacman', 'echo "pacman $*" >> "$LOG"')
  if (tools.includes('flatpak')) fake('flatpak', `if [ "$1" = ps ]; then ${options.running ? 'echo io.github.NatanVP.palco' : ':'}; else echo "flatpak $*" >> "$LOG"; fi`)
  const result = spawnSync(join(bin, 'bash'), [script, ...args], { encoding: 'utf8', env: { PATH: bin, HOME: dir, TMPDIR: work, LOG: log, RELEASE: release } })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, log: existsSync(log) ? readFileSync(log, 'utf8') : '', leftovers: readdirSync(work) }
}

describe('install.sh', () => {
  it('usa o pacman quando ele existe, depois de conferir o hash', () => {
    const out = run([])
    expect(out.status, out.stderr).toBe(0)
    expect(out.log).toContain(`https://github.com/NatanVP/palco/releases/latest/download/${PACMAN}`)
    expect(out.log).toMatch(new RegExp(`sudo pacman -U \\S+/${PACMAN}`))
    expect(out.log).not.toContain('noconfirm')
    expect(out.log).not.toContain('flatpak ')
    expect(out.leftovers).toEqual([])
  })

  it('usa o Flatpak quando não há pacman', () => {
    const out = run([], { tools: ['flatpak'] })
    expect(out.status, out.stderr).toBe(0)
    expect(out.log).toMatch(new RegExp(`flatpak install --user --reinstall --bundle \\S+/${FLATPAK}`))
    expect(out.log).not.toContain('sudo')
  })

  it('--flatpak força o Flatpak', () => {
    const out = run(['--flatpak'])
    expect(out.status, out.stderr).toBe(0)
    expect(out.log).toContain('flatpak install --user')
    expect(out.log).not.toContain('pacman')
  })

  it('não instala quando o hash não confere ou falta', () => {
    for (const sums of [`${hash('outra coisa')}  ${PACMAN}\n`, `${hash('pacote arch fictício')}  outro-arquivo\n`, '']) {
      const out = run(['--pacman'], { sums })
      expect(out.status).not.toBe(0)
      expect(out.stderr).toContain('SHA-256')
      expect(out.log).not.toContain('pacman -U')
      expect(out.leftovers).toEqual([])
    }
  })

  it('recusa o que não dá para instalar, antes de baixar', () => {
    for (const [args, options] of [
      [[], { arch: 'aarch64' }],
      [[], { tools: [] }],
      [['--pacman'], { tools: ['flatpak'] }],
      [['--outro'], {}],
      [['--pacman', '--flatpak'], {}],
      [['--flatpak'], { running: true }]
    ] as [string[], Options][]) {
      const out = run(args, options)
      expect(out.status, JSON.stringify([args, options])).not.toBe(0)
      expect(out.stderr).toContain('palco:')
      expect(out.log).toBe('')
    }
  })

  it('--help explica as opções sem baixar nada', () => {
    const out = run(['--help'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('--flatpak')
    expect(out.log).toBe('')
  })

  it('só executa depois de o arquivo inteiro ter chegado', () => {
    const text = readFileSync(script, 'utf8').trimEnd()
    expect(text.endsWith('\nmain "$@"')).toBe(true)
  })
})
