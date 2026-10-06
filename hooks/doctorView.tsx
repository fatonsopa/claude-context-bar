import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  LinkProps,
  MarkdownProps,
  RenderElement,
  RenderSurface,
  TextProps,
} from 'claude-code'

import type { AiStep, DoctorReport, Effort, Finding, Row, Severity } from '../types'
import { ACCENT, BAD, BORDER, FREE, GOOD, MUTED, WARN, fmt, pct } from './categories'
import { EXPECTED_OUTPUT, estimateCost, money, shortModel } from './doctor'

type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Markdown?: ElementConstructor<MarkdownProps>
  Link?: ElementConstructor<LinkProps>
}

export type DoctorViewArgs = {
  els: Els
  report: DoctorReport | null
  /** The context bar's rows right now: each finding's category chip is drawn from these. */
  rows: readonly Row[]
  expanded: readonly string[]
  busy: string | null
  error: string | null
  model: string
  effort: Effort | null
  columns: number
  now: number
  /** The category the findings are filtered to (a /context row name), or null for all. */
  filter: string | null
  /** Where this project's audits are saved; shown before the first one exists. */
  auditFolder: string | null
  /** The last run's full audit: whether it is shown, and its Markdown once read. */
  auditOpen: boolean
  auditText: string | null
  on: {
    filter: (category: string) => void
    open: (path: string) => void
    toggleAudit: () => void
    toggle: (id: string) => void
    rescan: () => void
    ask: () => void
    deep: (id: string) => void
    draft: (id: string, step: number | null, from: 'plan' | 'deep') => void
    copy: (text: string, surface: RenderSurface) => void
    close: () => void
  }
}

const SEVERITY: Record<Severity, { glyph: string; color: string; word: string }> = {
  high: { glyph: '●', color: BAD, word: 'high' },
  med: { glyph: '●', color: WARN, word: 'med' },
  low: { glyph: '○', color: MUTED, word: 'low' },
  info: { glyph: '·', color: MUTED, word: 'info' },
}
const SAVES = GOOD

const CHEVRON_W = 2
const CHIP_W = 16
const SEV_W = 7
const TOKENS_W = 7
const PCT_W = 6
const SAVES_W = 8
const LABEL_W = 11

function cut(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

function pad(text: string, width: number): string {
  const t = cut(text, width)
  return t + ' '.repeat(Math.max(0, width - t.length))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `13:42 today`, `6 Oct 13:42`: when something happened, in local time. */
export function when(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? `${hm} today` : `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${hm}`
}

/** `just now`, `12 min ago`, `3 h ago`, `2 days ago`. */
export function ago(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const days = Math.floor(h / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function planSaves(f: Finding): number {
  const steps = f.deep?.steps.length ? f.deep.steps : (f.plan ?? [])
  return steps.reduce((n, s) => n + (s.saves ?? 0), 0)
}

export function doctorView(a: DoctorViewArgs) {
  const { Box, Text, Button } = a.els
  const inner = Math.max(40, a.columns - 4)
  const r = a.report
  const findings = r?.findings ?? []
  const freeable = findings.reduce((n, f) => n + planSaves(f), 0)
  const atStake = findings.filter(f => f.severity !== 'info').reduce((n, f) => n + f.tokens, 0)
  const aiCost = r ? estimateCost(a.model, r.aiInputTokens, EXPECTED_OUTPUT.audit) : null
  const modelText = `${shortModel(a.model)}${a.effort ? ` · ${a.effort}` : ''}`
  const status =
    a.busy === 'scan'
      ? 'scanning…'
      : a.busy === 'ai'
        ? `asking ${shortModel(a.model)}…`
        : a.busy?.startsWith('deep:')
          ? `deep-diving with ${shortModel(a.model)}…`
          : null

  return (
    <Box borderStyle="round" borderColor={BORDER} paddingX={1} flexDirection="column" width={a.columns}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={ACCENT}>◆ </Text>
          <Text bold>context doctor</Text>
        </Text>
        {r && (
          <Text wrap="truncate">
            <Text bold>{fmt(r.total)}</Text>
            <Text dimColor>{` of ${fmt(r.max)} · ${findings.length} finding${findings.length === 1 ? '' : 's'} · `}</Text>
            {freeable > 0 ? <Text color={SAVES}>{`could free ~${fmt(freeable)}`}</Text> : <Text dimColor>{`${fmt(atStake)} at stake`}</Text>}
          </Text>
        )}
      </Box>

      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Box flexDirection="row" columnGap={2}>
          <Button key="rescan" label="⟳ rescan" onPress={() => a.on.rescan()} />
          <Button
            key="ask"
            variant="primary"
            label={a.busy === 'ai' ? `asking ${modelText}…` : `✦ ask AI · ${modelText} · ~${money(aiCost)}`}
            onPress={() => a.on.ask()}
          />
        </Box>
        <Button key="close" role="dismiss" label="✕ close" onPress={() => a.on.close()} />
      </Box>

      {status && <Text dimColor>{status}</Text>}
      {a.error && <Text color={BAD}>{a.error}</Text>}
      {r?.summary && (
        <Box marginTop={1}>
          <Text italic>{r.summary}</Text>
        </Box>
      )}
      {r && auditLine(a, r)}
      {r && timesLine(a, r)}
      {r && chipsView(a, findings)}

      <Box flexDirection="column" marginTop={1}>
        {!r && <Text dimColor>scanning the context…</Text>}
        {r && findings.length === 0 && (
          <Text dimColor>Nothing crosses a threshold. Ask the AI for a second opinion if you want one.</Text>
        )}
        {a.filter && filterLine(a, findings)}
        {findings.filter(f => !a.filter || f.category === a.filter).map(f => findingView(a, f, inner))}
      </Box>

      {r?.audit && fullAuditView(a, r.audit)}

      {r && r.runs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {r.runs.slice(-3).map(run => (
            <Text dimColor wrap="truncate">
              {`AI · ${run.kind} · ${run.model} · ${fmt(run.inTokens)} in · ${fmt(run.outTokens)} out · ${money(run.cost)}${run.cost !== null ? ' at API prices' : ''}${run.error ? ` · ${run.error}` : ''}`}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

function findingView(a: DoctorViewArgs, f: Finding, inner: number) {
  const { Box, Text, Button } = a.els
  const open = a.expanded.includes(f.id)
  // the chip comes from the bar's current row of that name, so it always reads and colours like the bar
  const row = a.rows.find(x => x.name === f.category)
  const chipLabel = row?.label ?? f.category.toLowerCase()
  const chipColor = row?.display ?? FREE
  const sev = SEVERITY[f.severity]
  const saves = planSaves(f)
  const max = a.report?.max ?? 1
  const titleW = Math.max(12, inner - CHEVRON_W - CHIP_W - SEV_W - TOKENS_W - PCT_W - SAVES_W - 1)

  return (
    <Box key={`f:${f.id}`} flexDirection="column">
      <Box flexDirection="row">
        <Box width={CHEVRON_W}>
          <Text dimColor>{open ? '▾' : '▸'}</Text>
        </Box>
        <Box width={CHIP_W}>
          <Text wrap="truncate">
            <Text color={chipColor}>■ </Text>
            <Text color={chipColor}>{pad(chipLabel, CHIP_W - 3)}</Text>
          </Text>
        </Box>
        <Box width={SEV_W}>
          <Text color={sev.color}>{`${sev.glyph} ${sev.word}`}</Text>
        </Box>
        <Box width={titleW}>
          <Button
            key={`toggle:${f.id}`}
            plain
            hover={{ color: chipColor === FREE ? MUTED : chipColor, bold: true }}
            label={cut(f.ref ? `${f.ref}  ${f.title}` : f.title, titleW - 1)}
            onPress={() => a.on.toggle(f.id)}
          />
        </Box>
        <Box width={TOKENS_W} justifyContent="flex-end">
          <Text bold>{f.tokens > 0 ? fmt(f.tokens) : '—'}</Text>
        </Box>
        <Box width={PCT_W} justifyContent="flex-end">
          <Text dimColor>{f.tokens > 0 ? pct(f.tokens, max) : ''}</Text>
        </Box>
        <Box width={SAVES_W} justifyContent="flex-end">
          <Text color={SAVES}>{saves > 0 ? `−${fmt(saves)}` : ''}</Text>
        </Box>
      </Box>

      {open && (
        <Box flexDirection="column" marginLeft={CHEVRON_W} marginBottom={1}>
          {f.measured.map((m, i) => labelled(a, i === 0 ? 'measured' : '', <Text wrap="wrap">{m}</Text>))}
          {f.why && labelled(a, 'why', <Text wrap="wrap">{f.why}</Text>)}
          {stepsView(a, f, 'plan', f.plan)}
          {f.deep && labelled(a, 'deep-dive', <Text wrap="wrap" italic>{f.deep.note}</Text>)}
          {f.deep && stepsView(a, f, 'deep', f.deep.steps)}
          {actionsView(a, f)}
        </Box>
      )}
    </Box>
  )
}

function labelled(a: DoctorViewArgs, label: string, body: RenderElement) {
  const { Box, Text } = a.els
  return (
    <Box flexDirection="row">
      <Box width={LABEL_W} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {body}
      </Box>
    </Box>
  )
}

function stepsView(a: DoctorViewArgs, f: Finding, from: 'plan' | 'deep', steps: AiStep[] | undefined) {
  const { Box, Text, Button } = a.els
  if (from === 'plan' && (!steps || steps.length === 0)) {
    return labelled(a, 'AI plan', <Text dimColor>{'press "✦ ask AI" above for a plan'}</Text>)
  }
  if (!steps || steps.length === 0) return null
  return (
    <Box flexDirection="column">
      {steps.map((s, i) => (
        <Box flexDirection="row">
          <Box width={LABEL_W} flexShrink={0}>
            <Text dimColor>{i === 0 ? (from === 'plan' ? 'AI plan' : 'deep plan') : ''}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">
              <Text bold>{stepLabel(f, from, i)}</Text>
              {` ${s.text}`}
            </Text>
          </Box>
          <Box width={SAVES_W} justifyContent="flex-end" flexShrink={0}>
            <Text color={SAVES}>{s.saves ? `−${fmt(s.saves)}` : ''}</Text>
          </Box>
          <Box marginLeft={1} flexShrink={0}>
            <Button key={`draft:${from}:${f.id}:${i}`} plain dimColor label="draft" onPress={() => a.on.draft(f.id, i, from)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** `CD-3.2` once the audit is saved (the file's numbering), `2.` before that. Deep-dive steps follow the plan's. */
function stepLabel(f: Finding, from: 'plan' | 'deep', i: number): string {
  const n = (from === 'deep' ? (f.plan?.length ?? 0) : 0) + i + 1
  return f.ref ? `${f.ref}.${n}` : `${n}.`
}

/** When the last AI run happened (and how long ago), and when the findings were last scanned. */
function timesLine(a: DoctorViewArgs, r: DoctorReport) {
  const { Text } = a.els
  const last = [...r.runs].reverse().find(x => !x.error)
  return (
    <Text wrap="truncate">
      <Text dimColor>last AI run </Text>
      {last ? (
        <Text bold>{`${when(last.at, a.now)} (${ago(last.at, a.now)})`}</Text>
      ) : (
        <Text dimColor>none yet — press ✦ ask AI</Text>
      )}
      {last && <Text dimColor>{` · ${shortModel(last.model)} · ${money(last.cost)}`}</Text>}
      <Text dimColor>{` · scanned ${when(r.at, a.now)}`}</Text>
    </Text>
  )
}

/**
 * The context bar's categories as chips, each with its tokens and how many findings it holds. Under the pointer a
 * chip lights up in its category's colour, as in the bar; a press shows only that category's findings.
 */
function chipsView(a: DoctorViewArgs, findings: readonly Finding[]) {
  const { Box, Text, Button } = a.els
  const count = (name: string) => findings.filter(f => f.category === name).length
  // the categories using the most context first, then the ones with the most findings; free space last
  const rows = a.rows
    .filter(r => r.kind !== 'buffer' && (r.tokens > 0 || count(r.name) > 0))
    .slice()
    .sort((x, y) => Number(x.kind !== 'used') - Number(y.kind !== 'used') || (x.kind === 'used' ? y.tokens - x.tokens : 0) || count(y.name) - count(x.name))
  const max = a.report?.max ?? 1
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.map(row => {
        const count = findings.filter(f => f.category === row.name).length
        const on = a.filter === row.name
        const lit = row.kind === 'free' ? MUTED : row.display
        return (
          <Box key={`dchip:${row.name}`} flexDirection="row">
            <Text color={row.display}>{on ? '▣ ' : '■ '}</Text>
            <Box width={CHIP_W + 4} flexShrink={0}>
              <Button
                key={`dcat:${row.name}`}
                plain
                dimColor={count === 0}
                hover={{ color: lit, bold: true, dimColor: false }}
                label={cut(row.label, CHIP_W + 3)}
                onPress={() => a.on.filter(row.name)}
              />
            </Box>
            <Box width={TOKENS_W} justifyContent="flex-end" flexShrink={0}>
              <Text bold={row.kind === 'used'} dimColor={row.kind !== 'used'}>{fmt(row.tokens)}</Text>
            </Box>
            <Box width={PCT_W} justifyContent="flex-end" flexShrink={0}>
              <Text dimColor>{pct(row.tokens, max)}</Text>
            </Box>
            <Box marginLeft={3}>
              <Text bold={count > 0} dimColor={count === 0}>
                {count === 0 ? 'no findings' : `${count} finding${count === 1 ? '' : 's'}`}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function filterLine(a: DoctorViewArgs, findings: readonly Finding[]) {
  const { Box, Text, Button } = a.els
  const row = a.rows.find(r => r.name === a.filter)
  const shown = findings.filter(f => f.category === a.filter)
  return (
    <Box flexDirection="row" columnGap={1} marginBottom={1}>
      <Text>
        <Text color={row?.display ?? FREE}>■ </Text>
        <Text bold>{row?.label ?? a.filter ?? ''}</Text>
        <Text dimColor>{` · ${shown.length} finding${shown.length === 1 ? '' : 's'}${row ? ` · ${fmt(row.tokens)} · ${pct(row.tokens, a.report?.max ?? 1)} of the window` : ''}`}</Text>
      </Text>
      <Button key="dfilter-clear" plain dimColor label="✕ all categories" onPress={() => a.on.filter(a.filter ?? '')} />
    </Box>
  )
}

/** The last run's audit file, folded by default; open, it is drawn in full as Markdown. */
function fullAuditView(a: DoctorViewArgs, audit: { id: string; path: string; at: number }) {
  const { Box, Text, Button, Markdown, Link } = a.els
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box key="audit-row" flexDirection="row" columnGap={1}>
        <Text dimColor>{a.auditOpen ? '▾' : '▸'}</Text>
        <Button
          key="audit-toggle"
          plain
          hover={{ color: ACCENT, bold: true }}
          label={`full audit · ${audit.id} · ${when(audit.at, a.now)}`}
          onPress={() => a.on.toggleAudit()}
        />
      </Box>
      {a.auditOpen && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Box flexDirection="row" columnGap={1}>
            {Link ? <Link href={`file://${encodeURI(audit.path)}`} label={audit.path} /> : <Text>{audit.path}</Text>}
          </Box>
          <Box marginTop={1}>
            {a.auditText === null ? (
              <Text dimColor>reading the audit file…</Text>
            ) : Markdown ? (
              <Markdown text={a.auditText} />
            ) : (
              <Text wrap="wrap">{a.auditText}</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** The audit file: its path (a link), open and copy — or, before the first AI audit, where it will be saved. */
function auditLine(a: DoctorViewArgs, r: DoctorReport) {
  const { Box, Text, Button, Link } = a.els
  if (!r.audit) {
    return (
      <Box marginTop={1}>
        <Text wrap="wrap">
          <Text dimColor>full audit: </Text>
          <Text>none yet</Text>
          <Text dimColor>{` — ✦ ask AI saves it${a.auditFolder ? ` in ${a.auditFolder}/` : ''}`}</Text>
        </Text>
      </Box>
    )
  }
  const path = r.audit.path
  return (
    <Box key="audit-path" flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      <Text dimColor>full audit:</Text>
      {Link ? <Link href={`file://${encodeURI(path)}`} label={path} /> : <Text>{path}</Text>}
      <Button key="open-audit" plain hover={{ color: ACCENT, bold: true }} label="[open]" onPress={() => a.on.open(path)} />
      <Button key="copy-audit" plain dimColor label="[copy path]" onPress={p => a.on.copy(path, p.surface)} />
    </Box>
  )
}

function actionsView(a: DoctorViewArgs, f: Finding) {
  const { Box, Button } = a.els
  if (f.actions.length === 0) return null
  const deepCost = f.deepTokens ? estimateCost(a.model, f.deepTokens, EXPECTED_OUTPUT.deep) : null
  return labelled(
    a,
    'actions',
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {f.actions.map(act => {
        if (act.kind === 'prompt') {
          return <Button key={`act:${f.id}:draft`} label={act.label} onPress={() => a.on.draft(f.id, null, 'plan')} />
        }
        if (act.kind === 'deep') {
          const running = a.busy === `deep:${f.id}`
          return (
            <Button
              key={`act:${f.id}:deep`}
              label={running ? 'deep-diving…' : `${act.label} · ~${money(deepCost)}`}
              onPress={() => a.on.deep(f.id)}
            />
          )
        }
        const text = act.text
        return <Button key={`act:${f.id}:${act.label}`} label={act.label} onPress={p => a.on.copy(text, p.surface)} />
      })}
    </Box>,
  )
}
