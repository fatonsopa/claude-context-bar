import { expect, test } from 'claude-code/testing'

import { buildSnapshot } from '../hooks/snapshot'
import { auditDir, auditId, auditMarkdown, stepRef, withRefs } from '../hooks/auditFile'
import type { DoctorReport, Finding } from '../types'
import { BREAKDOWN } from './fixtures'

const ROWS = buildSnapshot(BREAKDOWN, 'summary', [], null, 0).rows
const AT = new Date(2026, 9, 6, 13, 42).getTime()

const FINDING: Finding = {
  id: 'memory:/p/CLAUDE.md',
  category: 'Memory files',
  categoryKind: 'used',
  severity: 'high',
  title: 'CLAUDE.md loads 64k tokens every request',
  tokens: 64000,
  measured: ['64k tokens · 250 KB · 52 sections'],
  why: 'Sent with every request.',
  actions: [],
  path: '/p/CLAUDE.md',
  source: 'rule',
  plan: [
    {
      text: 'Move incident history to a standards file',
      where: '/p/CLAUDE.md §1e',
      change: 'Move the "Why this rule exists" block to .claude/standards/incidents.md and keep a one-line reason.',
      acceptance: '/context-bar recalculate shows memory files under 50k',
      saves: 18000,
      prompt: 'Move it. Show me the diff and wait for my approval.',
    },
  ],
  deep: { note: 'Section by section.', steps: [{ text: 'Shorten §8', saves: 9000 }] },
}

const REPORT: DoctorReport = {
  at: AT,
  total: 162000,
  max: 1_000_000,
  threshold: 987000,
  findings: withRefs([FINDING]),
  aiInputTokens: 14000,
  runs: [{ kind: 'audit', model: 'claude-opus-5-5', inTokens: 14200, outTokens: 3800, cost: 0.13, at: AT, summary: '' }],
  summary: 'Slim CLAUDE.md first.',
  audit: { id: auditId(AT), path: '/p/.claude/knowledge/context-audits/CA-20261006-1342.md', at: AT },
}

test('auditId, auditDir and the step references', () => {
  expect(auditId(AT)).toBe('CA-20261006-1342')
  expect(auditDir('/p/', true)).toBe('/p/.claude/knowledge/context-audits')
  expect(auditDir('/p', false)).toBe('/p/.claude/context-audits')
  expect(withRefs([FINDING, FINDING]).map(f => f.ref)).toEqual(['CD-1', 'CD-2'])
  expect(stepRef('CD-3', 1)).toBe('CD-3.2')
})

test('the audit file numbers every finding and step and writes each step as a specification', () => {
  const md = auditMarkdown(REPORT, ROWS, {
    id: 'CA-20261006-1342',
    path: '/p/.claude/knowledge/context-audits/CA-20261006-1342.md',
    at: AT,
    cwd: '/p',
    model: 'claude-opus-5-5',
    effort: null,
  })
  expect(md).toContain('# Context audit CA-20261006-1342')
  expect(md).toContain('Execute CD-1.2 from /p/.claude/knowledge/context-audits/CA-20261006-1342.md')
  expect(md).toContain('## Summary')
  expect(md).toContain('| memory files | 8.6k |') // the categories table uses the bar's labels
  expect(md).toContain('| CD-1 | memory files | high | CLAUDE.md loads 64k tokens every request |')
  expect(md).toContain('## CD-1 · memory files · high — CLAUDE.md loads 64k tokens every request')
  expect(md).toContain('#### CD-1.1 — Move incident history to a standards file')
  expect(md).toContain('- **Where:** /p/CLAUDE.md §1e')
  expect(md).toContain('- **Change:** Move the "Why this rule exists" block')
  expect(md).toContain('- **Frees:** ~18k tokens (AI estimate)')
  expect(md).toContain('- **Done when:** /context-bar recalculate shows memory files under 50k')
  expect(md).toContain('  Move it. Show me the diff and wait for my approval.')
  // deep-dive steps continue the numbering after the plan's
  expect(md).toContain('#### CD-1.2 — Shorten §8')
  expect(md).toContain('≈ $0.13 at API prices')
})
