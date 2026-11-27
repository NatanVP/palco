import net from 'node:net'

/**
 * Ponte TCP → socket Unix do app: é por onde o CLI do palco dentro de um SSH ou contêiner chega ao servidor. Só escuta nos endereços pedidos
 * (loopback e, para Docker, o gateway da ponte local); a autorização continua sendo o token por terminal, que o servidor HTTP confere.
 */
export class TunnelServer {
  private servers = new Map<string, net.Server>()
  constructor(private readonly socketPath: string) {}
  /** Começa a ouvir em host:porta (idempotente). Devolve false com o motivo se a porta está ocupada ou o endereço não existe. */
  async listen(host: string, port: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    const key = `${host}:${port}`
    if (this.servers.has(key)) return { ok: true }
    const server = net.createServer(client => {
      const upstream = net.connect(this.socketPath)
      client.pipe(upstream); upstream.pipe(client)
      const end = (): void => { client.destroy(); upstream.destroy() }
      client.on('error', end); upstream.on('error', end); client.on('close', end); upstream.on('close', end)
    })
    return new Promise(resolve => {
      server.once('error', (err: NodeJS.ErrnoException) => resolve({ ok: false, reason: err.code === 'EADDRINUSE' ? `a porta ${port} já está em uso` : err.message }))
      server.listen(port, host, () => { this.servers.set(key, server); resolve({ ok: true }) })
    })
  }
  isListening(host: string, port: number): boolean { return this.servers.has(`${host}:${port}`) }
  close(): void { for (const s of this.servers.values()) s.close(); this.servers.clear() }
}
