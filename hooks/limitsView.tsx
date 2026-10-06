import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { Limit } from '../types'
import { FREE, money } from './categories'
import { METER_CELLS, METER_EMPTY, METER_FULL, filledCells, limitColor, percentText, untilReset } from './limits'

type Els = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }

const GAP = 1
const SEP = ' | '
const DIVIDER = '| '

/**
 * Each window's label in its own colour, and the reset time in another, so the line reads at a glance. Theme keys,
 * so each one reads in the person's theme.
 */
export const LIMIT_COLORS = {
  session: 'permission',
  week: 'autoAccept',
  model: 'bashBorder',
  other: 'warning',
  reset: 'planMode',
  cost: 'success',
} as const

export function labelColor(kind: string): string {
  if (kind === 'five_hour') return LIMIT_COLORS.session
  if (kind === 'seven_day') return LIMIT_COLORS.week
  if (/^(five_hour|seven_day)_./.test(kind)) return LIMIT_COLORS.model
  return LIMIT_COLORS.other
}

/** The reset note in its long form (`resets in 2h 14m`) or, when the row is tight, its short one (`↻ 2h 14m`). */
function resetNote(limit: Limit, now: number, long: boolean): string | null {
  const left = untilReset(limit.resetsAt, now)
  if (!left) return null
  return long ? `resets in ${left}` : `↻ ${left}`
}

/** How many cells one entry takes: `| week ▰▰▰▱▱▱ 42% | resets in 2h 14m` (the first has no leading divider). */
function entryWidth(limit: Limit, now: number, long: boolean, first: boolean): number {
  const note = resetNote(limit, now, long)
  return (
    (first ? 0 : DIVIDER.length) +
    limit.label.length + 1 + METER_CELLS + 1 + percentText(limit.percent).length +
    (note ? SEP.length + note.length : 0)
  )
}

/** What this session would have cost at API list prices: a gauge of how heavy it is, not a bill on a subscription. */
function costText(cost: number): string {
  return `session spent in api cost ${money(cost)}`
}

/** The whole row's width with every entry on one line, the cost included. */
function rowWidth(limits: readonly Limit[], now: number, long: boolean, cost: number | null): number {
  const windows = limits.reduce((n, l, i) => n + entryWidth(l, now, long, i === 0), 0) + GAP * Math.max(0, limits.length - 1)
  if (cost === null) return windows
  return windows + (limits.length ? GAP + DIVIDER.length : 0) + costText(cost).length
}

/**
 * One row of the account's rate-limit windows, `session ▰▰▰▱▱▱ 42% | resets in 2h 14m | week ...`: each label in
 * its own colour (LIMIT_COLORS), a 6-cell meter coloured by how full it is, the percent bold, the reset in teal. `columns` is the width the row may use
 * (the caller's inner width); when the long reset notes would not fit on one line they shorten to `↻ 2h 14m`,
 * and when even that does not fit the entries wrap. Null when there are no windows (off a subscription, or
 * before the first API response).
 */
export function limitsLine(
  els: Els,
  limits: readonly Limit[],
  now: number,
  columns: number,
  cost: number | null = null,
): RenderElement | null {
  if (limits.length === 0 && cost === null) return null
  const { Box, Text } = els
  const long = rowWidth(limits, now, true, cost) <= columns

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={GAP}>
      {limits.map((l, i) => {
        const filled = filledCells(l.percent, METER_CELLS)
        const note = resetNote(l, now, long)
        return (
          <Text wrap="truncate">
            {i > 0 && <Text dimColor>{DIVIDER}</Text>}
            <Text color={labelColor(l.kind)}>{`${l.label} `}</Text>
            {filled > 0 && <Text color={limitColor(l.percent)}>{METER_FULL.repeat(filled)}</Text>}
            {filled < METER_CELLS && <Text color={FREE}>{METER_EMPTY.repeat(METER_CELLS - filled)}</Text>}
            <Text bold>{` ${percentText(l.percent)}`}</Text>
            {note && <Text dimColor>{SEP}</Text>}
            {note && <Text color={LIMIT_COLORS.reset}>{note}</Text>}
          </Text>
        )
      })}
      {cost !== null && (
        <Text wrap="truncate">
          {limits.length > 0 && <Text dimColor>{DIVIDER}</Text>}
          <Text color={LIMIT_COLORS.cost}>{costText(cost)}</Text>
        </Text>
      )}
    </Box>
  )
}
