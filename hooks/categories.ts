// The one place that names and colours the context categories. The bar and the doctor both read from here,
// so a finding filed under "memory files" carries the exact label and colour of the bar's "memory files".

import type { Row } from '../types'

export type Cat = 'system' | 'tools' | 'mcp' | 'agents' | 'memory' | 'skills' | 'messages' | 'commands' | 'other'

/**
 * One categorical palette for every theme and surface: mid-lightness steps that keep at least 3 : 1 against a white,
 * a #1E1E1E and a black background, in a fixed order whose neighbours stay apart for protan and deutan readers
 * (tests/compact.test.tsx measures contrast). A category's colour never depends on the theme, so the strip, the
 * legend and the doctor's chips match on every surface.
 */
export const PALETTE: Record<Cat, string> = {
  system: '#3987E5',
  tools: '#D95926',
  mcp: '#199E70',
  agents: '#C98500',
  memory: '#D55181',
  skills: '#008300',
  messages: '#9085E9',
  commands: '#E66767',
  other: '#8B8B8B',
}

// Everything else is a Claude Code theme key, which each surface resolves in the person's own theme (light, dark,
// colour-blind, ANSI): never a raw colour tuned for one background.
export const FREE = 'subtle'
export const MARKER = 'warning'
export const ACCENT = 'claude'
export const BORDER = 'subtle'
/** A label that lights up under the pointer when it has no colour of its own (free space, a low finding). */
export const MUTED = 'inactive'
export const GOOD = 'success'
export const WARN = 'warning'
export const BAD = 'error'

/** Which category a /context row is, by its name (the engine gives no other identity for it). */
export function catOf(name: string): Cat {
  const n = name.toLowerCase()
  if (n.includes('mcp')) return 'mcp'
  if (n.includes('system prompt')) return 'system'
  if (n.includes('tool')) return 'tools'
  if (n.includes('agent')) return 'agents'
  if (n.includes('memory')) return 'memory'
  if (n.includes('skill')) return 'skills'
  if (n.includes('message')) return 'messages'
  if (n.includes('command')) return 'commands'
  return 'other'
}

export function colorOf(row: Pick<Row, 'name' | 'kind'>): string {
  if (row.kind === 'free' || row.kind === 'buffer') return FREE
  return PALETTE[catOf(row.name)]
}

/** The label the bar prints for a row: `system prompt`, `tools`, `mcp tools`, `agents`, `memory files`, ... */
export function labelOf(row: Pick<Row, 'name' | 'kind'>): string {
  if (row.kind === 'free') return 'free'
  if (row.kind === 'buffer') return 'compact buffer'
  return row.name
    .toLowerCase()
    .replace(/^system tools/, 'tools')
    .replace(/^custom agents/, 'agents')
}

export function fmt(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 1000) return String(v)
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function pct(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return '0%'
  const p = (part / whole) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}

export function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+\//, '~/')
}

/** `$1.23`, `<$0.01` for a fraction of a cent; `cost n/a` when there is no figure. */
export function money(n: number | null): string {
  if (n === null) return 'cost n/a'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}

export function estimate(text: string): number {
  return Math.ceil(text.length / 4)
}

/** What a click on the bar (./barClient.tsx) posts to the hooks module: show or hide the categories. */
export const TOGGLE = { type: 'context-bar:toggle-legend' } as const
