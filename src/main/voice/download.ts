import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Pinned } from './catalog'

export interface DownloadOptions { fetch?: typeof fetch; signal?: AbortSignal; onProgress?(received: number): void }

/**
 * Baixa para `dest` só se o tamanho e o SHA-256 forem os fixados. Até conferir, o conteúdo fica em `dest.part`;
 * qualquer diferença, erro ou cancelamento não deixa arquivo nenhum.
 */
export async function downloadVerified(pinned: Pinned, dest: string, options: DownloadOptions = {}): Promise<void> {
  if (!pinned.url.startsWith('https://')) throw new Error('o download exige um endereço https')
  const response = await (options.fetch ?? fetch)(pinned.url, { redirect: 'follow', ...(options.signal ? { signal: options.signal } : {}) })
  if (response.url && !response.url.startsWith('https://')) throw new Error('o download exige um endereço https')
  if (!response.ok || !response.body) throw new Error(`o download falhou (código ${response.status})`)
  const part = `${dest}.part`
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
  const reader = response.body.getReader(), hash = createHash('sha256'), file = openSync(part, 'w', 0o600)
  let received = 0, complete = false
  try {
    for (;;) {
      options.signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > pinned.size) throw new Error('o arquivo baixado tem um tamanho diferente do esperado')
      hash.update(value)
      writeFileSync(file, value)
      options.onProgress?.(received)
    }
    options.signal?.throwIfAborted()
    if (received !== pinned.size) throw new Error('o arquivo baixado tem um tamanho diferente do esperado')
    if (hash.digest('hex') !== pinned.sha256) throw new Error('o arquivo baixado não confere com o hash esperado; nada foi instalado')
    complete = true
  } finally {
    closeSync(file)
    if (!complete) { void reader.cancel().catch(() => {}); rmSync(part, { force: true }) }
  }
  renameSync(part, dest)
}
