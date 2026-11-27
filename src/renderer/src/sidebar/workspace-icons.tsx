import { useEffect, useSyncExternalStore } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3, BookOpen, Box, Brain, Camera, Code, Cpu, Eye, FileText, Flag, FlaskConical, Folder, Gamepad2, Globe, GraduationCap,
  Hammer, Headphones, Heart, House, LayoutGrid, Leaf, Lightbulb, Monitor, Music, MessageCircle, Palette, Rocket, Server, Settings,
  Shield, Sparkles, Star, SquareTerminal, Sun, TestTube, Users, WandSparkles, Wrench, Zap
} from 'lucide-react'

/** Ícones de traço do workspace e do Espaço (lucide, kebab-case → componente). Seleção própria do palco. */
export const WORKSPACE_ICONS: Readonly<Record<string, LucideIcon>> = {
  'layout-grid': LayoutGrid, folder: Folder, music: Music, terminal: SquareTerminal, sparkles: Sparkles, brain: Brain,
  code: Code, rocket: Rocket, globe: Globe, server: Server, cpu: Cpu, monitor: Monitor, settings: Settings, wrench: Wrench,
  hammer: Hammer, zap: Zap, shield: Shield, 'message-circle': MessageCircle, 'file-text': FileText, box: Box, eye: Eye,
  wand: WandSparkles, lightbulb: Lightbulb, leaf: Leaf, 'flask-conical': FlaskConical, 'test-tube': TestTube,
  'graduation-cap': GraduationCap, 'book-open': BookOpen, 'bar-chart-3': BarChart3, palette: Palette, camera: Camera,
  gamepad: Gamepad2, headphones: Headphones, users: Users, house: House, heart: Heart, star: Star, sun: Sun, flag: Flag
}

/** Sem ícone escolhido, o workspace usa a grade. */
export const DEFAULT_WORKSPACE_ICON = 'layout-grid'

/** Glifo: imagem própria (se houver), ícone lucide pelo nome ou o emoji como texto; pintado na cor, se houver. */
export function Glyph({ icon, color, image, size }: { icon?: string | undefined; color?: string | undefined; image?: string | null; size: number }) {
  if (image) return <img src={image} alt="" draggable={false} aria-hidden="true" style={{ width: size + 2, height: size + 2, objectFit: 'contain' }} />
  const name = icon ?? DEFAULT_WORKSPACE_ICON
  const Icon = WORKSPACE_ICONS[name]
  if (Icon) return <Icon size={size} color={color} aria-hidden="true" />
  return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1, color }}>{name}</span>
}

// Cache das imagens próprias (data URL ou null), recarregado quando o main avisa a troca.
const cache = new Map<string, string | null>()
const subscribers = new Map<string, Set<() => void>>()
let listening = false

function fetchIcon(id: string): void {
  void window.palco.workspaces.loadIcon(id).catch(() => null).then((url) => {
    cache.set(id, url ?? null)
    for (const cb of subscribers.get(id) ?? []) cb()
  })
}

function listen(): void {
  if (listening) return
  listening = true
  window.palco.workspaces.onIconChanged((id) => { if (subscribers.has(id)) fetchIcon(id) })
}

/** Data URL do icon.png do workspace (ou `null`). */
export function useWorkspaceImage(id: string): string | null {
  const image = useSyncExternalStore(
    (cb) => {
      listen()
      const set = subscribers.get(id) ?? new Set()
      set.add(cb)
      subscribers.set(id, set)
      return () => { set.delete(cb); if (set.size === 0) subscribers.delete(id) }
    },
    () => cache.get(id) ?? null
  )
  useEffect(() => { if (!cache.has(id)) fetchIcon(id) }, [id])
  return image
}
