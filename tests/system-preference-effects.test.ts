import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultPreferences } from '../src/shared/preferences'
import type { TerminalNode } from '../src/shared/model'
import { SystemController } from '../src/main/system/controller'
import { SessionStore } from '../src/main/system/sessions'
const node = (id: string, maestro = false): TerminalNode => ({ id, maestro, kind: 'terminal', name: id, floorId: null, agent: 'claude', command: 'claude --model sonnet', cwd: '/tmp', pos: { x: 0, y: 0 }, size: { w: 300, h: 200 } })
const dirs: string[] = []
afterEach(() => { vi.useRealTimers(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })) })
const setup = () => {
  let prefs = defaultPreferences()
  const ports = { startPower: vi.fn(() => 7), stopPower: vi.fn(), badge: vi.fn(), flash: vi.fn(), createTray: vi.fn((_callbacks: { show(): void; quit(): void }) => ({ destroy: vi.fn(), setCount: vi.fn() })), hideWindow: vi.fn(), showWindow: vi.fn(), confirmQuit: vi.fn(async () => true), notify: vi.fn(), quit: vi.fn(), focus: vi.fn(), isFocused: vi.fn(() => false) }
  const service = new SystemController({ preferences: () => prefs, nodes: () => [node('a'), node('b', true)], ports })
  return { service, ports, patch: (v: Partial<typeof prefs>) => { prefs = { ...prefs, ...v }; service.refresh() } }
}
describe("consumidores de Sistema", () => {
  it('Impedir a suspensão: nunca, durante trabalho e enquanto aberto; libera o bloqueador', () => {
    const { service: s, ports, patch } = setup()
    patch({ sleepPrevention: 'never' }); s.working('a', true); expect(ports.startPower).not.toHaveBeenCalled()
    patch({ sleepPrevention: 'whileAgentsWork' }); expect(ports.startPower).toHaveBeenCalledOnce()
    s.working('a', false); expect(ports.stopPower).toHaveBeenCalledWith(7)
    patch({ sleepPrevention: 'whileAppIsOpen' }); expect(ports.startPower).toHaveBeenCalledTimes(2)
    s.dispose(); expect(ports.stopPower).toHaveBeenCalledTimes(2)
  })
  it('Solicitar confirmação ao encerrar: cancela e confirma sem perder a janela', async () => {
    const { service: s, ports, patch } = setup()
    expect(await s.mayQuit()).toBe(true); expect(ports.confirmQuit).not.toHaveBeenCalled()
    patch({ confirmBeforeQuitting: true }); ports.confirmQuit.mockResolvedValueOnce(false)
    expect(await s.mayQuit()).toBe(false); expect(await s.mayQuit()).toBe(true); s.dispose()
  })
  it('Fechar para a bandeja: cria, esconde, reabre, destrói e não esconde ao sair explicitamente', () => {
    const { service: s, ports, patch } = setup()
    expect(s.closeWindow()).toBe(false)
    patch({ closeToTray: true }); expect(ports.createTray).toHaveBeenCalledOnce(); expect(s.closeWindow()).toBe(true); expect(ports.hideWindow).toHaveBeenCalled()
    const callbacks = ports.createTray.mock.calls[0]![0]; callbacks.show(); expect(ports.showWindow).toHaveBeenCalled()
    patch({ closeToTray: false }); expect(s.closeWindow()).toBe(false)
    expect(ports.createTray.mock.results[0]!.value.destroy).toHaveBeenCalled(); s.dispose()
  })
  it('Tentar restaurar sessões: ID exato por terminal, preferência viva e comando/configuração compatíveis', () => {
    const dir = mkdtempSync(join(tmpdir(), 'palco-resume-')); dirs.push(dir)
    const store = new SessionStore(join(dir, 'sessions.json')), a = node('a')
    store.remember(a, 'session-a')
    expect(store.forRelaunch(a, true).command).toContain('--resume session-a')
    expect(store.forRelaunch(a, false)).toEqual(a)
    expect(store.forRelaunch({ ...a, cwd: '/other' }, true)).toEqual({ ...a, cwd: '/other' })
    expect(store.forRelaunch(node('b'), true).command).not.toContain('--resume')
    expect(new SessionStore(join(dir, 'sessions.json')).forRelaunch(a, true).command).toContain('--resume session-a')
    expect(() => store.remember(a, 'id; touch /tmp/escape')).toThrow()
  })
})
describe("Notificações e atalhos dependentes", () => {
  it('selos Todos/Apenas Maestros e contagem no ícone são aplicados ao estado e ao SO', () => {
    const { service: s, ports, patch } = setup()
    s.publish({ kind: 'turn', terminalId: 'a', title: 'A', body: '' }); s.publish({ kind: 'turn', terminalId: 'b', title: 'B', body: '' })
    expect(s.snapshot().badgeTerminalIds).toEqual(['a', 'b']); expect(ports.badge).toHaveBeenLastCalledWith(2)
    patch({ completionBadges: 'maestros' }); expect(s.snapshot().badgeTerminalIds).toEqual(['b']); expect(ports.badge).toHaveBeenLastCalledWith(1)
    patch({ showAppIconBadge: false }); expect(ports.badge).toHaveBeenLastCalledWith(0); s.dispose()
  })
  it('Piscar barra de tarefas só na atenção com opção ligada; foco encerra o piscar', () => {
    const { service: s, ports, patch } = setup()
    s.publish({ kind: 'attention', terminalId: 'a', title: 'A', body: '' }); expect(ports.flash).not.toHaveBeenCalledWith(true)
    patch({ flashTaskbarOnAttention: true }); s.publish({ kind: 'attention', terminalId: 'b', title: 'B', body: '' }); expect(ports.flash).toHaveBeenLastCalledWith(true)
    s.setFocused('b'); expect(ports.flash).toHaveBeenLastCalledWith(false); s.dispose()
  })
  it.each([['turn', 'notifyOnTurnComplete'], ['attention', 'notifyOnAttention'], ['floor', 'notifyOnFloorStatus'], ['pullRequest', 'notifyOnPullRequests']] as const)('%s: o interruptor controla notificações nativas, sem apagar o aviso interno', (kind, key) => {
    const { service: s, ports, patch } = setup()
    patch({ [key]: false }); s.publish({ kind, terminalId: 'a', title: 'aviso', body: 'teste' }); expect(ports.notify).not.toHaveBeenCalled()
    patch({ [key]: true }); s.publish({ kind, terminalId: 'b', title: 'aviso 2', body: 'teste' }); expect(ports.notify).toHaveBeenCalledOnce()
    expect(s.snapshot().notices).toHaveLength(2); s.dispose()
  })
  it('Próxima notificação e Todas: lista atravessa workspaces e o foco consome o aviso', () => {
    const { service: s, ports } = setup()
    s.publish({ kind: 'attention', terminalId: 'a', workspaceId: 'w2', title: 'A', body: '' })
    s.publish({ kind: 'attention', terminalId: 'b', workspaceId: 'w1', title: 'B', body: '' })
    const first = s.nextAttention(); expect(first?.terminalId).toBe('a'); expect(ports.focus).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'a', workspaceId: 'w2' }))
    expect(s.snapshot().notices).toHaveLength(1); expect(s.nextAttention()?.terminalId).toBe('b'); s.dispose()
  })
})
it('aviso cujo destino já foi apagado é dispensado sem derrubar o app', () => {
 const { service, ports } = setup(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
 service.publish({ kind: 'floor', workspaceId: 'apagado', title: 'Andar', body: '' }); ports.focus.mockImplementation(() => { throw new Error('destino removido') })
 expect(() => service.nextAttention()).not.toThrow(); expect(service.snapshot().notices).toEqual([])
 service.dispose(); warn.mockRestore()
})
