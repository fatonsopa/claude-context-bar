// The context window as the bar reads it: the engine's /context breakdown turned into rows, colours and the
// lists under each category. Pure functions; ./register.tsx calls them on every refresh.

import type { CommandInfo, ContextBreakdownDetail, PromptComposeSection, SessionContextBreakdown, ToolInfo } from 'claude-code'

import type { Detail, Item, Limit, Row, Snapshot } from '../types'
import { catOf, colorOf, estimate, labelOf, shortPath } from './categories'

export function byTokens(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.tokens - a.tokens)
}

// ---------------------------------------------------------------- snapshot

/** What a snapshot reads besides the breakdown: limits, cost, and what the third level shows. */
export type SnapshotExtras = {
  limits?: Limit[]
  cost?: number | null
  /** Each memory file's `##` sections, by absolute path. */
  fileSections?: { [path: string]: Item[] }
  /** The commands list, whose one-line descriptions preview the skills. */
  commands?: readonly CommandInfo[]
}

const PREVIEW_CHARS = 320

function clip(text: string, n = PREVIEW_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A tool's name without its `mcp__<server>__` prefix. */
function toolName(name: string): string {
  const parts = name.split('__')
  return parts.length > 2 ? parts.slice(2).join('__') : name
}

function detailFor(
  row: Row,
  b: SessionContextBreakdown,
  tools: readonly ToolInfo[],
  sections: readonly PromptComposeSection[] | null,
  more: SnapshotExtras,
): Detail {
  if (row.kind === 'free') {
    return { caption: 'window left before it is full', items: [] }
  }
  if (row.kind === 'buffer') {
    return { caption: 'reserved so auto-compaction has room to run', items: [] }
  }
  switch (row.cat) {
    case 'memory':
      return {
        caption: 'CLAUDE.md, rules and memory files',
        items: byTokens(
          b.memoryFiles.map(f => {
            const kids = more.fileSections?.[f.path] ?? []
            return { label: shortPath(f.path), tokens: f.tokens, note: f.type, ...(kids.length > 1 ? { children: kids } : {}) }
          }),
        ),
      }
    case 'mcp': {
      const wantLoaded = row.kind !== 'deferred'
      const servers = new Map<string, { tokens: number; count: number; tools: Item[] }>()
      for (const t of b.mcpTools) {
        if (t.isLoaded !== wantLoaded) continue
        const s = servers.get(t.serverName) ?? { tokens: 0, count: 0, tools: [] }
        s.tools.push({ label: toolName(t.name), tokens: t.tokens })
        servers.set(t.serverName, { tokens: s.tokens + t.tokens, count: s.count + 1, tools: s.tools })
      }
      return {
        caption: wantLoaded ? 'tool schemas in the window, by server' : 'schemas loaded on demand, not in the window',
        items: byTokens(
          [...servers].map(([server, s]) => ({
            label: server,
            tokens: s.tokens,
            note: `${s.count} tool${s.count === 1 ? '' : 's'}`,
            children: byTokens(s.tools),
          })),
        ),
      }
    }
    case 'skills': {
      const s = b.skills
      if (!s) return { caption: 'no skills listed', items: [] }
      return {
        caption: `${s.includedSkills} of ${s.totalSkills} skills listed`,
        items: byTokens(
          s.skillFrontmatter.map(k => {
            const desc = more.commands?.find(c => c.name === k.name)?.description ?? ''
            return { label: k.name, tokens: k.tokens, note: k.pluginName ?? k.source, ...(desc ? { preview: clip(desc) } : {}) }
          }),
        ),
      }
    }
    case 'agents':
      return {
        caption: 'custom agent descriptions',
        items: byTokens(b.agents.map(a => ({ label: a.agentType, tokens: a.tokens, note: a.source }))),
      }
    case 'system':
      if (!sections) return { caption: 'sections appear after the next system-prompt render', items: [] }
      return {
        caption: 'sections, ≈ chars÷4',
        items: byTokens(
          sections
            .filter(s => s.text.length > 0)
            .map(s => ({ label: s.id, tokens: estimate(s.text), note: s.scope, preview: clip(s.text) })),
        ),
      }
    case 'tools':
      return {
        caption: '≈ each description, chars÷4; input schemas not itemized',
        items: byTokens(
          tools
            .filter(t => !t.mcp)
            .map(t => ({ label: t.name, tokens: estimate(t.description), ...(t.description ? { preview: clip(t.description) } : {}) })),
        ),
      }
    case 'messages': {
      const u = b.apiUsage
      if (!u) return { caption: 'no API response yet', items: [] }
      return {
        caption: 'last API request (the whole window, not only messages)',
        items: [
          { label: 'read from prompt cache', tokens: u.cache_read_input_tokens },
          { label: 'written to prompt cache', tokens: u.cache_creation_input_tokens },
          { label: 'uncached input', tokens: u.input_tokens },
          { label: 'output of last reply', tokens: u.output_tokens },
        ],
      }
    }
    case 'commands': {
      const c = b.slashCommands
      return { caption: c ? `${c.includedCommands} of ${c.totalCommands} commands listed` : '', items: [] }
    }
    default:
      return { caption: '', items: [] }
  }
}

export function buildSnapshot(
  b: SessionContextBreakdown,
  detail: ContextBreakdownDetail,
  tools: readonly ToolInfo[],
  sections: readonly PromptComposeSection[] | null,
  at: number,
  more: SnapshotExtras = {},
): Snapshot {
  const rows: Row[] = b.categories.map(c => {
    const base = { name: c.name, kind: c.kind }
    return {
      name: c.name,
      tokens: c.tokens,
      kind: c.kind,
      color: c.color,
      label: labelOf(base),
      display: colorOf(base),
      cat: catOf(c.name),
    }
  })
  const details: { [category: string]: Detail } = {}
  for (const row of rows) details[row.name] = detailFor(row, b, tools, sections, more)
  return {
    detail,
    at,
    model: b.model,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    percent: b.percentage,
    threshold: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    rows,
    details,
    limits: more.limits ?? [],
    cost: more.cost ?? null,
  }
}

/** A snapshot an older version of this code saved (state survives a reload) lacks the fields the bar now draws. */
export const current = (s: Snapshot | null): Snapshot | null => (isCurrent(s) ? s : null)

export function isCurrent(s: Snapshot | null): s is Snapshot {
  return !!s && Array.isArray(s.limits) && s.cost !== undefined && s.rows.every(r => typeof r.label === 'string' && typeof r.display === 'string')
}
