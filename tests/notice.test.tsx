import { expect, test } from 'claude-code/testing'
import type { ModelUsage } from 'claude-code'

import { topActions, withRefs } from '../hooks/auditFile'
import { noticeLabel } from '../hooks/noticeView'
import type { Finding } from '../types'
import { BAND, MEASURE, START, USAGE, engine } from './fixtures'

const base = (id: string, severity: Finding['severity']): Finding => ({
  id,
  category: 'Memory files',
  categoryKind: 'used',
  severity,
  title: id,
  tokens: 1000,
  measured: [],
  why: '',
  actions: [],
  source: 'rule',
})

test('topActions ranks every step by tokens freed, then severity, and keeps the CD references', () => {
  const findings = withRefs([
    { ...base('a', 'low'), plan: [{ text: 'a1', saves: 500 }, { text: 'a2', saves: 9000 }] },
    { ...base('b', 'high'), plan: [{ text: 'b1', saves: 500 }], deep: { note: '', steps: [{ text: 'b-deep', saves: 20000 }] } },
    { ...base('c', 'med'), plan: [{ text: 'c1', saves: null }] },
  ])
  const top = topActions(findings, 4)
  expect(top.map(t => t.ref)).toEqual(['CD-2.2', 'CD-1.2', 'CD-2.1', 'CD-1.1'])
  expect(top[0]).toMatchObject({ findingId: 'b', from: 'deep', index: 0 })
  expect(topActions(findings).length).toBe(5)
})

test('the notice says what is running and for how long', () => {
  const running = { state: 'running', kind: 'audit', model: 'claude-opus-5-5', startedAt: 0, endedAt: null, message: null } as const
  expect(noticeLabel(running, 12_000, 1, null)).toBe('◓ context doctor · auditing with opus 5.5 · 12s')
  expect(noticeLabel({ ...running, state: 'failed', endedAt: 1 }, 2, 0, null)).toBe('✗ context doctor audit failed')
})

const DOCTOR_PANE = {
  plugin: 'context-bar',
  component: 'Pane',
  requestId: 'context-doctor',
  props: { title: 'Context doctor', isFocused: true, bodyColumns: 120, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const USED: ModelUsage = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('after the AI audit the bar says it is ready; a press shows the summary, the top actions and the file', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('fs.read', () => ({ value: '## A\nx\n## B\ny' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      usage: USED,
      text: JSON.stringify({
        summary: 'Slim CLAUDE.md first.',
        plans: [{ id: 'memory:/Users/someone/projects/app/CLAUDE.md', steps: [{ text: 'Move §8 to a skill', saves: 18000 }] }],
        extra: [],
      }),
    },
  }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const pane = await $.ui.mount({ ...DOCTOR_PANE, surface: 'terminal' })
  await pane.press({ key: 'rescan' })
  await pane.press({ key: 'ask' })

  const bar = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await bar.find({ key: 'doctor-notice' }))?.text ?? '').toMatch(/✓ context audit ready · CA-\d{8}-\d{4}/)
  expect(await bar.find({ type: 'Text', text: /Top 1 actions/ })).toBeUndefined()

  await bar.press({ key: 'doctor-notice' })
  expect(await bar.find({ type: 'Text', text: /Slim CLAUDE\.md first\./ })).toBeDefined()
  expect(await bar.find({ type: 'Text', text: /Top 1 actions/ })).toBeDefined()
  expect(await bar.find({ type: 'Text', text: /^CD-\d+\.1$/ })).toBeDefined()
  expect(await bar.find({ key: 'notice-copy' })).toBeDefined()

  await bar.press({ key: 'doctor-notice-dismiss' })
  expect(await bar.find({ key: 'doctor-notice' })).toBeUndefined()
  await bar.unmount()
  await pane.unmount()
})
