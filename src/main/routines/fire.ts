import { BackgroundCommands, type BackgroundContext } from './background-command'
import { spawn } from 'node:child_process'
import type { Routine, RoutineExecution, Workspace } from '../../shared/model'

export interface RoutineFireResult { result: string; execution: RoutineExecution }
export type RoutineFire = ((r: Routine, report?: (execution: RoutineExecution) => void) => Promise<string | RoutineFireResult>) & { stop(): void }
export interface FireDeps {
  background?(r: Routine): BackgroundContext | undefined
  backgroundTimeoutMs?: number
  workspace(): Workspace
  /** Pasta do workspace (o pre-run roda nela; vai em `PALCO_WORKSPACE_DIR`). */
  workspaceDir?(): string | undefined
  /** Nome e pasta do workspace da rotina (quando `workspace()` junta vários); tem precedência. */
  workspaceInfo?(r: Routine): { name: string; dir?: string } | undefined
  terminals: {
    isRunning(id: string): boolean
    agentState(id: string): 'ready' | 'booting' | 'failed' | 'unknown'
    write(id: string, data: string): void
    deliverPrompt(id: string, text: string): void
    /** Marca do diálogo aberto na tela do agente, ou `null`. */
    dialogOpen(id: string): string | null
  }
  /** O terminal está no meio de uma tarefa (saída recente ou ask pendente). Sem isto, nunca está ocupado. */
  isBusy?(id: string): boolean
  /**
   * Acorda o destino que ainda não subiu nesta sessão (andar ou workspace não aberto) e espera ficar pronto.
   * Sem isto, um destino parado é pulado.
   */
  wake?(id: string): Promise<'running' | 'ready' | 'booting' | 'exited'>
  /** Notificação na área de trabalho (lembretes e aviso de disparo). */
  notify?(title: string, body: string): void
}

const PRE_RUN_TIMEOUT_MS = 60_000
const PRE_RUN_MAX_OUTPUT = 256 * 1024
const OUTPUT_MARK = '{{output}}'

/** Roda o pre-run com `sh -c`; resolve a stdout ou rejeita com o motivo (código ≠ 0, tempo, saída grande). */
function runPreRun(script: string, cwd: string | undefined, env: Record<string, string>, inherit = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', script], { cwd, env: inherit ? { ...process.env, ...env } : env, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    let over = false
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('pre-run passou de 60 s')) }, PRE_RUN_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (over) return
      out += chunk
      if (out.length > PRE_RUN_MAX_OUTPUT) { over = true; child.kill('SIGKILL') }
    })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (over) reject(new Error('saída do pre-run grande demais'))
      else if (code !== 0) reject(new Error(`pre-run saiu com ${code}`))
      else resolve(out.replace(/\n+$/, ''))
    })
  })
}

/**
 * Executa comandos em segundo plano até concluírem; entrega comandos e prompts aos terminais sem esperar resposta.
 * Lembretes viram notificações na área de trabalho.
 * Antes, o pre-run (se houver) roda e a saída dele entra no lugar de `{{output}}`.
 */
export function makeRoutineFire(deps: FireDeps): RoutineFire {
  const commands = new BackgroundCommands()
  const fire: RoutineFire = Object.assign(async (r: Routine, report?: (execution: RoutineExecution) => void) => {
    const ws = deps.workspace()
    const node = r.reminder || r.background ? undefined : ws.nodes[r.terminalId]
    if (!r.reminder && !r.background) {
      if (node?.kind !== 'terminal') return 'pulado: terminal removido'
      // Descarregado pelo menu é decisão do usuário: a rotina não o acorda.
      if (node.unloaded) return 'pulado: terminal descarregado'
      if (!deps.terminals.isRunning(node.id) && deps.wake) {
        const woke = await deps.wake(node.id)
        if (woke === 'booting') return 'pulado: terminal ainda iniciando'
      }
      if (!deps.terminals.isRunning(node.id)) return 'pulado: terminal parado'
      if (r.skipIfBusy !== false && deps.isBusy?.(node.id)) return 'pulado: terminal ocupado'
    }
    const background = r.background ? deps.background?.(r) : undefined
    if (r.background && !background) return 'pulado: pasta do workspace ou andar indisponível'
    let content = r.content
    if (r.preRun !== undefined && r.preRun.trim() !== '') {
      const info = deps.workspaceInfo?.(r)
      const dir = background?.cwd ?? (info ? info.dir : deps.workspaceDir?.())
      const env = {
        ...background?.env,
        PALCO_WORKSPACE_NAME: info?.name ?? ws.name,
        PALCO_WORKSPACE_DIR: dir ?? '',
        PALCO_ROUTINE_NAME: r.name,
        PALCO_TERMINAL_NAME: node?.name ?? ''
      }
      let output: string
      try {
        output = await runPreRun(r.preRun, dir, env, !r.background)
      } catch (err) {
        return `pulado: ${(err as Error).message}`
      }
      if (content.includes(OUTPUT_MARK)) content = content.split(OUTPUT_MARK).join(output)
    }
    if (r.reminder) {
      deps.notify?.(r.name, content)
      return 'ok'
    }
    if (r.background) {
      if (r.notify !== false) deps.notify?.(r.name, 'Comando em segundo plano iniciado.')
      const execution = await commands.run(content, background!, deps.backgroundTimeoutMs, report)
      return { result: execution.status === 'completed' && execution.exitCode === 0 ? 'ok' : 'erro', execution }
    }
    const term = node as Extract<typeof node, { kind: 'terminal' }>
    // Recheca depois do pre-run (pode ter demorado).
    if (!deps.terminals.isRunning(term.id)) return 'pulado: terminal parado'
    if (term.agent === 'shell') {
      deps.terminals.write(term.id, `${content}\r`)
    } else {
      if (deps.terminals.agentState(term.id) === 'failed') return 'pulado: agente não ficou pronto'
      const dialog = deps.terminals.dialogOpen(term.id)
      if (dialog !== null) return `pulado: diálogo aberto no agente (${dialog})`
      deps.terminals.deliverPrompt(term.id, content)
    }
    if (r.notify !== false) deps.notify?.(r.name, `Disparada em ${term.name}`)
    return 'ok'
  }, { stop: () => commands.stop() })
  return fire
}

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function interval(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
  return [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean).join(' ')
}

/** Agenda em texto curto para o CLI e a UI. */
export function describeSchedule(s: Routine['schedule']): string {
  switch (s.kind) {
    case 'every': return `a cada ${interval(s.seconds)}`
    case 'daily': return `todo dia às ${s.time}`
    case 'weekly': return `${s.days.map((d) => DAY_NAMES[d]).join(', ')} às ${s.time}`
    case 'once': return `uma vez em ${new Date(s.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
  }
}
