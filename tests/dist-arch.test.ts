import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const temps: string[] = []
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'palco-dist-arch-')); temps.push(dir)
  mkdirSync(join(dir, 'packaging', 'arch'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  copyFileSync(join(root, 'scripts/dist-arch.sh'), join(dir, 'scripts/dist-arch.sh'))
  copyFileSync(join(root, 'packaging/arch/PKGBUILD'), join(dir, 'packaging/arch/PKGBUILD'))
  copyFileSync(join(root, 'LICENSE'), join(dir, 'LICENSE'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.8.7' }))
  writeFileSync(join(dir, 'dist/palco_9.8.7_amd64.deb'), 'arquivo de pacote fictício')
  return dir
}

describe('integridade do pacote Arch', () => {
  it('calcula e passa os hashes das entradas ao makepkg', () => {
    const dir = fixture(), mockBin = join(dir, 'mock-bin'), capture = join(dir, 'capture')
    mkdirSync(mockBin)
    const makepkg = join(mockBin, 'makepkg')
    writeFileSync(makepkg, '#!/bin/bash\nsource PKGBUILD\nprintf "%s\\n%s\\n%s\\n" "$PALCO_DEB_SHA256" "$PALCO_LICENSE_SHA256" "${sha256sums[*]}" > "$CAPTURE"\n')
    chmodSync(makepkg, 0o755)
    const run = spawnSync('bash', [join(dir, 'scripts/dist-arch.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}`, CAPTURE: capture } })
    expect(run.status, run.stderr).toBe(0)
    const values = readFileSync(capture, 'utf8')
    const debHash = createHash('sha256').update('arquivo de pacote fictício').digest('hex')
    const licenseHash = createHash('sha256').update(readFileSync(join(dir, 'LICENSE'))).digest('hex')
    expect(values).toContain(debHash)
    expect(values).toContain(licenseHash)
    expect(values).toContain(`${debHash} ${licenseHash}`)
    expect(readFileSync(join(dir, 'packaging/arch/PKGBUILD'), 'utf8')).not.toContain('SKIP')
  })

  it('repassa opções ao makepkg, para montar num contêiner sem as dependências', () => {
    const dir = fixture(), mockBin = join(dir, 'mock-bin'), capture = join(dir, 'capture')
    mkdirSync(mockBin)
    const makepkg = join(mockBin, 'makepkg')
    writeFileSync(makepkg, '#!/bin/bash\nprintf "%s " "$@" > "$CAPTURE"\n')
    chmodSync(makepkg, 0o755)
    const run = spawnSync('bash', [join(dir, 'scripts/dist-arch.sh'), '--nodeps'], { encoding: 'utf8', env: { ...process.env, PATH: `${mockBin}:${process.env.PATH}`, CAPTURE: capture } })
    expect(run.status, run.stderr).toBe(0)
    expect(readFileSync(capture, 'utf8').trim()).toBe('--force --nodeps')
  })

  it('falha com instrução clara quando os hashes não foram definidos', () => {
    const dir = fixture()
    const run = spawnSync('bash', [join(dir, 'packaging/arch/PKGBUILD')], {
      encoding: 'utf8', env: { ...process.env, PALCO_DEB_SHA256: '', PALCO_LICENSE_SHA256: '' }
    })
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('PALCO_DEB_SHA256')
    expect(run.stderr).toContain('AUR')
  })
})
