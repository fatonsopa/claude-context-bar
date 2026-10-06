import { expect, test } from 'claude-code/testing'
import type { ModelUsage } from 'claude-code'

import { buildSnapshot } from '../hooks/snapshot'
import { DEFAULT_MODEL, outline, parseArgs, parseAudit, scan, sortFindings, usageCost, withApproval } from '../hooks/doctor'
import { fillRefs } from '../hooks/auditFile'
import type { Seen } from '../types'
import { BREAKDOWN, MEASURE, START, USAGE, run, engine } from './fixtures'

const NO_USE: Seen = { tools: {}, skills: {}, agents: {} }
const ROWS = buildSnapshot(BREAKDOWN, 'summary', [], null, 0).rows
const CLAUDE_MD = '/Users/someone/projects/app/CLAUDE.md'
const CLAUDE_TEXT = [
  '# Rules',
  '## 1. Destructive operations',
  'Never run a destructive operation without approval.',
  '```',
  '## not a heading (inside a fence)',
  '```',
  '## 8. Trigger commands',
  'x'.repeat(4000),
].join('\n')
const DOCTOR_PANE = {
  plugin: 'context-bar',
  component: 'Pane',
  requestId: 'context-doctor',
  props: { title: 'Context doctor', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const USED: ModelUsage = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('parseArgs reads --model and --effort in the usual flag forms', () => {
  expect(parseArgs('').model).toBeUndefined()
  expect(parseArgs('--model=sonnet').model).toBe('claude-sonnet-5-5')
  expect(parseArgs('--model haiku ask')).toMatchObject({ model: 'claude-haiku-4-5', ask: true })
  expect(parseArgs('-model=claude-opus-5-5').model).toBe('claude-opus-5-5')
  expect(parseArgs('model=fable --effort=high')).toMatchObject({ model: 'claude-fable-5-1', effort: 'high' })
  expect(parseArgs('--effort=extreme').error).toBeDefined()
  expect(parseArgs('--model').error).toBeDefined()
  expect(parseArgs('bogus').error).toBeDefined()
  expect(DEFAULT_MODEL).toBe('claude-opus-5-5')
})

test('every finding is filed under one of the context bar rows it was given', () => {
  const findings = scan({ rows: ROWS, b: BREAKDOWN, outlines: [], seen: NO_USE, tools: [] })
  const names = new Set(ROWS.map(r => r.name))
  expect(findings.length).toBeGreaterThan(0)
  for (const f of findings) expect(names.has(f.category)).toBe(true)
  expect(findings.find(f => f.id === `memory:${CLAUDE_MD}`)).toMatchObject({ category: 'Memory files', severity: 'med' })
  expect(findings.find(f => f.id === 'mcp:claude.ai Ahrefs')).toMatchObject({ category: 'MCP tools', severity: 'high' })
})

test('a category the bar is not showing gets no findings', () => {
  const rows = ROWS.filter(r => r.cat !== 'memory' && r.cat !== 'mcp')
  const findings = scan({ rows, b: BREAKDOWN, outlines: [], seen: NO_USE, tools: [] })
  expect(findings.some(f => f.category === 'Memory files' || f.category === 'MCP tools')).toBe(false)
})

test('an MCP server this session called is not reported as unused', () => {
  const seen: Seen = { ...NO_USE, tools: { mcp__pencil__a: 1 } }
  const findings = scan({ rows: ROWS, b: BREAKDOWN, outlines: [], seen, tools: [] })
  expect(findings.some(f => f.id === 'mcp:pencil')).toBe(false)
  expect(findings.some(f => f.id === 'mcp:claude.ai Ahrefs')).toBe(true)
})

test('outline splits on ## headings and ignores headings inside code fences', () => {
  const o = outline(CLAUDE_MD, 'Project', 8000, CLAUDE_TEXT)
  expect(o.sections.map(s => s.heading)).toEqual(['(top of file)', '1. Destructive operations', '8. Trigger commands'])
  expect(o.sections[2]?.tokens ?? 0).toBeGreaterThan(900)
})

test('parseAudit keeps plans, adds approval to every prompt, and drops extras outside the bar categories', () => {
  const text = `Here you go:\n${JSON.stringify({
    summary: 'CLAUDE.md is the big one.',
    plans: [{ id: `memory:${CLAUDE_MD}`, steps: [{ text: 'Move §8 to standards', saves: 18000, prompt: 'Move section 8 of CLAUDE.md.' }] }],
    extra: [
      { category: 'Skills', severity: 'low', title: 'Trim long skill descriptions', tokens: 900, why: 'They are listed every turn.', steps: [] },
      { category: 'Bogus', severity: 'high', title: 'Should be dropped', tokens: 1, why: '', steps: [] },
    ],
  })}\nThanks.`
  const parsed = parseAudit(text, ROWS)
  expect(parsed?.summary).toBe('CLAUDE.md is the big one.')
  const steps = parsed?.plans.get(`memory:${CLAUDE_MD}`) ?? []
  expect(steps[0]?.saves).toBe(18000)
  expect(steps[0]?.prompt ?? '').toContain('approval')
  expect(parsed?.extra.map(f => f.category)).toEqual(['Skills'])
  expect(parseAudit('no json here', ROWS)).toBeNull()
  expect(withApproval('Do it. Wait for my approval.')).toBe('Do it. Wait for my approval.')
})

test('usageCost prices a call at Opus 5.5 list prices', () => {
  expect(Math.round((usageCost('claude-opus-5-5', USED) ?? 0) * 1e6)).toBe(80_000)
  expect(usageCost('some-unknown-model', USED)).toBeNull()
})

test('the doctor pane: categories from the bar, expand a finding, ask the AI, draft a step', async ($, on) => {
  const filled: string[] = []
  const asked: string[] = []
  const written: { path: string; text: string }[] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', ($, e) => ({ value: e.path === '/proj/.claude/knowledge' }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.usage', () => ({ value: USAGE }))
  on('fs.read', () => ({ value: CLAUDE_TEXT }))
  on('model.complete', ($, e) => {
    asked.push(e.model)
    const text = JSON.stringify({
      summary: 'Slim CLAUDE.md first.',
      plans: [{ id: `memory:${CLAUDE_MD}`, steps: [{ text: 'Move §8 Trigger commands to a skill file', saves: 18000 }] }],
      extra: [],
    })
    return { value: { isAnswered: true, text, usage: USED } }
  })
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  // the fixtures' run() names /context-bar; this test drives /context-doctor
  await $.command.run({ ...run('--model=sonnet'), command: 'context-doctor' })

  const ui = await $.ui.mount({ ...DOCTOR_PANE, surface: 'terminal' })
  // the chip reads exactly as the bar's legend does
  // the category chips are buttons now (they filter the findings)
  expect(await ui.find({ text: /memory files/ })).toBeDefined()
  expect(await ui.find({ text: /mcp tools/ })).toBeDefined()
  expect(await ui.find({ key: `toggle:memory:${CLAUDE_MD}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^why$/ })).toBeUndefined()

  await ui.press({ key: `toggle:memory:${CLAUDE_MD}` })
  expect(await ui.find({ type: 'Text', text: /1\. Destructive operations|8\. Trigger commands/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ask AI.* for a plan/ })).toBeDefined()

  await ui.press({ key: 'ask' })
  expect(asked).toEqual(['claude-sonnet-5-5'])
  expect(await ui.find({ type: 'Text', text: /Move §8 Trigger commands/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /−18k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Slim CLAUDE\.md first\./ })).toBeDefined()

  // the audit was saved, numbered, and the pane says where
  expect(written.length).toBe(1)
  expect(written[0]?.path ?? '').toMatch(/^\/proj\/\.claude\/knowledge\/context-audits\/CA-\d{8}-\d{4}\.md$/)
  // findings are numbered in size order (MCP tools first), so the memory file's step number is not fixed
  expect(written[0]?.text ?? '').toMatch(/#### CD-\d+\.1 — Move §8 Trigger commands to a skill file/)
  // the pane names the saved file as "full audit: <path> [open] [copy path]"
  expect(await ui.find({ key: 'audit-path', text: /full audit:.*context-audits\/CA-\d{8}-\d{4}\.md/ })).toBeDefined()
  expect(await ui.find({ key: 'copy-audit' })).toBeDefined()

  await ui.press({ key: `draft:plan:memory:${CLAUDE_MD}:0` })
  expect(filled.length).toBe(1)
  expect(filled[0] ?? '').toContain('approval')
  expect(filled[0] ?? '').toMatch(/Execute CD-\d+\.1 from the context audit \/proj\/\.claude\/knowledge\/context-audits\//)
  await ui.unmount()
})

test('findings are ordered by their category\'s context size, then how many findings it holds, then their own size', () => {
  const findings = scan({ rows: ROWS, b: BREAKDOWN, outlines: [], seen: NO_USE, tools: [] })
  const size = (c: string) => ROWS.find(r => r.name === c && r.kind === 'used')?.tokens ?? 0
  for (let i = 1; i < findings.length; i += 1) {
    expect(size(findings[i - 1]?.category ?? '')).toBeGreaterThanOrEqual(size(findings[i]?.category ?? ''))
  }
  // MCP tools (52k, two findings) comes before memory files (8.6k)
  expect(findings[0]?.category).toBe('MCP tools')
  expect(sortFindings(findings, ROWS).map(f => f.id)).toEqual(findings.map(f => f.id))
})

test('fillRefs keeps the references a saved audit gave and numbers new findings after them', () => {
  const findings = scan({ rows: ROWS, b: BREAKDOWN, outlines: [], seen: NO_USE, tools: [] })
  const [first, second, ...rest] = findings
  if (!first || !second) throw new Error('fixture has too few findings')
  const filled = fillRefs([{ ...first, ref: 'CD-4' }, second, ...rest])
  expect(filled[0]?.ref).toBe('CD-4')
  expect(filled[1]?.ref).toBe('CD-5')
  expect(new Set(filled.map(f => f.ref)).size).toBe(filled.length)
})
