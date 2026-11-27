import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { TunnelServer } from '../../src/main/environments/tunnel'
import { parseEndpoint } from '../../src/shared/endpoint'

let dir: string, sock: string, app: http.Server, tunnel: TunnelServer
const free = (): Promise<number> => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)) }) })
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'palco-tun-')); sock = join(dir, 's.sock')
  app = http.createServer((req, res) => { res.end(`token=${req.headers['x-palco-token'] ?? 'nenhum'} ${req.url}`) })
  await new Promise<void>(r => app.listen(sock, r)); tunnel = new TunnelServer(sock)
})
afterEach(async () => { tunnel.close(); await new Promise(r => app.close(r)); rmSync(dir, { recursive: true, force: true }) })
const get = (port: number, path: string): Promise<string> => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path, headers: { 'x-palco-token': 'abc' } }, res => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve(d)) }).on('error', reject) })

it('o CLI remoto fala HTTP com o app pela porta TCP de loopback (túnel de verdade)', async () => {
  const port = await free(); expect(await tunnel.listen('127.0.0.1', port)).toEqual({ ok: true })
  expect(await get(port, '/list')).toBe('token=abc /list'); expect(tunnel.isListening('127.0.0.1', port)).toBe(true)
  expect(await tunnel.listen('127.0.0.1', port)).toEqual({ ok: true })
})
it('porta ocupada ou endereço inexistente voltam com o motivo, sem lançar', async () => {
  const port = await free(), other = net.createServer(); await new Promise<void>(r => other.listen(port, '127.0.0.1', r))
  const r = await tunnel.listen('127.0.0.1', port); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toContain(String(port))
  other.close(); expect((await tunnel.listen('203.0.113.9', await free())).ok).toBe(false)
})
it('fechar derruba a porta', async () => {
  const port = await free(); await tunnel.listen('127.0.0.1', port); tunnel.close(); await expect(get(port, '/x')).rejects.toThrow()
})
it('PALCO_SOCKET: caminho Unix ou tcp://host:porta; o resto é recusado', () => {
  expect(parseEndpoint('/tmp/s.sock')).toEqual({ kind: 'unix', path: '/tmp/s.sock' }); expect(parseEndpoint('tcp://127.0.0.1:7433')).toEqual({ kind: 'tcp', host: '127.0.0.1', port: 7433 })
  expect(parseEndpoint('tcp://172.17.0.1:7433')).toMatchObject({ kind: 'tcp' })
  for (const bad of ['tcp://x', 'tcp://h:0', 'tcp://h:70000', 'tcp://h:80/x', 'tcp://a b:80', '']) expect(parseEndpoint(bad), bad).toBeNull()
})
