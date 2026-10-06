// The context doctor's audit as a Markdown file: every finding and every recommended step numbered (CD-3, CD-3.1)
// and written as a specification, so any of them can be carried out later by its reference. Pure: no `$` here.

import type { AiRun, AiStep, DoctorReport, Finding, Row } from '../types'
import { fmt, money, pct } from './categories'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** `CA-20261006-1342`: the audit's id, from the moment it was saved. */
export function auditId(at: number): string {
  const d = new Date(at)
  return `CA-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

/** Where audits go: the project's `.claude/knowledge/` when it has one (this repo's rule for Markdown), else `.claude/`. */
export function auditDir(cwd: string, hasKnowledge: boolean): string {
  const root = cwd.replace(/\/+$/, '')
  return hasKnowledge ? `${root}/.claude/knowledge/context-audits` : `${root}/.claude/context-audits`
}

export function findingRef(index: number): string {
  return `CD-${index + 1}`
}

export function stepRef(ref: string, index: number): string {
  return `${ref}.${index + 1}`
}

/** Gives every finding its reference, in the order the audit lists them. */
export function withRefs(findings: readonly Finding[]): Finding[] {
  return findings.map((f, i) => ({ ...f, ref: findingRef(i) }))
}

/** Keeps the references findings already have (so they keep matching the saved audit) and numbers the new ones next. */
export function fillRefs(findings: readonly Finding[]): Finding[] {
  let top = findings.reduce((n, f) => Math.max(n, Number(/^CD-(\d+)$/.exec(f.ref ?? '')?.[1] ?? 0)), 0)
  return findings.map(f => (f.ref ? f : { ...f, ref: `CD-${++top}` }))
}

const SEVERITY_WORD = { high: 'high', med: 'medium', low: 'low', info: 'info' } as const
const RANK = { high: 0, med: 1, low: 2, info: 3 } as const

export type TopAction = {
  ref: string | null
  findingId: string
  from: 'plan' | 'deep'
  /** The step's index within its list (`plan` or `deep`). */
  index: number
  step: AiStep
  severity: Finding['severity']
}

/** The `n` most recommended steps across the audit: the most tokens freed first, then the most severe finding. */
export function topActions(findings: readonly Finding[], n = 5): TopAction[] {
  const all: TopAction[] = []
  for (const f of findings) {
    const plan = f.plan ?? []
    plan.forEach((step, i) =>
      all.push({ ref: f.ref ? stepRef(f.ref, i) : null, findingId: f.id, from: 'plan', index: i, step, severity: f.severity }),
    )
    ;(f.deep?.steps ?? []).forEach((step, i) =>
      all.push({
        ref: f.ref ? stepRef(f.ref, plan.length + i) : null,
        findingId: f.id,
        from: 'deep',
        index: i,
        step,
        severity: f.severity,
      }),
    )
  }
  return all
    .map((a, order) => ({ a, order }))
    .sort((x, y) => (y.a.step.saves ?? 0) - (x.a.step.saves ?? 0) || RANK[x.a.severity] - RANK[y.a.severity] || x.order - y.order)
    .slice(0, n)
    .map(x => x.a)
}

/** A table cell: one line, pipes escaped. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
}

function categoryLabel(f: Finding, rows: readonly Row[]): string {
  return rows.find(r => r.name === f.category)?.label ?? f.category.toLowerCase()
}

function frees(f: Finding): number {
  const steps = f.deep?.steps.length ? f.deep.steps : (f.plan ?? [])
  return steps.reduce((n, s) => n + (s.saves ?? 0), 0)
}

function runLine(run: AiRun): string {
  const cost = run.cost === null ? 'cost n/a' : `≈ ${money(run.cost)} at API prices`
  return `${run.kind} · ${run.model} · ${fmt(run.inTokens)} in · ${fmt(run.outTokens)} out · ${cost}${run.error ? ` · failed: ${run.error}` : ''}`
}

function stepSpec(ref: string, s: AiStep, finding: Finding): string[] {
  const out = [`#### ${ref} — ${s.text}`, '']
  out.push(`- **Where:** ${s.where ?? finding.path ?? finding.category}`)
  if (s.change) out.push(`- **Change:** ${s.change}`)
  out.push(`- **Frees:** ${s.saves ? `~${fmt(s.saves)} tokens (AI estimate)` : 'not estimated'}`)
  if (s.acceptance) out.push(`- **Done when:** ${s.acceptance}`)
  if (s.prompt) {
    out.push('- **To carry it out**, send Claude Code:', '', '  ```text', ...s.prompt.split('\n').map(l => `  ${l}`), '  ```')
  }
  out.push('')
  return out
}

export type AuditMeta = {
  id: string
  path: string
  at: number
  cwd: string
  model: string
  effort: string | null
}

export function auditMarkdown(report: DoctorReport, rows: readonly Row[], meta: AuditMeta): string {
  const d = new Date(meta.at)
  const when = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const findings = report.findings
  const totalFrees = findings.reduce((n, f) => n + frees(f), 0)
  const L: string[] = []

  L.push(`# Context audit ${meta.id}`, '')
  L.push(`- **When:** ${when}`)
  L.push(`- **Project:** \`${meta.cwd}\``)
  L.push(
    `- **Context:** ${fmt(report.total)} of ${fmt(report.max)} (${pct(report.total, report.max)})` +
      (report.threshold !== null ? ` · auto-compacts at ${fmt(report.threshold)}` : ' · auto-compact off'),
  )
  L.push(`- **AI:** ${meta.model}${meta.effort ? ` · effort ${meta.effort}` : ''}`)
  for (const run of report.runs.filter(r => r.at >= meta.at - 600_000)) L.push(`- **Run:** ${runLine(run)}`)
  L.push(`- **Findings:** ${findings.length}${totalFrees > 0 ? ` · could free ~${fmt(totalFrees)} tokens` : ''}`)
  L.push('')
  L.push(
    `> **How to use this file.** Every finding has a reference (\`CD-1\`) and every step one (\`CD-1.2\`). ` +
      `To carry one out, tell Claude Code: *"Execute CD-1.2 from ${meta.path}"* (several: *"CD-1.1, CD-3.2"*). ` +
      'Each step asks to show the change and wait for your approval before editing anything.',
  )
  L.push('')

  if (report.summary) L.push('## Summary', '', report.summary, '')

  L.push('## Categories', '', 'As the context bar showed them when the audit ran.', '')
  L.push('| Category | Tokens | % of window |', '|---|---:|---:|')
  for (const r of rows.filter(r => r.kind === 'used' && r.tokens > 0)) {
    L.push(`| ${cell(r.label)} | ${fmt(r.tokens)} | ${pct(r.tokens, report.max)} |`)
  }
  const free = rows.find(r => r.kind === 'free')
  if (free) L.push(`| free | ${fmt(free.tokens)} | ${pct(free.tokens, report.max)} |`)
  L.push('')

  L.push('## Findings', '')
  if (findings.length === 0) {
    L.push('No category crossed a threshold.', '')
  } else {
    L.push('| Ref | Category | Severity | Finding | Tokens | % of window | Could free | Steps |', '|---|---|---|---|---:|---:|---:|---:|')
    for (const f of findings) {
      const steps = (f.plan?.length ?? 0) + (f.deep?.steps.length ?? 0)
      L.push(
        `| ${f.ref ?? ''} | ${cell(categoryLabel(f, rows))} | ${SEVERITY_WORD[f.severity]} | ${cell(f.title)} | ` +
          `${f.tokens > 0 ? fmt(f.tokens) : '—'} | ${f.tokens > 0 ? pct(f.tokens, report.max) : ''} | ` +
          `${frees(f) > 0 ? `~${fmt(frees(f))}` : ''} | ${steps || ''} |`,
      )
    }
    L.push('')
  }

  for (const f of findings) {
    const ref = f.ref ?? '?'
    L.push(`## ${ref} · ${categoryLabel(f, rows)} · ${SEVERITY_WORD[f.severity]} — ${f.title}`, '')
    for (const m of f.measured) L.push(`- **Measured:** ${m}`)
    if (f.why) L.push(`- **Why it matters:** ${f.why}`)
    if (f.path) L.push(`- **File:** \`${f.path}\``)
    L.push(`- **Found by:** ${f.source === 'ai' ? 'the AI' : 'the doctor\'s rules'}`)
    L.push('')
    const plan = f.plan ?? []
    if (plan.length > 0) {
      L.push(`### Recommendations`, '')
      plan.forEach((s, i) => L.push(...stepSpec(stepRef(ref, i), s, f)))
    } else {
      L.push('_No recommendation from the AI for this finding._', '')
    }
    if (f.deep && f.deep.steps.length > 0) {
      const base = plan.length
      L.push('### Deep-dive (section by section)', '')
      if (f.deep.note) L.push(f.deep.note, '')
      f.deep.steps.forEach((s, i) => L.push(...stepSpec(stepRef(ref, base + i), s, f)))
    }
  }

  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}
