// The context doctor's logic: what counts as a finding, what the AI is asked, how its answer is read.
// Pure functions only — every engine call happens in register.tsx. The categories are never decided here:
// they are the context bar's own rows, read fresh on every run, so a finding carries the bar's label and colour.

import type { ModelUsage, SessionContextBreakdown, ToolInfo } from 'claude-code'

import type { AiStep, DoctorAction, DoctorReport, Effort, Finding, Row, Seen, Severity } from '../types'
import { estimate, fmt, money, pct, shortPath } from './categories'

// ---------------------------------------------------------------- models and prices

export const DEFAULT_MODEL = 'claude-opus-5-5'

/** Short names a person may type after --model. Anything else is passed to the engine as written. */
export const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
}

/** US dollars per million tokens, Anthropic API list prices (Anthropic's model table, cached 25 Sep 2026). */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

/** Output tokens assumed before a call (thinking included), for the estimate on a button. */
export const EXPECTED_OUTPUT = { audit: 4000, deep: 6000 } as const

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function resolveModel(name: string): string {
  const n = name.trim()
  return MODEL_ALIASES[n.toLowerCase()] ?? n
}

/** `claude-opus-5-5` → `opus 5.5`. */
export function shortModel(id: string): string {
  return id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2')
}

export function estimateCost(model: string, inTokens: number, outTokens: number): number | null {
  const p = PRICES[model]
  if (!p) return null
  return (inTokens * p.input + outTokens * p.output) / 1_000_000
}

/** What a finished call cost: cache writes at 1.25x input, cache reads at 0.1x. */
export function usageCost(model: string, u: ModelUsage): number | null {
  const p = PRICES[model]
  if (!p) return null
  const input =
    u.input_tokens * p.input + u.cache_creation_input_tokens * p.input * 1.25 + u.cache_read_input_tokens * p.input * 0.1
  return (input + u.output_tokens * p.output) / 1_000_000
}

export { money }

// ---------------------------------------------------------------- the command's arguments

export type DoctorArgs = { model?: string; effort?: Effort; ask: boolean; help: boolean; error?: string }

/** `--model=sonnet`, `--model sonnet`, `-model=sonnet`, `model=sonnet`; the same for effort; `ask` runs the AI at once. */
export function parseArgs(raw: string): DoctorArgs {
  const out: DoctorArgs = { ask: false, help: false }
  const words = raw.trim().split(/\s+/).filter(w => w.length > 0)
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? ''
    const flag = /^-{0,2}(model|effort)(?:=(.*))?$/i.exec(word)
    if (flag) {
      const key = (flag[1] ?? '').toLowerCase()
      let value = flag[2]
      if (value === undefined || value === '') {
        value = words[i + 1]
        i += 1
      }
      if (!value) {
        out.error = `--${key} needs a value`
        continue
      }
      if (key === 'model') out.model = resolveModel(value)
      else if ((EFFORTS as readonly string[]).includes(value.toLowerCase())) out.effort = value.toLowerCase() as Effort
      else out.error = `--effort is one of ${EFFORTS.join(', ')}`
      continue
    }
    const w = word.toLowerCase()
    if (w === 'ask' || w === '--ask' || w === '--ai' || w === 'ai') out.ask = true
    else if (w === 'help' || w === '--help' || w === '-h') out.help = true
    else out.error = `unknown argument "${word}"`
  }
  return out
}

export const USAGE =
  'Usage: /context-doctor [--model=opus|sonnet|haiku|fable|<model id>] [--effort=low|medium|high|xhigh|max] [ask]'

// ---------------------------------------------------------------- memory file outlines

export type Section = { heading: string; tokens: number; lead: string }
export type FileOutline = { path: string; type: string; tokens: number; bytes: number; sections: Section[] }

/** Splits a markdown file on its `##` headings (or `#` when it has none), skipping headings inside code fences. */
export function outline(path: string, type: string, tokens: number, text: string): FileOutline {
  const lines = text.split('\n')
  const level = lines.some(l => /^## /.test(l)) ? /^## / : /^# /
  const sections: { heading: string; body: string[] }[] = []
  let current: { heading: string; body: string[] } = { heading: '(top of file)', body: [] }
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    if (!inFence && level.test(line)) {
      if (current.body.join('').trim().length > 0 || current.heading !== '(top of file)') sections.push(current)
      current = { heading: line.replace(/^#+\s*/, '').trim(), body: [] }
    } else {
      current.body.push(line)
    }
  }
  if (current.body.join('').trim().length > 0 || current.heading !== '(top of file)') sections.push(current)
  return {
    path,
    type,
    tokens,
    bytes: text.length,
    sections: sections.map(s => {
      const body = s.body.join('\n')
      const lead = s.body.find(l => l.trim().length > 0 && !/^\s*(```|[-*_]{3,}\s*$)/.test(l)) ?? ''
      return { heading: s.heading, tokens: estimate(`${s.heading}\n${body}`), lead: lead.trim().slice(0, 160) }
    }),
  }
}

// ---------------------------------------------------------------- the rules

/** The thresholds the rules use, in tokens or as a share of the room before auto-compaction. */
export const RULES = {
  memoryHigh: 10_000,
  memoryMed: 3_000,
  mcpServerMed: 2_000,
  mcpServerHigh: 10_000,
  skillsListing: 3_000,
  agentsListing: 2_000,
  toolsInfo: 25_000,
  systemInfo: 10_000,
  levelMed: 0.4,
  levelHigh: 0.6,
} as const

export type ScanInput = {
  /** The context bar's rows at this moment: the only categories a finding may be filed under. */
  rows: readonly Row[]
  b: SessionContextBreakdown
  outlines: readonly FileOutline[]
  seen: Seen
  tools: readonly ToolInfo[]
}

const RANK: Record<Severity, number> = { high: 0, med: 1, low: 2, info: 3 }

function kb(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`
}

function base(path: string): string {
  return shortPath(path)
}

const APPROVAL = 'Show me the proposed change and wait for my approval before editing anything.'

export function withApproval(text: string): string {
  return /approv/i.test(text) ? text : `${text.trim()} ${APPROVAL}`
}

export function scan(input: ScanInput): Finding[] {
  const { rows, b, outlines, seen, tools } = input
  const rowFor = (cat: string) => rows.find(r => r.cat === cat && r.kind !== 'deferred')
  const out: Finding[] = []
  const file = (row: Row, f: Omit<Finding, 'category' | 'categoryKind' | 'source'>) =>
    out.push({ ...f, category: row.name, categoryKind: row.kind, source: 'rule' })

  // memory files: each one big enough to matter
  const memory = rowFor('memory')
  if (memory) {
    for (const f of b.memoryFiles) {
      if (f.tokens < RULES.memoryMed) continue
      const o = outlines.find(x => x.path === f.path)
      const top = [...(o?.sections ?? [])].sort((a, c) => c.tokens - a.tokens).slice(0, 3)
      file(memory, {
        id: `memory:${f.path}`,
        severity: f.tokens >= RULES.memoryHigh ? 'high' : 'med',
        title: `${base(f.path)} loads ${fmt(f.tokens)} tokens every request`,
        tokens: f.tokens,
        measured: [
          `${fmt(f.tokens)} tokens${o ? ` · ${kb(o.bytes)} · ${o.sections.length} sections` : ''} · loaded as ${f.type}`,
          ...(top.length ? [`biggest: ${top.map(s => `${s.heading.slice(0, 48)} ${fmt(s.tokens)}`).join(' · ')}`] : []),
        ],
        why: 'Memory files are sent with every request. Rules Claude needs on every turn belong here; history, examples and rarely used procedures can move to files Claude reads only when relevant.',
        path: f.path,
        deepTokens: f.tokens + 1500,
        actions: [
          {
            kind: 'prompt',
            label: 'draft this edit',
            text: withApproval(
              `Help me slim ${f.path} (about ${fmt(f.tokens)} tokens, loaded on every request). Propose which sections to keep, shorten, or move into files that are read only when relevant, with the tokens each change saves.`,
            ),
          },
          { kind: 'deep', label: 'deep-dive this file' },
          { kind: 'copy', label: 'copy path', text: f.path },
        ],
      })
    }
  }

  // MCP servers: schemas in the window that this session never used
  const mcp = rowFor('mcp')
  if (mcp) {
    const servers = new Map<string, { tokens: number; names: string[]; top: { name: string; tokens: number }[] }>()
    for (const t of b.mcpTools) {
      if (!t.isLoaded) continue
      const s = servers.get(t.serverName) ?? { tokens: 0, names: [], top: [] }
      s.tokens += t.tokens
      s.names.push(t.name)
      s.top.push({ name: t.name, tokens: t.tokens })
      servers.set(t.serverName, s)
    }
    for (const [server, s] of servers) {
      const used = s.names.filter(n => (seen.tools[n] ?? 0) > 0).length
      if (used > 0 || s.tokens < RULES.mcpServerMed) continue
      const top = s.top.sort((a, c) => c.tokens - a.tokens).slice(0, 3)
      file(mcp, {
        id: `mcp:${server}`,
        severity: s.tokens >= RULES.mcpServerHigh ? 'high' : 'med',
        title: `${server} loads ${fmt(s.tokens)} of tool schemas, unused this session`,
        tokens: s.tokens,
        measured: [
          `${s.names.length} tools loaded · 0 called this session`,
          `largest: ${top.map(t => `${t.name.replace(/^mcp__/, '')} ${fmt(t.tokens)}`).join(' · ')}`,
        ],
        why: 'Loaded MCP tool schemas sit in the window on every request whether or not they are called. Loading them on demand (tool search), or disconnecting servers this project does not use, keeps them out until needed.',
        actions: [
          { kind: 'copy', label: 'copy /mcp', text: '/mcp' },
          { kind: 'copy', label: 'copy ENABLE_TOOL_SEARCH=true', text: 'ENABLE_TOOL_SEARCH=true' },
        ],
      })
    }
  }

  // skills: some do not fit the listing; or the listing is large and mostly unused
  const skillsRow = rowFor('skills')
  const s = b.skills
  if (skillsRow && s) {
    const items = s.skillFrontmatter
    const usedNames = items.filter(k => (seen.skills[k.name] ?? 0) > 0).map(k => k.name)
    if (s.includedSkills < s.totalSkills) {
      file(skillsRow, {
        id: 'skills:budget',
        severity: 'med',
        title: `${s.totalSkills - s.includedSkills} of ${s.totalSkills} skills don't fit the listing — Claude can't see them`,
        tokens: s.tokens,
        measured: [`listing ${fmt(s.tokens)} · ${s.includedSkills} of ${s.totalSkills} included`],
        why: 'A skill left out of the listing is invisible to Claude, so it can never choose it. Shorter descriptions, or fewer installed skills, let the rest fit.',
        actions: [{ kind: 'copy', label: 'copy /skill-doctor', text: '/skill-doctor' }],
      })
    }
    if (s.tokens >= RULES.skillsListing) {
      const top = [...items].sort((a, c) => c.tokens - a.tokens).slice(0, 4)
      file(skillsRow, {
        id: 'skills:listing',
        severity: 'low',
        title: `${s.totalSkills} skills listed (${fmt(s.tokens)}), ${usedNames.length} used this session`,
        tokens: s.tokens,
        measured: [
          `largest descriptions: ${top.map(k => `${k.name} ${fmt(k.tokens)}`).join(' · ')}`,
          usedNames.length ? `used: ${usedNames.slice(0, 8).join(', ')}` : 'none used yet this session',
        ],
        why: 'Each listed skill costs its description on every request. Skills you never use in this project can be disabled, and long descriptions shortened.',
        actions: [{ kind: 'copy', label: 'copy /skill-doctor', text: '/skill-doctor' }],
      })
    }
  }

  // custom agents
  const agentsRow = rowFor('agents')
  const agentTokens = b.agents.reduce((n, a) => n + a.tokens, 0)
  if (agentsRow && agentTokens >= RULES.agentsListing) {
    const unused = b.agents.filter(a => (seen.agents[a.agentType] ?? 0) === 0)
    file(agentsRow, {
      id: 'agents:listing',
      severity: 'low',
      title: `${b.agents.length} custom agents described (${fmt(agentTokens)}), ${b.agents.length - unused.length} used`,
      tokens: agentTokens,
      measured: [`unused this session: ${unused.slice(0, 8).map(a => a.agentType).join(', ') || 'none'}`],
      why: 'Every custom agent description is part of the Agent tool on every request.',
      actions: [{ kind: 'copy', label: 'copy /agents', text: '/agents' }],
    })
  }

  // built-in tools and the system prompt: mostly fixed by Claude Code, reported for completeness
  const toolsRow = rowFor('tools')
  if (toolsRow && toolsRow.tokens >= RULES.toolsInfo) {
    const top = tools
      .filter(t => !t.mcp)
      .map(t => ({ name: t.name, tokens: estimate(t.description) }))
      .sort((a, c) => c.tokens - a.tokens)
      .slice(0, 4)
    file(toolsRow, {
      id: 'tools:builtin',
      severity: 'info',
      title: `built-in tool definitions take ${fmt(toolsRow.tokens)}`,
      tokens: toolsRow.tokens,
      measured: [`largest descriptions (≈): ${top.map(t => `${t.name} ${fmt(t.tokens)}`).join(' · ')}`],
      why: 'Mostly fixed by Claude Code itself; tools deferred behind tool search load only when needed.',
      actions: [],
    })
  }
  const systemRow = rowFor('system')
  if (systemRow && systemRow.tokens >= RULES.systemInfo) {
    file(systemRow, {
      id: 'system:size',
      severity: 'info',
      title: `system prompt is ${fmt(systemRow.tokens)}`,
      tokens: systemRow.tokens,
      measured: [`${pct(systemRow.tokens, b.rawMaxTokens)} of the window`],
      why: 'Set by Claude Code, your output style and installed plugins.',
      actions: [],
    })
  }

  // how full the window is
  const room = b.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : b.rawMaxTokens
  const level = b.totalTokens / Math.max(1, room)
  const messages = rowFor('messages')
  const freeRow = rows.find(r => r.kind === 'free')
  const where = level >= RULES.levelMed ? messages : freeRow
  if (where) {
    file(where, {
      id: 'level',
      severity: level >= RULES.levelHigh ? 'high' : level >= RULES.levelMed ? 'med' : 'info',
      title:
        level >= RULES.levelMed
          ? `context is ${Math.round(level * 100)}% of the way to auto-compact`
          : `context at ${Math.round(level * 100)}% · auto-compact far away`,
      tokens: level >= RULES.levelMed ? (messages?.tokens ?? b.totalTokens) : (freeRow?.tokens ?? 0),
      measured: [
        `${fmt(b.totalTokens)} used of ${fmt(b.rawMaxTokens)}${b.isAutoCompactEnabled && b.autoCompactThreshold ? ` · compacts at ${fmt(b.autoCompactThreshold)}` : ' · auto-compact off'}`,
        `messages ${fmt(messages?.tokens ?? 0)}`,
      ],
      why:
        level >= RULES.levelMed
          ? 'A long conversation pushes everything else toward auto-compaction. /compact with a focus keeps what matters; /clear between unrelated tasks starts fresh.'
          : 'Plenty of room left. Nothing to do yet.',
      actions:
        level >= RULES.levelMed
          ? [
              { kind: 'copy', label: 'copy /compact', text: '/compact keep the current task, decisions and open questions' },
              { kind: 'copy', label: 'copy /clear', text: '/clear' },
            ]
          : [],
    })
  }

  return sortFindings(out, rows)
}

/** The store key that keeps a project's last AI run across sessions. */
export function lastRunKey(cwd: string): string {
  return `doctor:last:${cwd.replace(/\/+$/, '')}`
}

/** A report read back from the store, if it has the shape this code draws; anything else is ignored. */
export function asReport(v: unknown): DoctorReport | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Partial<DoctorReport>
  if (!Array.isArray(r.findings) || !Array.isArray(r.runs) || typeof r.at !== 'number') return null
  if (typeof r.total !== 'number' || typeof r.max !== 'number') return null
  return {
    at: r.at,
    total: r.total,
    max: r.max,
    threshold: typeof r.threshold === 'number' ? r.threshold : null,
    findings: r.findings,
    aiInputTokens: typeof r.aiInputTokens === 'number' ? r.aiInputTokens : 0,
    runs: r.runs,
    summary: typeof r.summary === 'string' ? r.summary : null,
    audit: r.audit && typeof r.audit.path === 'string' ? r.audit : null,
  }
}

/**
 * The order the doctor lists findings in, and numbers them by: the category with the most context first, then the
 * category with the most findings, then the biggest finding, then the most severe. `rows` are the bar's.
 */
export function sortFindings(list: readonly Finding[], rows: readonly Row[] = []): Finding[] {
  const size = (f: Finding) => {
    const row = rows.find(r => r.name === f.category)
    return row && row.kind === 'used' ? row.tokens : 0
  }
  const count = (f: Finding) => list.filter(x => x.category === f.category).length
  return [...list].sort(
    (a, c) =>
      size(c) - size(a) ||
      count(c) - count(a) ||
      a.category.localeCompare(c.category) ||
      c.tokens - a.tokens ||
      RANK[a.severity] - RANK[c.severity],
  )
}

// ---------------------------------------------------------------- the AI audit

export function buildAuditPrompt(input: ScanInput & { findings: readonly Finding[] }): { system: string; prompt: string } {
  const { rows, b, outlines, seen, findings } = input
  const categories = rows.filter(r => r.kind !== 'buffer').map(r => r.name)
  const payload = {
    window: {
      used: b.totalTokens,
      max: b.rawMaxTokens,
      autoCompactAt: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
      percent: b.percentage,
    },
    categories: rows.map(r => ({ name: r.name, label: r.label, tokens: r.tokens, kind: r.kind })),
    memoryFiles: outlines.map(o => ({
      path: o.path,
      loadedAs: o.type,
      tokens: o.tokens,
      sections: o.sections.map(s => ({ heading: s.heading, tokens: s.tokens, lead: s.lead })),
    })),
    mcpServers: [...new Set(b.mcpTools.map(t => t.serverName))].map(server => {
      const ts = b.mcpTools.filter(t => t.serverName === server)
      return {
        server,
        loadedTokens: ts.filter(t => t.isLoaded).reduce((n, t) => n + t.tokens, 0),
        deferredTools: ts.filter(t => !t.isLoaded).length,
        tools: ts.length,
        calledThisSession: ts.filter(t => (seen.tools[t.name] ?? 0) > 0).map(t => t.name),
      }
    }),
    skills: b.skills
      ? {
          listed: b.skills.includedSkills,
          total: b.skills.totalSkills,
          tokens: b.skills.tokens,
          items: b.skills.skillFrontmatter
            .slice()
            .sort((a, c) => c.tokens - a.tokens)
            .slice(0, 60)
            .map(k => ({ name: k.name, tokens: k.tokens, source: k.pluginName ?? k.source, used: (seen.skills[k.name] ?? 0) > 0 })),
        }
      : null,
    agents: b.agents.map(a => ({ name: a.agentType, tokens: a.tokens, used: (seen.agents[a.agentType] ?? 0) > 0 })),
    toolsCalledThisSession: seen.tools,
    findings: findings.map(f => ({ id: f.id, category: f.category, severity: f.severity, title: f.title, tokens: f.tokens, measured: f.measured })),
  }
  const system = [
    'You audit the context window of a Claude Code session and recommend specific, safe ways to make it smaller and better organised.',
    'Be concrete: name the file and section, the MCP server, the skill or the agent, and estimate the tokens each step frees.',
    'Never recommend deleting rules the person relies on: move them to a file read on demand, shorten them, or remove duplicates.',
    'Reply with JSON only, no prose around it.',
  ].join(' ')
  const prompt = [
    'Context data (JSON):',
    JSON.stringify(payload),
    '',
    'Return exactly this JSON shape:',
    '{"summary": "<two sentences: the biggest win and the overall picture>",',
    ' "plans": [{"id": "<a finding id from the data>", "steps": [STEP]}],',
    ` "extra": [{"category": "<one of: ${categories.join(' | ')}>", "severity": "high|med|low|info", "title": "<short>", "tokens": <integer>, "why": "<one sentence>", "steps": [same step shape]}]}`,
    STEP_SHAPE,
    'Give every finding a plan (at most 4 steps, the most valuable first). Use "extra" only for problems the findings missed, filed under one of the listed categories exactly as written.',
    'Each step is a specification someone can carry out without guessing: name the exact file and section, server, skill or agent, say precisely what changes, and how to check it worked.',
  ].join('\n')
  return { system, prompt }
}

/** The shape every step is asked in, audit and deep-dive alike. */
const STEP_SHAPE = [
  'where STEP is {"text": "<the step in one line>",',
  ' "where": "<exactly where: file path and section heading, MCP server, skill or agent name>",',
  ' "change": "<the specification: precisely what to change, keep, move or remove, and where moved content goes>",',
  ' "acceptance": "<how to check it worked, e.g. what /context-bar recalculate should show afterwards>",',
  ' "saves": <integer tokens or null>,',
  ' "prompt": "<an instruction the person can send to Claude Code to carry this step out; it must ask Claude to show the proposed change and wait for approval before editing>"}',
].join('\n')

function asSteps(v: unknown): AiStep[] {
  if (!Array.isArray(v)) return []
  const steps: AiStep[] = []
  for (const s of v) {
    if (typeof s !== 'object' || s === null) continue
    const o = s as { text?: unknown; where?: unknown; change?: unknown; acceptance?: unknown; saves?: unknown; prompt?: unknown }
    if (typeof o.text !== 'string' || o.text.trim() === '') continue
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
    const where = str(o.where)
    const change = str(o.change)
    const acceptance = str(o.acceptance)
    steps.push({
      text: o.text.trim(),
      ...(where ? { where } : {}),
      ...(change ? { change } : {}),
      ...(acceptance ? { acceptance } : {}),
      saves: typeof o.saves === 'number' && Number.isFinite(o.saves) && o.saves > 0 ? Math.round(o.saves) : null,
      ...(typeof o.prompt === 'string' && o.prompt.trim() ? { prompt: withApproval(o.prompt) } : {}),
    })
  }
  return steps.slice(0, 10)
}

function jsonIn(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export type AuditAnswer = { summary: string; plans: Map<string, AiStep[]>; extra: Finding[] }

/** Reads the AI's answer; an `extra` finding is kept only when its category is one of the bar's rows. */
export function parseAudit(text: string, rows: readonly Row[]): AuditAnswer | null {
  const data = jsonIn(text)
  if (typeof data !== 'object' || data === null) return null
  const d = data as { summary?: unknown; plans?: unknown; extra?: unknown }
  const plans = new Map<string, AiStep[]>()
  if (Array.isArray(d.plans)) {
    for (const p of d.plans) {
      if (typeof p !== 'object' || p === null) continue
      const o = p as { id?: unknown; steps?: unknown }
      if (typeof o.id === 'string') plans.set(o.id, asSteps(o.steps))
    }
  }
  const extra: Finding[] = []
  if (Array.isArray(d.extra)) {
    d.extra.forEach((x, i) => {
      if (typeof x !== 'object' || x === null) return
      const o = x as { category?: unknown; severity?: unknown; title?: unknown; tokens?: unknown; why?: unknown; steps?: unknown }
      const row = rows.find(r => typeof o.category === 'string' && r.name.toLowerCase() === o.category.toLowerCase())
      if (!row || typeof o.title !== 'string') return
      const severity: Severity = o.severity === 'high' || o.severity === 'med' || o.severity === 'low' ? o.severity : 'info'
      extra.push({
        id: `ai:${i}:${o.title.slice(0, 40)}`,
        category: row.name,
        categoryKind: row.kind,
        severity,
        title: o.title,
        tokens: typeof o.tokens === 'number' && o.tokens > 0 ? Math.round(o.tokens) : 0,
        measured: ['found by the AI'],
        why: typeof o.why === 'string' ? o.why : '',
        actions: [],
        plan: asSteps(o.steps),
        source: 'ai',
      })
    })
  }
  return { summary: typeof d.summary === 'string' ? d.summary : '', plans, extra }
}

// ---------------------------------------------------------------- the deep-dive on one file

export const DEEP_TEXT_LIMIT = 400_000

export function buildDeepPrompt(f: Finding, text: string): { system: string; prompt: string } {
  const cut = text.length > DEEP_TEXT_LIMIT
  const system =
    'You restructure a Claude Code memory file (CLAUDE.md, a rules file or a memory index) that is loaded into every request. Keep every rule the person relies on; move history, examples and rarely needed procedures to files read on demand; shorten wording; remove duplicates. Reply with JSON only.'
  const prompt = [
    `File: ${f.path} (about ${fmt(f.tokens)} tokens, loaded on every request)${cut ? ` — only its first ${DEEP_TEXT_LIMIT.toLocaleString()} characters are included` : ''}.`,
    ...(f.plan?.length ? ['Earlier plan for it:', ...f.plan.map((s, i) => `${i + 1}. ${s.text}`)] : []),
    '',
    '<file>',
    cut ? text.slice(0, DEEP_TEXT_LIMIT) : text,
    '</file>',
    '',
    'Return {"note": "<one sentence on the overall shape of the change>", "steps": [STEP]} — one step per section to change (keep | shorten | move to <path> | remove duplicate).',
    STEP_SHAPE,
    'At most 10 steps, the biggest saving first.',
  ].join('\n')
  return { system, prompt }
}

export function parseDeep(text: string): { note: string; steps: AiStep[] } | null {
  const data = jsonIn(text)
  if (typeof data !== 'object' || data === null) return null
  const d = data as { note?: unknown; steps?: unknown }
  const steps = asSteps(d.steps)
  if (steps.length === 0) return null
  return { note: typeof d.note === 'string' ? d.note : '', steps }
}

/** The text placed in the input box for one step: the AI's own instruction when it gave one. */
export function draftFor(f: Finding, step?: AiStep, ref?: string, auditPath?: string): string {
  if (step) {
    const head = ref && auditPath ? `Execute ${ref} from the context audit ${auditPath}. ` : ''
    return withApproval(`${head}${step.prompt ?? `${step.text}${step.where ? ` (${step.where})` : f.path ? ` (file: ${f.path})` : ''}`}`)
  }
  const own = f.actions.find((a): a is Extract<DoctorAction, { kind: 'prompt' }> => a.kind === 'prompt')
  return own ? own.text : withApproval(`Help me with this context finding: ${f.title}. ${f.measured.join('. ')}.`)
}
