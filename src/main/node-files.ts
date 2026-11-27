import { lstat, open, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, sep } from 'node:path'

/**
 * O alvo de verdade do caminho de um nó. O caminho nasce no renderer (arrastar, colar, seletor), então nada nele é de confiança:
 * o main resolve o alvo real, exige arquivo ou pasta comum e não segue um link que saia da pasta onde o próprio link está.
 */
export async function resolveTarget(path: string): Promise<{ real: string; dir: boolean; mode: number }> {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('caminho inválido')
  const link = await lstat(path)
  const real = await realpath(path)
  if (link.isSymbolicLink()) {
    const home = await realpath(dirname(path))
    if (!real.startsWith(home.endsWith(sep) ? home : home + sep)) throw new Error('o link aponta para fora da pasta dele')
  }
  const info = await stat(real)
  if (!info.isFile() && !info.isDirectory()) throw new Error('não é um arquivo nem uma pasta')
  return { real, dir: info.isDirectory(), mode: info.mode }
}

/** Tipos que o sistema pode executar ao "abrir": lançadores, pacotes, atalhos, scripts e binários. */
const LAUNCHABLE = new Set([
  '.desktop', '.appimage', '.sh', '.bash', '.zsh', '.fish', '.csh', '.ksh', '.command', '.tool', '.run', '.bin', '.out', '.elf',
  '.py', '.pyw', '.pyc', '.pl', '.rb', '.php', '.lua', '.tcl', '.awk', '.js', '.mjs', '.cjs', '.jar', '.jnlp',
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.vbe', '.wsf', '.hta', '.lnk', '.reg', '.app',
  '.deb', '.rpm', '.pkg', '.flatpak', '.flatpakref', '.flatpakrepo', '.snap', '.url', '.webloc', '.service'
])

/**
 * "Abrir" nunca entrega ao sistema algo que ele possa executar: bit de execução, extensão (a do nó e a do alvo real) ou o próprio
 * conteúdo (shebang, ELF, executável do Windows, entrada de desktop), que a extensão não esconde.
 */
export async function isLaunchable(path: string, target: { real: string; mode: number }): Promise<boolean> {
  if (target.mode & 0o111) return true
  if ([path, target.real].some((p) => LAUNCHABLE.has(extname(p).toLowerCase()))) return true
  const handle = await open(target.real, 'r')
  try {
    const head = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const bytes = head.subarray(0, bytesRead)
    if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || bytes.subarray(0, 2).toString('latin1') === 'MZ') return true
    const text = bytes.toString('utf8').replace(/^﻿/, '')
    return text.startsWith('#!') || /^(?:[ \t]*(?:#[^\n]*)?\r?\n)*[ \t]*\[(?:Desktop Entry|InternetShortcut)\]/.test(text)
  } finally { await handle.close() }
}
