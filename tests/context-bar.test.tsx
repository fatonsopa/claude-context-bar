import { expect, test } from 'claude-code/testing'
import { BAND, BREAKDOWN, MEASURE, START, USAGE, run, engine } from './fixtures'

import { buildSnapshot } from '../hooks/snapshot'
import { barCells } from '../hooks/barView'
import { fmt } from '../hooks/categories'


test('fmt prints tokens the way the screenshot does', () => {
  expect(fmt(950)).toBe('950')
  expect(fmt(4200)).toBe('4.2k')
  expect(fmt(17000)).toBe('17k')
  expect(fmt(897000)).toBe('897k')
  expect(fmt(1_000_000)).toBe('1M')
})

test('the bar fills its width and marks where auto-compaction starts', () => {
  const snap = buildSnapshot(BREAKDOWN, 'summary', [], null, 0)
  const cells = barCells(snap, 100)
  expect(cells.length).toBe(100)
  expect(cells.filter(c => c.ch === '┃').length).toBe(1)
  // every non-empty in-window category gets at least one cell
  const used = new Set(cells.filter(c => c.ch === '█').map(c => c.color))
  expect(used.size).toBeGreaterThanOrEqual(7)
})

test('the band shows the totals and every category, on terminal and desktop', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    if (!(await ui.find({ key: 'pick:Skills' }))) await ui.press({ key: 'legend' })
    expect(await ui.find({ type: 'Text', text: /of 1M · compacts at 987k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 9% / })).toBeDefined()
    for (const key of ['System prompt', 'System tools', 'MCP tools', 'Custom agents', 'Memory files', 'Skills']) {
      expect(await ui.find({ key: `pick:${key}` })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('clicking a category lists what inside it uses tokens; clicking again closes it', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'legend' })
  expect(await ui.find({ type: 'Text', text: /app\/CLAUDE\.md/ })).toBeUndefined()

  await ui.press({ key: 'pick:Memory files' })
  expect(await ui.find({ type: 'Text', text: /~\/projects\/app\/CLAUDE\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rules\/style\.md/ })).toBeDefined()

  await ui.press({ key: 'pick:MCP tools' })
  expect(await ui.find({ text: /claude\.ai Ahrefs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /app\/CLAUDE\.md/ })).toBeUndefined()

  await ui.press({ key: 'pick:MCP tools' })
  expect(await ui.find({ text: /claude\.ai Ahrefs/ })).toBeUndefined()
  await ui.unmount()
})

test('a survey takes the band', async ($, on) => {
  // the band handed back: the test stands in for the engine's own drawing
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ key: 'pick:Memory files' })).toBeUndefined()
  await ui.unmount()
})

test('/context-bar off hides the band and /context-bar shows it again', async ($, on) => {
  // the band handed back: the test stands in for the engine's own drawing
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'legend' })).toBeDefined()

  await $.command.run(run('off'))
  expect(await ui.find({ key: 'legend' })).toBeUndefined()

  await $.command.run(run(''))
  expect(await ui.find({ key: 'legend' })).toBeDefined()
  await ui.unmount()
})

test('the band shows every rate-limit window the engine reports: session, week, fable week', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /session.*42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^week|[^a-z]week.*19%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fable week.*7%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /session spent in api cost \$1\.23/ })).toBeDefined()
  await ui.unmount()
})

test('the categories stay hidden until the bar itself is clicked (or ▸ is pressed)', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'bar' })).toBeDefined()
  expect(await ui.find({ key: 'pick:Skills' })).toBeUndefined()

  await ui.pointer({ in: 'bar', type: 'down', x: 2, y: 0, button: 'left' })
  expect(await ui.find({ key: 'pick:Skills' })).toBeDefined()

  await ui.pointer({ in: 'bar', type: 'down', x: 2, y: 0, button: 'left' })
  expect(await ui.find({ key: 'pick:Skills' })).toBeUndefined()

  await ui.press({ key: 'legend' })
  expect(await ui.find({ key: 'pick:Skills' })).toBeDefined()
  await ui.unmount()
})

test('the third level: a server holds its tools, a file its sections, a skill its description', () => {
  const path = '/Users/someone/projects/app/CLAUDE.md'
  const snap = buildSnapshot(BREAKDOWN, 'summary', [], null, 0, {
    fileSections: { [path]: [{ label: '8. Trigger commands', tokens: 1000 }, { label: '1. Rules', tokens: 500 }] },
    commands: [{ name: 'push-pipeline', description: 'Validate dev work and push it to staging', source: 'user' }],
  })
  const server = snap.details['MCP tools']?.items.find(i => i.label === 'claude.ai Ahrefs')
  expect(server?.children?.map(c => c.label)).toEqual(['a', 'b'])
  const file = snap.details['Memory files']?.items.find(i => i.label === '~/projects/app/CLAUDE.md')
  expect(file?.children?.map(c => c.label)).toEqual(['8. Trigger commands', '1. Rules'])
  const skill = snap.details['Skills']?.items.find(i => i.label === 'push-pipeline')
  expect(skill?.preview).toBe('Validate dev work and push it to staging')
})

test('clicking an item opens its third level in place, and clicking again closes it', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'legend' })
  await ui.press({ key: 'pick:MCP tools' })
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeUndefined()

  await ui.press({ key: 'item:MCP tools::claude.ai Ahrefs' })
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^b$/ })).toBeDefined()

  await ui.press({ key: 'item:MCP tools::claude.ai Ahrefs' })
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeUndefined()
  await ui.unmount()
})
