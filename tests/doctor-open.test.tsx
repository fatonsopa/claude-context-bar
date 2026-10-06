import { expect, test } from 'claude-code/testing'

import { asReport, lastRunKey } from '../hooks/doctor'
import { ago, when } from '../hooks/doctorView'
import type { DoctorReport } from '../types'
import { MEASURE, START, USAGE, engine } from './fixtures'

const MIN = 60_000
const NOW = new Date(2026, 9, 6, 14, 0).getTime()
const RUN_AT = new Date(2026, 9, 6, 13, 42).getTime()
const CLAUDE_MD = '/Users/someone/projects/app/CLAUDE.md'

const LAST: DoctorReport = {
  at: RUN_AT,
  total: 90300,
  max: 1_000_000,
  threshold: 987000,
  findings: [
    {
      id: `memory:${CLAUDE_MD}`,
      ref: 'CD-1',
      category: 'Memory files',
      categoryKind: 'used',
      severity: 'med',
      title: 'CLAUDE.md loads 8k tokens every request',
      tokens: 8000,
      measured: ['8k tokens'],
      why: 'Sent with every request.',
      actions: [],
      path: CLAUDE_MD,
      plan: [{ text: 'Move §8 to a skill', saves: 3000 }],
      source: 'rule',
    },
  ],
  aiInputTokens: 9000,
  runs: [{ kind: 'audit', model: 'claude-opus-5-5', inTokens: 9000, outTokens: 2000, cost: 0.08, at: RUN_AT, summary: 'Slim CLAUDE.md.' }],
  summary: 'Slim CLAUDE.md.',
  audit: { id: 'CA-20261006-1342', path: '/proj/.claude/knowledge/context-audits/CA-20261006-1342.md', at: RUN_AT },
}

const PANE = {
  plugin: 'context-bar',
  component: 'Pane',
  requestId: 'context-doctor',
  props: { title: 'Context doctor', isFocused: true, bodyColumns: 140, placement: 'inline', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

test('run times read as local time and how long ago', () => {
  expect(when(RUN_AT, NOW)).toBe('13:42 today')
  expect(when(new Date(2026, 9, 4, 9, 5).getTime(), NOW)).toBe('4 Oct 09:05')
  expect(ago(NOW - 30_000, NOW)).toBe('just now')
  expect(ago(NOW - 18 * MIN, NOW)).toBe('18 min ago')
  expect(ago(NOW - 3 * 60 * MIN, NOW)).toBe('3 h ago')
})

test('a stored run is used only when it has the shape the pane draws', () => {
  expect(asReport(LAST)?.audit?.id).toBe('CA-20261006-1342')
  expect(asReport({ findings: 'nope' })).toBeNull()
  expect(asReport(null)).toBeNull()
  expect(lastRunKey('/proj/')).toBe('doctor:last:/proj')
})

test('/context-doctor brings back the last run, every accordion closed; chips filter; the full audit opens', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('store.get', ($, e) => ({ value: e.key === 'doctor:last:/proj' ? LAST : undefined }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('CA-20261006-1342.md') ? '# Context audit CA-20261006-1342\n\n## CD-1 · memory files' : '## A\nx' }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.command.run({ command: 'context-doctor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // the last run is back: its summary, its time, its numbered finding — all folded
  expect(await ui.find({ type: 'Text', text: /Slim CLAUDE\.md\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last AI run/ })).toBeDefined()
  expect((await ui.find({ key: `toggle:memory:${CLAUDE_MD}` }))?.text ?? '').toMatch(/^CD-1 /)
  expect(await ui.find({ type: 'Text', text: /^why$/ })).toBeUndefined()

  // a category chip filters the findings to that category, and again shows them all
  expect(await ui.find({ key: 'toggle:mcp:claude.ai Ahrefs' })).toBeDefined()
  await ui.press({ key: 'dcat:Memory files' })
  expect(await ui.find({ key: 'toggle:mcp:claude.ai Ahrefs' })).toBeUndefined()
  expect(await ui.find({ key: `toggle:memory:${CLAUDE_MD}` })).toBeDefined()
  await ui.press({ key: 'dcat:Memory files' })
  expect(await ui.find({ key: 'toggle:mcp:claude.ai Ahrefs' })).toBeDefined()

  // the full audit is folded, and opens to the file's Markdown
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.press({ key: 'audit-toggle' })
  expect((await ui.find({ type: 'Markdown' }))?.text ?? '').toContain('# Context audit CA-20261006-1342')

  // opened again, everything is folded again
  await ui.press({ key: `toggle:memory:${CLAUDE_MD}` })
  expect(await ui.find({ type: 'Text', text: /^why$/ })).toBeDefined()
  await $.command.run({ command: 'context-doctor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 140 } })
  expect(await ui.find({ type: 'Text', text: /^why$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})
