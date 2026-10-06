import { expect, test } from 'claude-code/testing'
import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { Limit } from '../types'
import { labelFor, limitColor, meter, percentText, resetsIn, toLimits, untilReset } from '../hooks/limits'
import { LIMIT_COLORS, labelColor, limitsLine } from '../hooks/limitsView'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (ms: number) => new Date(NOW + ms).toISOString()

// ------------------------------------------------------------------ labelFor

test('labelFor names the documented windows', () => {
  expect(labelFor('five_hour')).toBe('session')
  expect(labelFor('seven_day')).toBe('week')
  expect(labelFor('spend_limit')).toBe('spend')
})

test('labelFor reads a model-specific window as "<model> week" / "<model> session"', () => {
  expect(labelFor('seven_day_fable')).toBe('fable week')
  expect(labelFor('seven_day_opus')).toBe('opus week')
  expect(labelFor('seven_day_sonnet')).toBe('sonnet week')
  expect(labelFor('seven_day_oauth_apps')).toBe('oauth apps week')
  expect(labelFor('five_hour_fable')).toBe('fable session')
  expect(labelFor('five_hour_opus')).toBe('opus session')
})

test('labelFor shows any other kind as its raw name with underscores as spaces', () => {
  expect(labelFor('monthly_cap')).toBe('monthly cap')
  expect(labelFor('overage')).toBe('overage')
  expect(labelFor('seven_day_')).toBe('seven day')
  expect(labelFor('seven_days')).toBe('seven days')
})

// ------------------------------------------------------------------ toLimits

test('toLimits orders session, week, model-specific, then the rest, and keeps every window', () => {
  const limits = toLimits([
    { kind: 'spend_limit', percentUsed: 112 },
    { kind: 'seven_day_fable', percentUsed: 61, resetsAt: at(3 * DAY) },
    { kind: 'mystery_window', percentUsed: 5 },
    { kind: 'seven_day', percentUsed: 23.5, resetsAt: at(4 * DAY) },
    { kind: 'five_hour_opus', percentUsed: 10 },
    { kind: 'five_hour', percentUsed: 42, resetsAt: at(2 * HOUR + 14 * MIN) },
  ])
  expect(limits.map(l => l.kind)).toEqual([
    'five_hour',
    'seven_day',
    'seven_day_fable',
    'five_hour_opus',
    'spend_limit',
    'mystery_window',
  ])
  expect(limits.map(l => l.label)).toEqual(['session', 'week', 'fable week', 'opus session', 'spend', 'mystery window'])
})

test('toLimits passes percent and reset through, and a missing reset becomes null', () => {
  const limits = toLimits([
    { kind: 'unknown_kind', percentUsed: 7 },
    { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-09T08:00:00Z' },
  ])
  expect(limits).toEqual([
    { kind: 'seven_day', label: 'week', percent: 23.5, resetsAt: '2026-10-09T08:00:00Z' },
    { kind: 'unknown_kind', label: 'unknown kind', percent: 7, resetsAt: null },
  ])
})

test('toLimits of nothing is nothing (off a subscription, or before the first API response)', () => {
  expect(toLimits([])).toEqual([])
})

// ------------------------------------------------------------------ resetsIn

test('resetsIn counts minutes, hours and minutes, days and hours', () => {
  expect(resetsIn(at(12 * MIN), NOW)).toBe('resets in 12m')
  expect(resetsIn(at(2 * HOUR + 14 * MIN), NOW)).toBe('resets in 2h 14m')
  expect(resetsIn(at(2 * HOUR + 14 * MIN + 59_000), NOW)).toBe('resets in 2h 14m')
  expect(resetsIn(at(2 * HOUR), NOW)).toBe('resets in 2h')
  expect(resetsIn(at(3 * DAY + 4 * HOUR + 30 * MIN), NOW)).toBe('resets in 3d 4h')
  expect(resetsIn(at(3 * DAY + 10 * MIN), NOW)).toBe('resets in 3d')
  expect(resetsIn(at(30_000), NOW)).toBe('resets in <1m')
})

test('resetsIn reads the offset in the timestamp, not the local time zone', () => {
  expect(resetsIn('2026-10-06T14:14:00+02:00', NOW)).toBe('resets in 14m')
})

test('resetsIn says nothing for a past, current, missing or unreadable reset', () => {
  expect(resetsIn(at(-5 * MIN), NOW)).toBeNull()
  expect(resetsIn(at(0), NOW)).toBeNull()
  expect(resetsIn(null, NOW)).toBeNull()
  expect(resetsIn('', NOW)).toBeNull()
  expect(resetsIn('not a date', NOW)).toBeNull()
  expect(untilReset(at(2 * HOUR + 14 * MIN), NOW)).toBe('2h 14m')
})

// ------------------------------------------------------------------ limitColor, meter, percent

test('limitColor is green under 60, yellow under 85, red from 85', () => {
  expect(limitColor(0)).toBe('#8FD18B')
  expect(limitColor(59.9)).toBe('#8FD18B')
  expect(limitColor(60)).toBe('#F2C76E')
  expect(limitColor(84.9)).toBe('#F2C76E')
  expect(limitColor(85)).toBe('#E8775A')
  expect(limitColor(100)).toBe('#E8775A')
  expect(limitColor(112)).toBe('#E8775A')
})

test('the meter fills 6 cells in proportion and never overflows', () => {
  expect(meter(42)).toBe('▰▰▰▱▱▱')
  expect(meter(0)).toBe('▱▱▱▱▱▱')
  expect(meter(100)).toBe('▰▰▰▰▰▰')
  expect(meter(130)).toBe('▰▰▰▰▰▰')
  expect(meter(-4)).toBe('▱▱▱▱▱▱')
})

test('the percent is rounded, and a window not yet full never reads 100%', () => {
  expect(percentText(42)).toBe('42%')
  expect(percentText(23.5)).toBe('24%')
  expect(percentText(99.6)).toBe('99%')
  expect(percentText(100)).toBe('100%')
  expect(percentText(112)).toBe('112%')
})

// ------------------------------------------------------------------ limitsLine

type Drawn = { type: string; props: Record<string, unknown>; children: unknown[] }

function flat(children: unknown): unknown[] {
  if (children === undefined || children === null || children === false || children === true) return []
  return Array.isArray(children) ? children.flatMap(flat) : [children]
}

function fake(type: string) {
  return (props: object): RenderElement => {
    const { children, ...rest } = props as { children?: unknown }
    const drawn: Drawn = { type, props: rest, children: flat(children) }
    return drawn as unknown as RenderElement
  }
}

const ELS = {
  Box: fake('Box') as ElementConstructor<BoxProps>,
  Text: fake('Text') as ElementConstructor<TextProps>,
  Button: fake('Button') as ElementConstructor<ButtonProps>,
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'children' in node) return textOf((node as Drawn).children)
  return ''
}

const SESSION: Limit = { kind: 'five_hour', label: 'session', percent: 42, resetsAt: at(2 * HOUR + 14 * MIN) }
const WEEK: Limit = { kind: 'seven_day', label: 'week', percent: 23.5, resetsAt: at(3 * DAY + 4 * HOUR) }
const FABLE: Limit = { kind: 'seven_day_fable', label: 'fable week', percent: 88, resetsAt: null }

test('limitsLine draws nothing when there are no windows', () => {
  expect(limitsLine(ELS, [], NOW, 100)).toBeNull()
})

test('limitsLine draws one wrapping row with each window\'s meter, percent and reset', () => {
  const row = limitsLine(ELS, [SESSION, WEEK, FABLE], NOW, 100) as unknown as Drawn
  expect(row.type).toBe('Box')
  expect(row.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })
  expect(row.children.map(textOf)).toEqual([
    'session ▰▰▰▱▱▱ 42% | resets in 2h 14m',
    '| week ▰▱▱▱▱▱ 24% | resets in 3d 4h',
    '| fable week ▰▰▰▰▰▱ 88%',
  ])
})

test('limitsLine shortens the reset notes when the long ones would not fit', () => {
  const row = limitsLine(ELS, [SESSION, WEEK, FABLE], NOW, 60) as unknown as Drawn
  expect(row.children.map(textOf)).toEqual([
    'session ▰▰▰▱▱▱ 42% | ↻ 2h 14m',
    '| week ▰▱▱▱▱▱ 24% | ↻ 3d 4h',
    '| fable week ▰▰▰▰▰▱ 88%',
  ])
})

test('limitsLine colours session, week, a model window and the reset time differently', () => {
  const row = limitsLine(ELS, [SESSION, WEEK, FABLE], NOW, 100) as unknown as Drawn
  const parts = (n: number) => ((row.children[n] as Drawn).children as Drawn[]).map(c => ({ text: textOf(c), color: c.props.color }))
  expect(parts(0)).toContainEqual({ text: 'session ', color: LIMIT_COLORS.session })
  expect(parts(0)).toContainEqual({ text: 'resets in 2h 14m', color: LIMIT_COLORS.reset })
  expect(parts(1)).toContainEqual({ text: 'week ', color: LIMIT_COLORS.week })
  expect(parts(2)).toContainEqual({ text: 'fable week ', color: LIMIT_COLORS.model })
  expect(new Set([LIMIT_COLORS.session, LIMIT_COLORS.week, LIMIT_COLORS.model, LIMIT_COLORS.reset]).size).toBe(4)
  expect(labelColor('spend_limit')).toBe(LIMIT_COLORS.other)
})

test('limitsLine ends with this session\'s cost, in its own colour', () => {
  const row = limitsLine(ELS, [SESSION, WEEK], NOW, 120, 1.234) as unknown as Drawn
  const texts = row.children.map(textOf)
  expect(texts[texts.length - 1]).toBe('| session spent in api cost $1.23')
  const last = (row.children[row.children.length - 1] as Drawn).children as Drawn[]
  expect(last.map(c => ({ text: textOf(c), color: c.props.color }))).toContainEqual({ text: 'session spent in api cost $1.23', color: LIMIT_COLORS.cost })
  // with no windows reported (off a subscription) the cost still shows, without a leading divider
  expect((limitsLine(ELS, [], NOW, 120, 0.004) as unknown as Drawn).children.map(textOf)).toEqual(['session spent in api cost <$0.01'])
  expect(limitsLine(ELS, [], NOW, 120, null)).toBeNull()
})
