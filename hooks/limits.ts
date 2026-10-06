// The account's rate-limit windows (what /usage shows): which window is which, in what order, how full, and
// when each resets. Pure: the bar hands in what `$.session.usage().rateLimits` returned and a clock reading;
// nothing here reads the engine, the locale or a time zone.

import type { Limit } from '../types'

/** One window as the engine reports it (`SessionRateLimit`). */
export type RawLimit = { kind: string; percentUsed: number; resetsAt?: string }

const SESSION = 'five_hour'
const WEEK = 'seven_day'
const SPEND = 'spend_limit'

const GREEN = '#8FD18B'
const YELLOW = '#F2C76E'
const RED = '#E8775A'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `five_hour_fable` → `fable`; null when `kind` is not `<window>_<something>`. */
function modelOf(kind: string, window: string): string | null {
  const prefix = `${window}_`
  if (!kind.startsWith(prefix)) return null
  const model = spaced(kind.slice(prefix.length))
  return model.length > 0 ? model : null
}

function spaced(text: string): string {
  return text.replace(/_+/g, ' ').trim()
}

/**
 * What the bar prints for a window. The documented kinds have fixed names; a model-specific window the engine
 * reports (not documented, so never relied on by name) reads `<model> week` / `<model> session`; anything else
 * is its raw name with underscores as spaces.
 */
export function labelFor(kind: string): string {
  if (kind === SESSION) return 'session'
  if (kind === WEEK) return 'week'
  if (kind === SPEND) return 'spend'
  const weekModel = modelOf(kind, WEEK)
  if (weekModel) return `${weekModel} week`
  const sessionModel = modelOf(kind, SESSION)
  if (sessionModel) return `${sessionModel} session`
  return spaced(kind) || kind
}

/** 0 session, 1 week, 2 a model-specific session or week, 3 everything else (a spend limit, an unknown kind). */
function rank(kind: string): number {
  if (kind === SESSION) return 0
  if (kind === WEEK) return 1
  if (modelOf(kind, WEEK) || modelOf(kind, SESSION)) return 2
  return 3
}

/**
 * The windows as the bar shows them: session, week, then model-specific windows, then the rest, each group in
 * the order the engine reported it. Every window reported is kept, unknown kinds included.
 */
export function toLimits(raw: readonly RawLimit[]): Limit[] {
  return raw
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.kind) - rank(b.r.kind) || a.i - b.i)
    .map(({ r }) => ({
      kind: r.kind,
      label: labelFor(r.kind),
      percent: Number.isFinite(r.percentUsed) ? r.percentUsed : 0,
      resetsAt: r.resetsAt ? r.resetsAt : null,
    }))
}

/**
 * How long until `resetsAt`, from `now` (ms since the epoch): `12m`, `2h 14m`, `3d 4h`, `<1m`. Null when the
 * timestamp is missing, unreadable, or already past. ISO 8601 parsing is locale-independent, so is this.
 */
export function untilReset(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null
  const at = Date.parse(resetsAt)
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null
  const left = at - now
  if (left <= 0) return null
  if (left < MINUTE) return '<1m'
  const days = Math.floor(left / DAY)
  const hours = Math.floor((left % DAY) / HOUR)
  const minutes = Math.floor((left % HOUR) / MINUTE)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** `resets in 2h 14m`; null when there is nothing to say (no timestamp, or it already passed). */
export function resetsIn(resetsAt: string | null, now: number): string | null {
  const left = untilReset(resetsAt, now)
  return left ? `resets in ${left}` : null
}

/** Green under 60%, yellow under 85%, red from there on. */
export function limitColor(percent: number): string {
  if (percent < 60) return GREEN
  if (percent < 85) return YELLOW
  return RED
}

/** `42%`. Rounded, except that a window not yet full never reads 100%. */
export function percentText(percent: number): string {
  const p = Number.isFinite(percent) ? Math.max(0, percent) : 0
  const shown = p < 100 ? Math.min(99, Math.round(p)) : Math.round(p)
  return `${shown}%`
}

/** How many of `cells` meter cells are filled at `percent`: 42% of 6 → 3; never below 0 or above `cells`. */
export function filledCells(percent: number, cells: number): number {
  const p = Number.isFinite(percent) ? percent : 0
  return Math.max(0, Math.min(cells, Math.round((p / 100) * cells)))
}

export const METER_CELLS = 6
export const METER_FULL = '▰'
export const METER_EMPTY = '▱'

/** The meter as text, `▰▰▰▱▱▱` at 42%: for width sums and tests (the view colours the two halves itself). */
export function meter(percent: number, cells: number = METER_CELLS): string {
  const filled = filledCells(percent, cells)
  return METER_FULL.repeat(filled) + METER_EMPTY.repeat(cells - filled)
}
