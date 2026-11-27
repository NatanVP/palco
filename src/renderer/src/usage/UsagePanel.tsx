import { matchesShortcut } from '../settings/preferences'
import { RefreshCw } from 'lucide-react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentUsage, UsageWindow } from '../../../shared/model'
import { RING_PANEL, RING_PILL, ringCaps, ringGradient, ringLayout } from './ring'
import { resetText } from './reset-text'
import { segmentsLit } from './segments'
import { fmt, t } from '../i18n'

/** Cor base por agente; contas extras do mesmo agente pegam a próxima da paleta. */
const BASE: Record<AgentUsage['agent'], string> = { claude: '#D97757', codex: '#10A37F', antigravity:'#4285F4' }
const EXTRA = ['#FF9F0A', '#BF5AF2', '#4285F4', '#00D8FF', '#FA114F', '#A6FF00']
const AGENT_NAME: Record<AgentUsage['agent'], string> = { antigravity:'Antigravity', get claude() { return t('usage.UsagePanel.claude_code') }, get codex() { return t('usage.UsagePanel.codex') } }
const SEGMENTS = 36
const REFRESH_MS = 60_000
/** Entrada: do zero até o valor (120 ms de atraso, 1,1 s); depois, mudanças por mola. */
const ENTER = { delay: 0.12, duration: 1.1, ease: [0.2, 0.9, 0.25, 1] as const }
const SPRING = { type: 'spring' as const, stiffness: 109.66, damping: 17.8, mass: 1 }
const POPOVER = { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const }

/** A janela está visível e com foco? Fora disso o main não precisa consultar os CLIs. */
function useWindowActive(): boolean {
  const read = (): boolean => document.visibilityState === 'visible' && document.hasFocus()
  const [active, setActive] = useState(read)
  useEffect(() => {
    const on = (): void => setActive(read())
    document.addEventListener('visibilitychange', on)
    window.addEventListener('focus', on)
    window.addEventListener('blur', on)
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); window.removeEventListener('blur', on) }
  }, [])
  return active
}

export const usageKey = (u: AgentUsage): string => u.accountId ?? u.agent

/** Cor de cada conta: a primeira de cada agente usa a cor dele; as seguintes, a paleta extra. */
export function usageColors(list: AgentUsage[]): Map<string, string> {
  const colors = new Map<string, string>()
  const seen: Record<string, number> = {}
  let extra = 0
  for (const u of list) {
    const n = (seen[u.agent] = (seen[u.agent] ?? 0) + 1)
    colors.set(usageKey(u), u.color ?? (n === 1 ? BASE[u.agent] : EXTRA[extra++ % EXTRA.length]!))
  }
  return colors
}

const titleOf = (u: AgentUsage): string => u.accountName ?? AGENT_NAME[u.agent]

/** Anel de uso: trilho a 20%, arco em conic-gradient com máscara radial e as pontas de meio disco (sem bolinha). */
function Ring({ value, color, size, thickness, dim }: { value: number; color: string; size: number; thickness: number; dim: boolean }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : 0)
  const mounted = useRef(false)
  useEffect(() => {
    if (reduce) { mv.set(value); return }
    const controls = animate(mv, value, mounted.current ? SPRING : ENTER)
    mounted.current = true
    return () => controls.stop()
  }, [value, reduce, mv])
  const background = useTransform(mv, (f) => ringGradient(f, color))
  const caps = useTransform(mv, (f) => ringCaps(f, thickness))
  const startOpacity = useTransform(caps, (c) => (c.startVisible ? 1 : 0))
  const endOpacity = useTransform(caps, (c) => (c.endVisible ? 1 : 0))
  const rotate = useTransform(caps, (c) => c.endRotation)
  const shadow = useTransform(caps, (c) => c.endShadow)
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 0)`
  const disc = { width: thickness, height: thickness, left: (size - thickness) / 2, top: 0 }
  return (
    <motion.div className="ring" style={{ width: size, height: size }} animate={{ opacity: dim ? 0.25 : 1 }} transition={{ duration: reduce ? 0 : 0.15, ease: 'easeOut' }}>
      <div className="ring-layer" style={{ background: color, opacity: 0.2, WebkitMask: mask, mask }} />
      <motion.div className="ring-layer" style={{ background, WebkitMask: mask, mask }} />
      <motion.div className="ring-cap" style={{ ...disc, background: `color-mix(in srgb, ${color} 70%, transparent)`, clipPath: ringCaps(0.5, thickness).startClip, opacity: startOpacity }} />
      <motion.div className="ring-layer ring-sweep" style={{ rotate, opacity: endOpacity }}>
        <motion.div className="ring-cap" style={{ ...disc, background: color, clipPath: ringCaps(0.5, thickness).endClip, boxShadow: shadow }} />
      </motion.div>
    </motion.div>
  )
}

/** Anéis concêntricos: sessão por fora, semana por dentro; o hover de uma linha destaca o anel dela. */
export function UsageRings({ usage, color, preset, focus }: { usage: AgentUsage; color: string; preset: { size: number; lineWidth: number; spacing: number }; focus?: 'session' | 'weekly' | null }) {
  const { size, lineWidth, spacing } = preset
  const layout = ringLayout(size, lineWidth, spacing, 2)
  const values = [(usage.session?.usedPercent ?? 0) / 100, (usage.weekly?.usedPercent ?? 0) / 100]
  const dims = [focus === 'weekly', focus === 'session']
  return (
    <div className="rings" style={{ width: size, height: size }} aria-hidden>
      {layout.map((r, i) => (
        <div key={i} className="rings-inner" style={{ inset: r.inset }}>
          <Ring value={values[i]!} color={color} size={r.size} thickness={lineWidth} dim={dims[i]!} />
        </div>
      ))}
    </div>
  )
}

/** 36 pílulas lisas para representar o uso: o contêiner externo mede o espaço (1cqw) do grid. */
export function SegmentBar({ fraction, color }: { fraction: number; color: string }) {
  const lit = segmentsLit(fraction, SEGMENTS)
  const on = `linear-gradient(color-mix(in srgb, ${color} 70%, white), ${color})`
  const off = `linear-gradient(color-mix(in srgb, ${color} 26%, transparent), color-mix(in srgb, ${color} 14%, transparent))`
  return (
    <div aria-hidden="true" className="usage-segments-wrap">
      <div className="usage-segments">
        {Array.from({ length: SEGMENTS }, (_, i) => <span key={i} style={{ background: i < lit ? on : off }} />)}
      </div>
    </div>
  )
}

function WindowRow({ label, w, color, onHover }: { label: string; w?: UsageWindow; color: string; onHover: (on: boolean) => void }) {
  const pct = w?.usedPercent
  return (
    <div className="usage-bar" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="usage-bar-head">
        <span>{label}</span>
        <span className="num">{pct === undefined ? '—' : `${Math.round(pct)}%`}</span>
      </div>
      <SegmentBar fraction={(pct ?? 0) / 100} color={color} />
      <div className="usage-reset">{w ? resetText(w.resetsAt) : ''}</div>
    </div>
  )
}

function AccountSection({ u, color }: { u: AgentUsage; color: string }) {
  const [focus, setFocus] = useState<'session' | 'weekly' | null>(null)
  const plan = u.plan ? u.plan[0]!.toUpperCase() + u.plan.slice(1) : ''
  return (
    <section className="usage-agent" title={u.readAt ? t('usage.UsagePanel.fonte_lido', { source: u.source, date: fmt().dateTime(new Date(u.readAt)) }) : t('usage.UsagePanel.fonte', { source: u.source })}>
      <div className="usage-agent-head">
        <UsageRings usage={u} color={color} preset={RING_PANEL} focus={focus} />
        <div>
          <strong>{titleOf(u)}</strong>
          <div className="usage-plan">{[u.accountName ? AGENT_NAME[u.agent] : '', plan].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {(u.session || u.weekly) && (
        <>
          <WindowRow label={t('usage.UsagePanel.sessao')} w={u.session} color={color} onHover={(on) => setFocus(on ? 'session' : null)} />
          <WindowRow label={t('usage.UsagePanel.semanal')} w={u.weekly} color={color} onHover={(on) => setFocus(on ? 'weekly' : null)} />
        </>
      )}
      {/* Com falha, os últimos valores bons continuam visíveis e o erro aparece embaixo. */}
      {u.error && <p className="usage-error">{u.session || u.weekly ? t('usage.UsagePanel.nao_atualizado_error', { error: u.error }) : u.error}</p>}
    </section>
  )
}

/** Popover "Uso dos Agentes": uma seção por conta (Claude 1, Claude 2, Codex…). */
export function UsagePanel({ onClose, onSettings }: { onClose: () => void; onSettings?: () => void }) {
  const [list, setList] = useState<AgentUsage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const reduce = useReducedMotion()
  const windowActive = useWindowActive()

  /** O botão pede uma consulta nova aos CLIs; sem o serviço, só relê o que existe. */
  const refresh = useCallback(async () => {
    setBusy(true)
    try { setList(await (window.palco.usage.refresh?.() ?? window.palco.usage.get())) } catch { /* mantém a lista atual; o erro vem por conta */ } finally { setBusy(false) }
  }, [])

  useEffect(() => {
    const u = window.palco.usage
    void u.get().then(setList)
    // Enquanto o painel está aberto o main consulta os CLIs periodicamente e avisa as mudanças.
    void u.setVisible?.(windowActive, 'panel')
    const off = u.onChange?.(setList)
    const t = u.onChange ? undefined : setInterval(() => void u.get().then(setList), REFRESH_MS)
    // O Escape de um terminal focado é do programa que roda nele.
    const onKey = (e: KeyboardEvent): void => { if (matchesShortcut('cancel', e) && !(e.target as Element | null)?.closest?.('.xterm')) closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => { off?.(); if (t) clearInterval(t); void u.setVisible?.(false, 'panel'); window.removeEventListener('keydown', onKey) }
  }, [windowActive])

  const colors = usageColors(list ?? [])
  return (
    <motion.aside
      className="usage-panel"
      aria-label={t('usage.UsagePanel.uso_dos_agentes')}
      initial={reduce ? false : { opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.95 }}
      transition={POPOVER}
      style={{ transformOrigin: 'bottom right' }}
    >
      <header>
        <strong>{t('usage.UsagePanel.uso_dos_agentes_2')}</strong>
        <button className="usage-refresh" disabled={busy} onClick={() => void refresh()} aria-label={t('usage.UsagePanel.atualizar')} title={t('usage.UsagePanel.atualizar')}>
          <RefreshCw size={11} />
        </button>
      </header>
      <div className="usage-body">
        {(list ?? []).map((u) => <AccountSection key={usageKey(u)} u={u} color={colors.get(usageKey(u))!} />)}
        {list === null && <p className="usage-error">{t('usage.UsagePanel.carregando')}</p>}
      </div>
      {onSettings && <footer><button type="button" className="usage-settings" onClick={onSettings}>{t('usage.UsagePanel.configuracoes')}</button></footer>}
    </motion.aside>
  )
}

/** Pílula da barra inferior: um anel pequeno por conta; entram e saem com escala. */
export function UsagePill({ onOpen }: { onOpen: () => void }) {
  const [list, setList] = useState<AgentUsage[]>([])
  const reduce = useReducedMotion()
  const windowActive = useWindowActive()
  useEffect(() => {
    const u = window.palco.usage
    const load = (): void => void u.get().then(setList).catch(() => {})
    load()
    // Os anéis da barra também contam como visíveis: o main consulta enquanto eles estão na tela.
    void u.setVisible?.(windowActive, 'pill')
    const off = u.onChange?.(setList)
    const t = u.onChange ? undefined : setInterval(load, REFRESH_MS)
    return () => { off?.(); if (t) clearInterval(t); void u.setVisible?.(false, 'pill') }
  }, [windowActive])
  const colors = usageColors(list)
  const tip = list.map((u) => `${titleOf(u)}: ${u.session ? t('usage.UsagePanel.v1_da_sessao', { v1: Math.round(u.session.usedPercent) }) : (u.error ?? t('usage.UsagePanel.sem_leitura'))}`).join(' · ')
  const ringTransition = { duration: reduce ? 0 : 0.4, ease: [0.42, 0, 0.58, 1] as const }
  return (
    <button className="usage-rings" onClick={onOpen} title={tip || t('usage.UsagePanel.uso_dos_agentes')} aria-label={t('usage.UsagePanel.uso_dos_agentes')}>
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((u) => (
          <motion.span key={usageKey(u)} layout="position" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={ringTransition}>
            <UsageRings usage={u} color={colors.get(usageKey(u))!} preset={RING_PILL} />
          </motion.span>
        ))}
      </AnimatePresence>
    </button>
  )
}
