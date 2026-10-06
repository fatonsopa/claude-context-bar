// The context doctor's job, announced in the bar: a spinner while the AI works, then "audit ready". A press opens
// a panel with the summary, the top 5 actions (each with its CD reference and a draft button) and the audit file.

import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  LinkProps,
  RenderElement,
  RenderSurface,
  TextProps,
} from 'claude-code'

import type { DoctorNotice, DoctorReport } from '../types'
import { topActions } from './auditFile'
import { ACCENT, fmt, money } from './categories'
import { shortModel } from './doctor'

type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link?: ElementConstructor<LinkProps>
}

export type NoticeArgs = {
  els: Els
  notice: DoctorNotice | null
  peek: boolean
  report: DoctorReport | null
  now: number
  tick: number
  columns: number
  on: {
    toggle: () => void
    dismiss: () => void
    draft: (findingId: string, index: number, from: 'plan' | 'deep') => void
    copy: (text: string, surface: RenderSurface) => void
    openDoctor: () => void
  }
}

const SPINNER = ['◐', '◓', '◑', '◒'] as const
const SAVES = '#8FD18B'
const TOP = 5

function seconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function cut(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

/** The button text for the job's state. */
export function noticeLabel(n: DoctorNotice, now: number, tick: number, report: DoctorReport | null): string {
  const what = n.kind === 'audit' ? 'audit' : 'deep-dive'
  if (n.state === 'running') {
    const spin = SPINNER[tick % SPINNER.length] ?? '◐'
    return `${spin} context doctor · ${n.kind === 'audit' ? 'auditing' : 'deep-diving'} with ${shortModel(n.model)} · ${seconds(now - n.startedAt)}`
  }
  if (n.state === 'failed') return `✗ context doctor ${what} failed`
  const run = report?.runs.at(-1)
  const id = report?.audit?.id
  return `✓ context ${what} ready${id ? ` · ${id}` : ''}${run ? ` · ${money(run.cost)}` : ''}`
}

export function noticeLine(a: NoticeArgs): RenderElement | null {
  const n = a.notice
  if (!n) return null
  const { Box, Button } = a.els
  const label = cut(noticeLabel(n, a.now, a.tick, a.report), Math.max(20, a.columns - 6))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Button key="doctor-notice" variant="primary" label={label} onPress={() => a.on.toggle()} />
        {n.state !== 'running' && <Button key="doctor-notice-dismiss" plain dimColor label="✕" onPress={() => a.on.dismiss()} />}
      </Box>
      {a.peek && peekView(a, n)}
    </Box>
  )
}

function peekView(a: NoticeArgs, n: DoctorNotice) {
  const { Box, Text, Button, Link } = a.els
  if (n.state === 'running') {
    return (
      <Box marginLeft={2}>
        <Text dimColor wrap="wrap">
          {`Started ${seconds(a.now - n.startedAt)} ago. The summary, the top ${TOP} actions and the audit file appear here when it's done.`}
        </Text>
      </Box>
    )
  }
  if (n.state === 'failed') {
    return (
      <Box marginLeft={2}>
        <Text color="#E8775A" wrap="wrap">
          {n.message ?? 'The AI call failed.'}
        </Text>
      </Box>
    )
  }
  const r = a.report
  const top = r ? topActions(r.findings, TOP) : []
  const path = r?.audit?.path ?? null
  const inner = Math.max(30, a.columns - 2)

  return (
    <Box flexDirection="column" marginLeft={2} width={inner}>
      {r?.summary && <Text italic wrap="wrap">{r.summary}</Text>}
      <Box marginTop={r?.summary ? 1 : 0}>
        <Text bold>{top.length ? `Top ${top.length} actions` : 'No recommended actions in this audit.'}</Text>
      </Box>
      {top.map(t => (
        <Box flexDirection="row" width={inner}>
          <Box width={9} flexShrink={0}>
            <Text bold color={ACCENT}>{t.ref ?? '•'}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">{t.step.text}</Text>
          </Box>
          <Box width={8} justifyContent="flex-end" flexShrink={0}>
            <Text color={SAVES}>{t.step.saves ? `−${fmt(t.step.saves)}` : ''}</Text>
          </Box>
          <Box marginLeft={1} flexShrink={0}>
            <Button
              key={`notice-draft:${t.from}:${t.findingId}:${t.index}`}
              plain
              dimColor
              label="draft"
              onPress={() => a.on.draft(t.findingId, t.index, t.from)}
            />
          </Box>
        </Box>
      ))}
      {path && (
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          <Text dimColor>full audit:</Text>
          {Link ? <Link href={`file://${encodeURI(path)}`} label={path} /> : <Text>{path}</Text>}
          <Button key="notice-copy" plain dimColor label="[copy path]" onPress={p => a.on.copy(path, p.surface)} />
          <Button key="notice-open" plain dimColor label="[open doctor]" onPress={() => a.on.openDoctor()} />
        </Box>
      )}
    </Box>
  )
}
