/** Onde o CLI do palco acha o app: um caminho de socket Unix (local) ou `tcp://host:porta` (túnel de SSH/contêiner). */
export type Endpoint = { kind: 'unix'; path: string } | { kind: 'tcp'; host: string; port: number }
export function parseEndpoint(value: string): Endpoint | null {
  if (!value.startsWith('tcp://')) return value ? { kind: 'unix', path: value } : null
  const m = /^tcp:\/\/([A-Za-z0-9._-]{1,253}):(\d{1,5})$/.exec(value)
  const port = m ? Number(m[2]) : 0
  return m && port >= 1 && port <= 65535 ? { kind: 'tcp', host: m[1]!, port } : null
}
