// The bar itself: totals, limits, the coloured strip, and the categories with their second and third levels.
// Drawn for the band above the prompt and for the /context-bar pane alike.

import type { BoxProps, ButtonProps, ClientProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { Detail, Item, Row, Snapshot } from '../types'
import { ACCENT, BAD, BORDER, FREE, GOOD, MARKER, MUTED, WARN, fmt, pct } from './categories'
import { limitsLine } from './limitsView'

export type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  /** Terminal and desktop only: the bar is drawn by ./barClient.tsx there, so it can be clicked. */
  Client?: ElementConstructor<ClientProps>
}

type Cell = { ch: string; color: string }

/** One cell per column: each in-window row gets its share (largest remainder), every non-empty row ≥ 1 cell. */
export function barCells(snap: Snapshot, width: number): Cell[] {
  const w = Math.max(1, width)
  const max = Math.max(1, snap.max)
  const rows = snap.rows.filter(r => r.kind === 'used')
  const raw = rows.map(r => (Math.max(0, r.tokens) / max) * w)
  const counts = raw.map((x, i) => {
    const floor = Math.floor(x)
    return floor === 0 && (rows[i]?.tokens ?? 0) > 0 ? 1 : floor
  })
  let used = counts.reduce((a, b) => a + b, 0)
  const room = Math.min(w, Math.round((Math.min(snap.total, max) / max) * w))
  const order = raw
    .map((x, i) => ({ frac: x - Math.floor(x), i }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (used >= room) break
    counts[i] = (counts[i] ?? 0) + 1
    used += 1
  }
  while (used > w) {
    let big = 0
    counts.forEach((c, i) => {
      if (c > (counts[big] ?? 0)) big = i
    })
    counts[big] = (counts[big] ?? 1) - 1
    used -= 1
  }
  const cells: Cell[] = []
  rows.forEach((r, i) => {
    for (let k = 0; k < (counts[i] ?? 0); k += 1) cells.push({ ch: '█', color: r.display })
  })
  while (cells.length < w) cells.push({ ch: '█', color: FREE })
  if (snap.threshold !== null) {
    const at = Math.min(w - 1, Math.floor((snap.threshold / max) * w))
    // the marker sits on free space only; once the context passes the threshold the used colour wins
    if ((cells[at]?.color ?? FREE) === FREE) cells[at] = { ch: '┃', color: MARKER }
  }
  return cells.slice(0, w)
}

function runs(cells: Cell[]): Cell[] {
  const out: Cell[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.color === c.color && last.ch[0] === c.ch) last.ch += c.ch
    else out.push({ ...c })
  }
  return out
}

function miniBar(share: number, width: number): string {
  const n = Math.max(share > 0 ? 1 : 0, Math.round(share * width))
  return '▮'.repeat(Math.min(width, n)) + '·'.repeat(Math.max(0, width - n))
}

function badgeColor(snap: Snapshot): string {
  const ratio = snap.total / Math.max(1, snap.threshold ?? snap.max)
  if (ratio < 0.6) return GOOD
  if (ratio < 0.85) return WARN
  return BAD
}

/**
 * Each button's own colour, a theme key, so it reads in the person's theme on every surface. Used the way the
 * categories use theirs: a ■ in it before the label, and the label lights up in it, bold, under the pointer.
 */
export const BUTTON_COLOR = { recalculate: 'suggestion', compact: 'success', clear: 'error' } as const

/** Before every button, as before every category. */
export const SQUARE = '■ '
/** Before a suggested button: the mark the categories use for the one selected. */
export const SUGGESTED_SQUARE = '▣ '

/** Between the header buttons. */
const SEPARATOR = '|'

/** The widest the recalculate button gets ("recalculating…"), kept free at the limits line's right end. */
const RECALCULATE_W = `${'■ '}recalculating…`.length

export type ViewArgs = {
  els: Els
  snap: Snapshot | null
  selectedName: string | null
  counting: boolean
  error: string | null
  columns: number
  maxRows: number
  onPick: (name: string) => void
  onExact: () => void
  /** The categories under the bar are hidden until the bar is clicked. */
  legendOpen: boolean
  onToggleLegend: () => void
  /** The item open to its third level (`<category>::<label>`), and the press that opens or closes one. */
  openItem: string | null
  onOpenItem: (key: string) => void
  /** The context doctor's job line (./noticeView.tsx), drawn under the limits; null when there is none. */
  notice: RenderElement | null
  /** A new version installed or out (./updateView.tsx), drawn under the doctor's line; null when there is none. */
  update: RenderElement | null
  /** "handoff & compact", at any time (the same as the suggestion's main button). */
  onCompact: () => void
  /** A good moment to compact: "handoff & compact" lights up. */
  compactRecommended: boolean
  /** "handoff & clear" at any time. */
  onClear: () => void
  /** A hard end (a push, a long skill run): "handoff & clear" lights up too. */
  clearRecommended: boolean
  /** The compaction suggestion (./compactView.tsx); null when there is none. */
  compact: RenderElement | null
}

export function view(a: ViewArgs) {
  const { Box, Text, Button, Client } = a.els
  const inner = Math.max(20, a.columns - 4)

  if (!a.snap) {
    return (
      <Box borderStyle="round" borderColor={BORDER} paddingX={1} width={a.columns}>
        <Text>
          <Text color={ACCENT}>◆ </Text>
          <Text bold>context</Text>
          <Text dimColor>{a.error ? `  unavailable: ${a.error}` : '  measuring…'}</Text>
        </Text>
      </Box>
    )
  }

  const snap = a.snap
  const compacts = snap.threshold !== null ? `compacts at ${fmt(snap.threshold)}` : 'auto-compact off'
  const legend = snap.rows.filter(r => r.kind !== 'buffer' && (r.tokens > 0 || r.kind === 'free'))
  const sel = a.selectedName ? snap.rows.find(r => r.name === a.selectedName) : undefined
  const detail = sel ? snap.details[sel.name] : undefined

  return (
    <Box borderStyle="round" borderColor={BORDER} paddingX={1} flexDirection="column" width={a.columns}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" columnGap={1}>
          <Text wrap="truncate">
            <Text color={ACCENT}>◆ </Text>
            <Text bold>context</Text>
            <Text dimColor>{snap.detail === 'full' ? '  exact' : '  est.'}</Text>
          </Text>
          <Button key="legend" plain dimColor label={a.legendOpen ? '▾' : '▸'} onPress={() => a.onToggleLegend()} />
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text wrap="truncate">
            <Text bold>{fmt(snap.total)}</Text>
            <Text dimColor>{` of ${fmt(snap.max)} · ${compacts}`}</Text>
          </Text>
          {/* The two handoff buttons, styled as the categories are: a ■ in the button's colour, then the label, which
              lights up in that colour under the pointer; a suggested one shows ▣. | between them. recalculate sits
              at the far right of the limits line. A hover needs a keyed Box around its Button. */}
          <Box key="compact-anytime-box" flexDirection="row">
            <Text color={BUTTON_COLOR.compact}>{a.compactRecommended ? SUGGESTED_SQUARE : SQUARE}</Text>
            <Button key="compact-anytime" plain hover={{ color: BUTTON_COLOR.compact, bold: true }} label="handoff & compact" onPress={() => a.onCompact()} />
          </Box>
          <Text dimColor>{SEPARATOR}</Text>
          <Box key="clear-anytime-box" flexDirection="row">
            <Text color={BUTTON_COLOR.clear}>{a.clearRecommended ? SUGGESTED_SQUARE : SQUARE}</Text>
            <Button key="clear-anytime" plain hover={{ color: BUTTON_COLOR.clear, bold: true }} label="handoff & clear" onPress={() => a.onClear()} />
          </Box>
          <Text backgroundColor={badgeColor(snap)} color="inverseText" bold>
            {` ${Math.round(snap.percent)}% `}
          </Text>
        </Box>
      </Box>

      {/* a blank line between the header and the limits line; recalculate sits at the line's far right */}
      <Box key="limits" marginTop={1} flexDirection="row" justifyContent="space-between" columnGap={1}>
        <Box flexShrink={1}>{limitsLine(a.els, snap.limits, snap.at, inner - RECALCULATE_W - 1, snap.cost)}</Box>
        <Box key="recalculate-box" flexDirection="row" flexShrink={0}>
          <Text color={BUTTON_COLOR.recalculate}>{SQUARE}</Text>
          <Button
            key="recalculate"
            plain
            hover={{ color: BUTTON_COLOR.recalculate, bold: true }}
            label={a.counting ? 'recalculating…' : 'recalculate'}
            onPress={() => a.onExact()}
          />
        </Box>
      </Box>
      {a.notice}
      {a.update}

      {Client ? (
        <Client key="bar" module="./barClient.tsx" props={{ runs: runs(barCells(snap, inner)) }} width={inner} height={1} />
      ) : (
        <Text wrap="truncate">
          {runs(barCells(snap, inner)).map(r => (
            <Text color={r.color}>{r.ch}</Text>
          ))}
        </Text>
      )}

      {/* the compact suggestion has a place of its own, under the strip, so it never reads as part of the stats */}
      {a.compact}

      {a.legendOpen && (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {legend.map(row => {
          const isSel = row.name === sel?.name
          const off = row.kind === 'deferred'
          return (
            <Box key={`cat:${row.name}`} flexDirection="row">
              <Text color={row.display}>{isSel ? '▣ ' : '■ '}</Text>
              <Button
                key={`pick:${row.name}`}
                plain
                dimColor={off || row.kind === 'free'}
                // under the pointer the label lights up in its category's colour, so it reads as clickable
                hover={{ color: row.kind === 'free' ? MUTED : row.display, bold: true, dimColor: false }}
                label={row.label}
                onPress={() => a.onPick(row.name)}
              />
              <Text bold={!off} dimColor={off}>{` ${fmt(row.tokens)}`}</Text>
              {row.kind === 'used' && <Text dimColor>{` ${pct(row.tokens, snap.max)}`}</Text>}
            </Box>
          )
        })}
      </Box>

      )}

      {a.legendOpen && sel && detail && detailView(a, snap, sel, detail, inner)}
    </Box>
  )
}

function detailView(a: ViewArgs, snap: Snapshot, sel: Row, detail: Detail, inner: number) {
  const { Box, Text, Button } = a.els
  const color = sel.display
  const room = Math.max(3, Math.min(14, a.maxRows - 11))
  const items = detail.items.filter(i => i.tokens > 0)
  const shown = items.slice(0, room)
  const rest = items.slice(room)
  const sum = items.reduce((s, i) => s + i.tokens, 0)
  const top = shown[0]?.tokens ?? 0
  const free = sel.kind === 'free'
  const left = snap.threshold !== null ? Math.max(0, snap.threshold - snap.total) : null

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={color}>▸ </Text>
          <Text bold>{sel.label}</Text>
          <Text dimColor>
            {` · ${fmt(sel.tokens)}${items.length ? ` · ${items.length} item${items.length === 1 ? '' : 's'}` : ''}${detail.caption ? ` · ${detail.caption}` : ''}`}
          </Text>
        </Text>
        <Button key="close" plain dimColor label="✕ close" onPress={() => a.onPick(sel.name)} />
      </Box>
      {free && (
        <Text dimColor>
          {left !== null
            ? `  ${fmt(sel.tokens)} free · ${fmt(left)} until auto-compact at ${fmt(snap.threshold ?? 0)}`
            : `  ${fmt(sel.tokens)} free · auto-compact is off`}
        </Text>
      )}
      {!free && items.length === 0 && <Text dimColor>  not itemized by the engine</Text>}
      {shown.map(it => itemView(a, sel, it, top, sum, inner))}
      {rest.length > 0 && (
        <Text dimColor>{`  + ${rest.length} more · ${fmt(rest.reduce((s, i) => s + i.tokens, 0))}`}</Text>
      )}
    </Box>
  )
}

const BAR_W = 8
const TOKENS_W = 7
const PCT_W = 6
const CHILD_ROOM = 12

function cut(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

/**
 * One item of an open category. An item with something inside (a file's sections, a server's tools, a text
 * preview) gets a ▸ and its label is a button: a press opens it in place, indented under it; again, closes it.
 */
function itemView(a: ViewArgs, sel: Row, it: Item, top: number, sum: number, inner: number) {
  const { Box, Text, Button } = a.els
  const color = sel.display
  const key = `${sel.name}::${it.label}`
  const kids = it.children ?? []
  const deep = kids.length > 0 || !!it.preview
  const open = deep && a.openItem === key
  const labelW = Math.max(8, inner - 2 - (BAR_W + 1) - 2 - TOKENS_W - PCT_W - (it.note ? it.note.length + 2 : 0))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" width={inner}>
        <Text color={color}>{`  ${miniBar(top > 0 ? it.tokens / top : 0, BAR_W)} `}</Text>
        <Box width={2} flexShrink={0}>
          <Text dimColor>{deep ? (open ? '▾' : '▸') : ' '}</Text>
        </Box>
        <Box flexDirection="row" flexGrow={1} flexShrink={1}>
          {deep ? (
            <Button key={`item:${key}`} plain label={cut(it.label, labelW)} onPress={() => a.onOpenItem(key)} />
          ) : (
            <Text wrap="truncate-middle">{it.label}</Text>
          )}
          {it.note ? <Text dimColor wrap="truncate">{`  ${it.note}`}</Text> : null}
        </Box>
        <Box width={TOKENS_W} justifyContent="flex-end" flexShrink={0}>
          <Text bold>{fmt(it.tokens)}</Text>
        </Box>
        <Box width={PCT_W} justifyContent="flex-end" flexShrink={0}>
          <Text dimColor>{pct(it.tokens, sum)}</Text>
        </Box>
      </Box>
      {open && kids.length > 0 && childrenView(a, color, kids, inner)}
      {open && it.preview && (
        <Box marginLeft={2 + BAR_W + 1 + 2} width={inner - (2 + BAR_W + 1 + 2)}>
          <Text dimColor italic wrap="wrap">
            {it.preview}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** The third level: what is inside an item, largest first, each with its share of the item. */
function childrenView(a: ViewArgs, color: string, kids: readonly Item[], inner: number) {
  const { Box, Text } = a.els
  const shown = kids.filter(k => k.tokens > 0).slice(0, CHILD_ROOM)
  const rest = kids.filter(k => k.tokens > 0).slice(CHILD_ROOM)
  const sum = kids.reduce((n, k) => n + k.tokens, 0)
  const top = shown[0]?.tokens ?? 0
  const indent = 2 + BAR_W + 1 + 2
  return (
    <Box flexDirection="column" marginLeft={indent}>
      {shown.map(k => (
        <Box flexDirection="row" width={inner - indent}>
          <Text color={color}>{`${miniBar(top > 0 ? k.tokens / top : 0, 6)} `}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-middle">{k.label}</Text>
          </Box>
          <Box width={TOKENS_W} justifyContent="flex-end" flexShrink={0}>
            <Text>{fmt(k.tokens)}</Text>
          </Box>
          <Box width={PCT_W} justifyContent="flex-end" flexShrink={0}>
            <Text dimColor>{pct(k.tokens, sum)}</Text>
          </Box>
        </Box>
      ))}
      {rest.length > 0 && <Text dimColor>{`+ ${rest.length} more · ${fmt(rest.reduce((n, k) => n + k.tokens, 0))}`}</Text>}
    </Box>
  )
}
