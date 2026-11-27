import type { LucideIcon } from 'lucide-react'
import {
  BookOpen, Bot, Box, Brain, Bug, Code, Cpu, Database, Eye, FileText, FlaskConical, Folder, Globe, Hammer, Laptop, Leaf,
  Lightbulb, MessageCircle, Monitor, Orbit, Paintbrush, Rocket, Server, Settings, Shield, Sparkles, SquareTerminal, WandSparkles, Wrench, Zap,
  CircleHelp, icons
} from 'lucide-react'

/** Ícones de traço que o terminal pode usar (nome em kebab-case → componente lucide). */
export const TERMINAL_ICONS: Readonly<Record<string, LucideIcon>> = {
  terminal: SquareTerminal, sparkles: Sparkles, brain: Brain, orbit: Orbit, code: Code, bot: Bot, rocket: Rocket,
  shield: Shield, 'message-circle': MessageCircle, settings: Settings, server: Server, globe: Globe, hammer: Hammer,
  wrench: Wrench, zap: Zap, cpu: Cpu, database: Database, laptop: Laptop, monitor: Monitor, paintbrush: Paintbrush,
  folder: Folder, 'file-text': FileText, box: Box, eye: Eye, wand: WandSparkles, lightbulb: Lightbulb, leaf: Leaf,
  'flask-conical': FlaskConical, 'book-open': BookOpen, bug: Bug
}

/** `bird`, `arrow-up` → o componente lucide (qualquer ícone do lucide, como o CLI aceita), ou undefined. */
export function lucideIcon(name: string): LucideIcon | undefined {
  if (TERMINAL_ICONS[name]) return TERMINAL_ICONS[name]
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return undefined
  const pascal = name.split('-').map((p) => p[0]!.toUpperCase() + p.slice(1)).join('')
  return (icons as Record<string, LucideIcon>)[pascal]
}

/** Ícone do terminal ou da banda: lucide pelo nome, o emoji como texto, ou um genérico para nome desconhecido. */
export function TerminalIcon({ icon, size, color }: { icon: string; size: number; color?: string }) {
  const Icon = lucideIcon(icon) ?? (/^[a-z0-9-]+$/.test(icon) ? CircleHelp : undefined)
  if (Icon) return <Icon size={size} color={color} aria-hidden="true" />
  return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>
}
