import { atom, read, update } from 'claude-code'
import type {
  CommandInfo,
  ContextBreakdownDetail,
  ModelCompleteRequest,
  ModelCompleteResult,
  PromptComposeSection,
  Register,
  SessionContextBreakdown,
  SessionUsage,
  ToolInfo,
} from 'claude-code'

import type { AiRun, CompactTip, DoctorNotice, DoctorReport, Effort, Finding, Item, Seen, Snapshot } from '../types'
import { TOGGLE, estimate } from './categories'
import {
  DEFAULT_MODEL,
  USAGE,
  asReport,
  lastRunKey,
  buildAuditPrompt,
  buildDeepPrompt,
  draftFor,
  money,
  outline,
  parseArgs,
  parseAudit,
  parseDeep,
  scan,
  sortFindings,
  usageCost,
} from './doctor'
import type { FileOutline, ScanInput } from './doctor'
import { doctorView } from './doctorView'
import { auditDir, auditId, auditMarkdown, fillRefs, stepRef, withRefs } from './auditFile'
import { noticeLine } from './noticeView'
import { toLimits } from './limits'
import { compactLine } from './compactView'

import { offersHandoff, settingsFrom, statusText } from './compact'
import { VERSION } from './version'
import { asHandoffRun, asStoredHandoff, createCompactFlow, handoffKey, handoffRunKey } from './compactFlow'
import { errorText } from './errors'
import { buildSnapshot, byTokens, current } from './snapshot'
import { view } from './barView'

const snapshot = atom({ plugin: 'context-bar', key: 'snapshot' } as const, null)
const selected = atom({ plugin: 'context-bar', key: 'selected' } as const, null)
const isCounting = atom({ plugin: 'context-bar', key: 'isCounting' } as const, false)
const isBandHidden = atom({ plugin: 'context-bar', key: 'isBandHidden' } as const, false)
const lastError = atom({ plugin: 'context-bar', key: 'error' } as const, null)
const doctor = atom({ plugin: 'context-bar', key: 'doctor' } as const, null)
const doctorExpanded = atom({ plugin: 'context-bar', key: 'doctorExpanded' } as const, [])
const doctorModel = atom({ plugin: 'context-bar', key: 'doctorModel' } as const, DEFAULT_MODEL)
const doctorEffort = atom({ plugin: 'context-bar', key: 'doctorEffort' } as const, null)
const doctorBusy = atom({ plugin: 'context-bar', key: 'doctorBusy' } as const, null)
const doctorError = atom({ plugin: 'context-bar', key: 'doctorError' } as const, null)
const seen = atom({ plugin: 'context-bar', key: 'seen' } as const, { tools: {}, skills: {}, agents: {} })
const legendOpen = atom({ plugin: 'context-bar', key: 'legendOpen' } as const, false)
const openItem = atom({ plugin: 'context-bar', key: 'openItem' } as const, null)
const doctorNotice = atom({ plugin: 'context-bar', key: 'doctorNotice' } as const, null)
const doctorPeek = atom({ plugin: 'context-bar', key: 'doctorPeek' } as const, false)
const tick = atom({ plugin: 'context-bar', key: 'tick' } as const, 0)
const doctorFilter = atom({ plugin: 'context-bar', key: 'doctorFilter' } as const, null)
const auditOpen = atom({ plugin: 'context-bar', key: 'auditOpen' } as const, false)
const auditText = atom({ plugin: 'context-bar', key: 'auditText' } as const, null)
const compactTip = atom({ plugin: 'context-bar', key: 'compactTip' } as const, null)
const compactRunning = atom({ plugin: 'context-bar', key: 'compactRunning' } as const, null)
const compactResult = atom({ plugin: 'context-bar', key: 'compactResult' } as const, null)
const compactLink = atom({ plugin: 'context-bar', key: 'compactLink' } as const, null)
const compactTasks = atom({ plugin: 'context-bar', key: 'compactTasks' } as const, [])

const PANE = 'context-bar'
const TICK_MS = 1500
const FORCED_REFRESH_TICKS = 20 // 20 x 1.5 s = every 30 s even when nothing changed
const COMPOSE_EVERY_MS = 300_000
const FILE_SECTIONS_EVERY_MS = 60_000
const WORK_CHECK_TICKS = 8 // 8 x 1.5 s: look for a running push, merge or rebase every 12 s

/** A suggestion to compact is showing (not the after-/clear "Continue" one): the top-line button lights up. */
const isRecommended = (tip: CompactTip | null): boolean => !!tip && tip.reason !== 'resume'
/** A push or a long skill run just ended: "handoff & clear" lights up as well. */
const isHardEnd = (tip: CompactTip | null): boolean => !!tip && offersHandoff(tip)

// ---------------------------------------------------------------- the module

const DOCTOR = 'context-doctor'

/**
 * What the module needs from the engine. Built once, in `session.start`, as closures over that hook's `$`
 * (the engine requires `$` to be spelled `$.noun.event(...)` at each call site, never passed around).
 */
type Ops = {
  usage: (detail: ContextBreakdownDetail) => Promise<SessionUsage>
  tools: () => Promise<ToolInfo[]>
  compose: () => Promise<{ sections: readonly PromptComposeSection[] }>
  now: () => Promise<number>
  setSnapshot: (s: Snapshot) => Promise<unknown>
  setCounting: (v: boolean) => Promise<unknown>
  setError: (v: string | null) => Promise<unknown>
  commands: () => Promise<CommandInfo[]>
  // the doctor (readFile also feeds the bar's third level)
  readFile: (path: string) => Promise<string>
  complete: (request: ModelCompleteRequest) => Promise<ModelCompleteResult>
  fill: (text: string) => Promise<unknown>
  toast: (text: string) => void
  getSnapshot: () => Promise<Snapshot | null>
  getDoctor: () => Promise<DoctorReport | null>
  updateDoctor: (fn: (d: DoctorReport | null) => DoctorReport | null) => Promise<unknown>
  getSeen: () => Promise<Seen>
  getModel: () => Promise<string>
  getEffort: () => Promise<Effort | null>
  getBusy: () => Promise<string | null>
  setBusy: (v: string | null) => Promise<unknown>
  setDoctorError: (v: string | null) => Promise<unknown>
  expand: (id: string) => Promise<unknown>
  updateNotice: (fn: (n: DoctorNotice | null) => DoctorNotice | null) => Promise<unknown>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  setAuditText: (text: string | null) => Promise<unknown>
  // the saved audit
  writeFile: (path: string, text: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  cwd: () => Promise<string>
}

type Scanned = ScanInput & { findings: Finding[] }

function failure(r: Extract<ModelCompleteResult, { isAnswered: false }>): string {
  return r.reason === 'api-error' ? `API error${r.status ? ` ${r.status}` : ''}` : r.reason
}

/** What opening a file needs from the engine. */
type Opener = {
  process: { run: (argv: readonly string[]) => Promise<{ exitCode: number; stderr: string }> }
  ui: { toast: (text: string) => unknown }
}

/** Opens a file in the Mac's (or Linux desktop's) default app for it: an audit, a handoff. */
const openFile =
  ($: Opener) =>
  (path: string): void =>
    void $.process
      .run(['open', path])
      .catch(() => $.process.run(['xdg-open', path]))
      .then(r => {
        if (r.exitCode !== 0) $.ui.toast(`Could not open ${path}: ${r.stderr.trim() || `exit ${r.exitCode}`}`)
      })
      .catch(err => $.ui.toast(`Could not open ${path}: ${err instanceof Error ? err.message : String(err)}`))

export const register: Register = (on, options) => {
  let ops: Ops | null = null
  let dirty = true
  let ticks = 0
  let inFlight: Promise<void> | null = null
  let sections: readonly PromptComposeSection[] | null = null
  let sectionsAt = -Infinity
  let timer: { cancel: () => void } | null = null
  // what the bar's last refresh read, so the doctor works from exactly the same reading
  let lastBreakdown: SessionContextBreakdown | null = null
  let lastTools: ToolInfo[] = []
  let lastScan: Scanned | null = null
  let jobRunning = false
  /** Where this project's audits are saved: shown in the pane even before the first one exists. */
  let auditFolder: string | null = null
  // the third level: each memory file's sections (read at most once a minute) and the commands list
  const fileSections = new Map<string, { at: number; items: Item[] }>()
  let commands: CommandInfo[] = []
  let commandsAt = -Infinity

  async function sectionsOf(o: Ops, path: string, tokens: number, now: number, force: boolean): Promise<Item[]> {
    const cached = fileSections.get(path)
    if (cached && !force && now - cached.at < FILE_SECTIONS_EVERY_MS) return cached.items
    let items: Item[] = cached?.items ?? []
    try {
      const o2 = outline(path, '', tokens, await o.readFile(path))
      items = byTokens(o2.sections.map(x => ({ label: x.heading, tokens: x.tokens })))
    } catch {
      // unreadable: keep what was read before, if anything
    }
    fileSections.set(path, { at: now, items })
    return items
  }

  async function refresh(detail: ContextBreakdownDetail = 'summary'): Promise<void> {
    const o = ops
    if (!o) return
    if (inFlight) {
      if (detail === 'summary') {
        dirty = true
        return inFlight
      }
      await inFlight
    }
    const run = (async () => {
      dirty = false
      if (detail === 'full') await o.setCounting(true)
      try {
        const now = await o.now()
        if (sections === null || detail === 'full' || now - sectionsAt > COMPOSE_EVERY_MS) {
          try {
            sections = (await o.compose()).sections
            sectionsAt = now
          } catch {
            // keep the last composition; the system-prompt detail says when there is none
          }
        }
        if (detail === 'full' || now - commandsAt > COMPOSE_EVERY_MS) {
          commands = await o.commands().catch((): CommandInfo[] => commands)
          commandsAt = now
        }
        const [usage, tools] = await Promise.all([o.usage(detail), o.tools().catch((): ToolInfo[] => [])])
        const b = usage.context.breakdown
        if (b) {
          lastBreakdown = b
          lastTools = tools
          const bySection: { [path: string]: Item[] } = {}
          for (const f of b.memoryFiles) bySection[f.path] = await sectionsOf(o, f.path, f.tokens, now, detail === 'full')
          await o.setSnapshot(
            buildSnapshot(b, detail, tools, sections, now, {
              limits: toLimits(usage.rateLimits),
              cost: usage.cost?.usd ?? null,
              fileSections: bySection,
              commands,
            }),
          )
        }
        await o.setError(null)
      } catch (err) {
        await o.setError(errorText(err))
      } finally {
        if (detail === 'full') await o.setCounting(false)
      }
    })()
    inFlight = run
    try {
      await run
    } finally {
      inFlight = null
    }
  }

  const markDirty = () => {
    dirty = true
  }

  // ---------------------------------------------------------------- the doctor's three jobs

  /** Reads the context bar fresh and files findings under the bar's own categories. Free: no API call. */
  async function scanDoctor(): Promise<void> {
    const o = ops
    if (!o) return
    await o.setBusy('scan')
    await o.setDoctorError(null)
    try {
      await refresh()
      const snap = await o.getSnapshot()
      const b = lastBreakdown
      if (!snap || !b) throw new Error('the context bar has no reading yet')
      const outlines: FileOutline[] = []
      for (const f of b.memoryFiles) {
        let text = ''
        try {
          text = await o.readFile(f.path)
        } catch {
          // unreadable: outlined as empty, the finding still reports its size
        }
        outlines.push(outline(f.path, f.type, f.tokens, text))
      }
      const input: ScanInput = { rows: snap.rows, b, outlines, seen: await o.getSeen(), tools: lastTools }
      const findings = scan(input)
      lastScan = { ...input, findings }
      const cwd = await o.cwd()
      auditFolder = auditDir(cwd, await o.exists(`${cwd.replace(/\/+$/, '')}/.claude/knowledge`).catch(() => false))
      const audit = buildAuditPrompt(lastScan)
      const now = await o.now()
      await o.updateDoctor(prev => {
        const kept = findings.map(f => {
          const old = prev?.findings.find(x => x.id === f.id)
          return {
            ...f,
            ...(old?.ref ? { ref: old.ref } : {}),
            ...(old?.plan ? { plan: old.plan } : {}),
            ...(old?.deep ? { deep: old.deep } : {}),
          }
        })
        const extras = prev?.findings.filter(f => f.source === 'ai' && snap.rows.some(r => r.name === f.category)) ?? []
        const ordered = sortFindings([...kept, ...extras], snap.rows)
        return {
          at: now,
          total: b.totalTokens,
          max: b.rawMaxTokens,
          threshold: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
          findings: prev?.audit ? fillRefs(ordered) : withRefs(ordered),
          aiInputTokens: estimate(audit.system + audit.prompt),
          runs: prev?.runs ?? [],
          summary: prev?.summary ?? null,
          audit: prev?.audit ?? null,
        }
      })
    } catch (err) {
      await o.setDoctorError(`scan failed: ${errorText(err)}`)
    } finally {
      await o.setBusy(null)
    }
  }

  /** Writes the doctor's current report to its audit file (the one the last AI audit created). */
  async function saveAudit(): Promise<string | null> {
    const o = ops
    if (!o) return null
    const d = await o.getDoctor()
    if (!d?.audit) return null
    const rows = (await o.getSnapshot())?.rows ?? lastScan?.rows ?? []
    const md = auditMarkdown(d, rows, {
      id: d.audit.id,
      path: d.audit.path,
      at: d.audit.at,
      cwd: await o.cwd(),
      model: await o.getModel(),
      effort: await o.getEffort(),
    })
    await o.writeFile(d.audit.path, md)
    await o.setAuditText(md)
    // the last run survives the session: /context-doctor brings it back next time in this project
    await o.storeSet(lastRunKey(await o.cwd()), d).catch(() => undefined)
    return d.audit.path
  }

  /** Brings back this project's last AI run when this session has none yet. */
  async function restoreLastRun(o: Ops): Promise<void> {
    const cur = await o.getDoctor()
    if (cur && cur.runs.length > 0) return
    const saved = asReport(await o.storeGet(lastRunKey(await o.cwd())).catch(() => undefined))
    if (saved) await o.updateDoctor(() => saved)
  }

  /** Reads the last audit file into the pane (when the full-audit accordion opens). */
  async function loadAuditText(): Promise<void> {
    const o = ops
    if (!o) return
    const path = (await o.getDoctor())?.audit?.path
    if (!path) return
    try {
      await o.setAuditText(await o.readFile(path))
    } catch (err) {
      await o.setAuditText(`_The audit file could not be read: ${errorText(err)}_\n\n\`${path}\``)
    }
  }

  /** Starts a new audit file for this AI run: numbers the findings (CD-1, CD-2...) and picks the path. */
  async function startAudit(o: Ops): Promise<void> {
    const at = await o.now()
    const cwd = await o.cwd()
    const hasKnowledge = await o.exists(`${cwd.replace(/\/+$/, '')}/.claude/knowledge`).catch(() => false)
    const id = auditId(at)
    const path = `${auditDir(cwd, hasKnowledge)}/${id}.md`
    await o.updateDoctor(d => (d ? { ...d, findings: withRefs(d.findings), audit: { id, path, at } } : d))
  }

  type Outcome = { state: 'ready' | 'failed'; message: string | null }

  /** Announces a long job in the bar (spinner + elapsed time) until endJob says how it went. */
  async function startJob(o: Ops, kind: DoctorNotice['kind'], model: string): Promise<void> {
    jobRunning = true
    const now = await o.now()
    await o.updateNotice(() => ({ state: 'running', kind, model, startedAt: now, endedAt: null, message: null }))
  }

  async function endJob(o: Ops, outcome: Outcome): Promise<void> {
    jobRunning = false
    const now = await o.now()
    await o.updateNotice(n => (n ? { ...n, state: outcome.state, endedAt: now, message: outcome.message } : n))
  }

  /** One AI call over the scan: a plan per finding, plus anything the rules missed. */
  async function askAi(): Promise<void> {
    const o = ops
    if (!o) return
    if (await o.getBusy()) {
      o.toast('The context doctor is already working — one moment.')
      return
    }
    if (!lastScan) await scanDoctor()
    const scanned = lastScan
    if (!scanned) return
    const model = await o.getModel()
    const effort = await o.getEffort()
    const { system, prompt } = buildAuditPrompt(scanned)
    await o.setBusy('ai')
    await o.setDoctorError(null)
    await startJob(o, 'audit', model)
    let outcome: Outcome = { state: 'failed', message: 'stopped before finishing' }
    try {
      const r = await o.complete({ model, system, prompt, maxTokens: 16000, timeoutMs: 240_000, ...(effort ? { effort } : {}) })
      const now = await o.now()
      const run: AiRun = {
        kind: 'audit',
        model,
        inTokens: r.usage.input_tokens + r.usage.cache_creation_input_tokens + r.usage.cache_read_input_tokens,
        outTokens: r.usage.output_tokens,
        cost: usageCost(model, r.usage),
        at: now,
        summary: '',
      }
      const parsed = r.isAnswered ? parseAudit(r.text, scanned.rows) : null
      if (!r.isAnswered || !parsed) {
        const why = !r.isAnswered ? failure(r) : 'the reply was not the JSON asked for'
        await o.updateDoctor(d => (d ? { ...d, runs: [...d.runs, { ...run, error: why }].slice(-10) } : d))
        await o.setDoctorError(`AI call failed: ${why}`)
        outcome = { state: 'failed', message: `AI call failed: ${why}` }
        return
      }
      await o.updateDoctor(d => {
        if (!d) return d
        const ruled = d.findings
          .filter(f => f.source === 'rule')
          .map(f => {
            const plan = parsed.plans.get(f.id)
            return plan && plan.length ? { ...f, plan } : f
          })
        return {
          ...d,
          summary: parsed.summary || d.summary,
          findings: sortFindings([...ruled, ...parsed.extra], scanned.rows),
          runs: [...d.runs, { ...run, summary: parsed.summary }].slice(-10),
        }
      })
      await startAudit(o)
      outcome = { state: 'ready', message: null }
      try {
        const path = await saveAudit()
        o.toast(`Context audit saved · ${money(run.cost)} · ${path ?? ''}`)
      } catch (err) {
        await o.setDoctorError(`recommendations ready, but the audit file could not be saved: ${errorText(err)}`)
      }
    } catch (err) {
      await o.setDoctorError(`AI call failed: ${errorText(err)}`)
      outcome = { state: 'failed', message: `AI call failed: ${errorText(err)}` }
    } finally {
      await o.setBusy(null)
      await endJob(o, outcome)
    }
  }

  /** One more AI call over one memory file's full text: a section-by-section plan. */
  async function deepDive(id: string): Promise<void> {
    const o = ops
    if (!o) return
    if (await o.getBusy()) {
      o.toast('The context doctor is already working — one moment.')
      return
    }
    const f = (await o.getDoctor())?.findings.find(x => x.id === id)
    if (!f?.path) return
    const model = await o.getModel()
    const effort = await o.getEffort()
    await o.setBusy(`deep:${id}`)
    await o.setDoctorError(null)
    await startJob(o, 'deep', model)
    let outcome: Outcome = { state: 'failed', message: 'stopped before finishing' }
    try {
      const { system, prompt } = buildDeepPrompt(f, await o.readFile(f.path))
      const r = await o.complete({ model, system, prompt, maxTokens: 16000, timeoutMs: 300_000, ...(effort ? { effort } : {}) })
      const run: AiRun = {
        kind: 'deep',
        model,
        inTokens: r.usage.input_tokens + r.usage.cache_creation_input_tokens + r.usage.cache_read_input_tokens,
        outTokens: r.usage.output_tokens,
        cost: usageCost(model, r.usage),
        at: await o.now(),
        summary: '',
      }
      const parsed = r.isAnswered ? parseDeep(r.text) : null
      if (!r.isAnswered || !parsed) {
        const why = !r.isAnswered ? failure(r) : 'the reply was not the JSON asked for'
        await o.updateDoctor(d => (d ? { ...d, runs: [...d.runs, { ...run, error: why }].slice(-10) } : d))
        await o.setDoctorError(`deep-dive failed: ${why}`)
        outcome = { state: 'failed', message: `deep-dive failed: ${why}` }
        return
      }
      await o.updateDoctor(d =>
        d
          ? {
              ...d,
              findings: d.findings.map(x => (x.id === id ? { ...x, deep: parsed } : x)),
              runs: [...d.runs, { ...run, summary: parsed.note }].slice(-10),
            }
          : d,
      )
      await o.expand(id)
      outcome = { state: 'ready', message: null }
      try {
        const path = await saveAudit()
        o.toast(`Context doctor: deep-dive ready · ${money(run.cost)}${path ? ` · added to ${path}` : ''}`)
      } catch (err) {
        await o.setDoctorError(`deep-dive ready, but the audit file could not be updated: ${errorText(err)}`)
      }
    } catch (err) {
      await o.setDoctorError(`deep-dive failed: ${errorText(err)}`)
      outcome = { state: 'failed', message: `deep-dive failed: ${errorText(err)}` }
    } finally {
      await o.setBusy(null)
      await endJob(o, outcome)
    }
  }

  /** Puts a step's instruction in the input box. It never sends it: the person reads it and presses Enter. */
  async function draft(id: string, step: number | null, from: 'plan' | 'deep'): Promise<void> {
    const o = ops
    if (!o) return
    const f = (await o.getDoctor())?.findings.find(x => x.id === id)
    if (!f) return
    const steps = from === 'deep' ? f.deep?.steps : f.plan
    const index = step === null ? null : from === 'deep' ? (f.plan?.length ?? 0) + step : step
    const ref = f.ref && index !== null ? stepRef(f.ref, index) : undefined
    const auditPath = (await o.getDoctor())?.audit?.path
    const text = draftFor(f, step === null ? undefined : steps?.[step], ref, auditPath)
    await o.fill(text)
    o.toast('Placed in your input box — read it, then press Enter to send.')
  }

  // the person's settings (/config); nothing here is specific to a project
  const flow = createCompactFlow(settingsFrom(options))

  // ---------------------------------------------------------------- hooks

  on('session.start', async ($, e, next) => {
    ops = {
      usage: detail => $.session.usage({ breakdown: detail }),
      tools: () => $.tool.list(),
      commands: () => $.command.list(),
      compose: () => $.prompt.compose(),
      now: () => $.clock.now(),
      setSnapshot: s => update($, snapshot, () => s),
      setCounting: v => update($, isCounting, () => v),
      setError: v => update($, lastError, () => v),
      readFile: path => $.fs.read(path),
      complete: request => $.model.complete(request),
      fill: text => $.prompt.fill({ text, mode: 'insert' }),
      toast: text => $.ui.toast(text),
      getSnapshot: () => read($, snapshot),
      getDoctor: () => read($, doctor),
      updateDoctor: fn => update($, doctor, fn),
      getSeen: () => read($, seen),
      getModel: () => read($, doctorModel),
      getEffort: () => read($, doctorEffort),
      getBusy: () => read($, doctorBusy),
      setBusy: v => update($, doctorBusy, () => v),
      setDoctorError: v => update($, doctorError, () => v),
      expand: id => update($, doctorExpanded, list => (list.includes(id) ? list : [...list, id])),
      updateNotice: fn => update($, doctorNotice, fn),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
      setAuditText: text => update($, auditText, () => text),
      writeFile: (path, text) => $.fs.write(path, text),
      exists: path => $.fs.exists(path),
      cwd: () => $.session.cwd(),
    }
    flow.setOps({
      agents: () => $.agent.list(),
      later: (ms, fn) => void $.clock.after(ms, fn),
      run: async (argv, cwd) => {
        const r = await $.process.run(argv, cwd ? { cwd } : undefined)
        return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
      },
      exists: path => $.fs.exists(path),
      read: async path => {
        const v = await $.fs.read(path)
        return typeof v === 'string' ? v : ''
      },
      write: (path, text) => $.fs.write(path, text),
      home: () => $.env.get('HOME'),
      submit: text => $.prompt.submit({ text }),
      compact: instructions => $.session.compact({ instructions }),
      fill: text => $.prompt.fill({ text, mode: 'replace' }),
      toast: text => $.ui.toast(text),
      cwd: () => $.session.cwd(),
      now: () => $.clock.now(),
      snapshot: async () => current(await read($, snapshot)),
      getTip: () => read($, compactTip),
      setTip: t => update($, compactTip, () => t),
      setRunning: v => update($, compactRunning, () => v),
      setResult: v => update($, compactResult, () => v),
      setLink: v => update($, compactLink, () => v),
      getTasks: () => read($, compactTasks),
      setTasks: v => update($, compactTasks, () => v),
      clear: () => $.command.run({ command: 'clear' }),
      remove: path => $.process.run(['rm', '-f', '--', path]),
      list: dir => $.fs.list(dir),
      storeGet: key => $.store.get(key),
      storeSet: (key, value) => $.store.set(key, value),
    })
    dirty = true
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      ticks += 1
      if (ticks % FORCED_REFRESH_TICKS === 0) dirty = true
      if (dirty && !inFlight) void refresh()
      if (jobRunning) void update($, tick, n => n + 1)
      if (ticks % WORK_CHECK_TICKS === 0) void flow.checkWork().catch(() => {})
    })
    await $.command.register({
      name: 'context-bar',
      description:
        'Context bar: show it, `off` to hide, `pane` to open it as a pane, `recalculate` to count it exactly, `handoff` to hand off now, `status` for what it sees',
      argumentHint: '[off|pane|recalculate|handoff|status]',
      immediate: true,
    })
    await $.command.register({
      name: 'context-doctor',
      description: 'Audit the context window by the context bar categories, with AI recommendations you can act on',
      argumentHint: '[--model=opus|sonnet|haiku|fable|<id>] [--effort=low|medium|high|xhigh|max] [ask]',
      immediate: true,
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh()
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    markDirty()
    // a background task ended: the compaction flow stops counting it as running
    if (e.origin.kind === 'task-notification') await flow.onTaskNotification(e.text).catch(() => {})
    // the person moved on: a suggestion for the moment that just passed goes away
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') await flow.onPersonPrompt().catch(() => {})
    return r
  }).catch(($, e, next) => next(e)) // a failure here never blocks the prompt or the tool call

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    markDirty()
    // what this session actually uses, so the doctor can tell loaded from used
    // read through a narrow view: the event type is a union over every tool's input
    const call = e as unknown as {
      tool?: unknown
      skill?: unknown
      subagent_type?: unknown
      command?: unknown
      agentId?: unknown
      tool_use_id?: unknown
    }
    const tool = typeof call.tool === 'string' ? call.tool : null
    if (!tool) return r
    // a helper's own steps do not fill the main conversation, and its commits are not the person's finished step
    if (call.agentId === undefined) await flow.afterTool(tool, call, r).catch(() => {})
    const skill = tool === 'Skill' && typeof call.skill === 'string' ? call.skill : null
    const agent = tool === 'Agent' && typeof call.subagent_type === 'string' ? call.subagent_type : null
    await update($, seen, s => ({
      tools: { ...s.tools, [tool]: (s.tools[tool] ?? 0) + 1 },
      skills: skill ? { ...s.skills, [skill]: (s.skills[skill] ?? 0) + 1 } : s.skills,
      agents: agent ? { ...s.agents, [agent]: (s.agents[agent] ?? 0) + 1 } : s.agents,
    }))
    return r
  }).catch(($, e, next) => next(e)) // a failure here never blocks the prompt or the tool call

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: unknown }).agentId === undefined) flow.onTurnStart()
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) await flow.onTurnComplete(e.answer, e.isAborted, e.durationMs)
    markDirty()
    return r
  })

  // Every compaction, by a person, the threshold or the bar: keep what must survive, then put back where things stood
  // and save the summary as a handoff file. A failure here never blocks the compaction itself.
  on('session.compact', async ($, e, next) => {
    const { instructions, warning } = await flow.prepareCompact(e)
    if (warning) $.ui.toast(warning)
    const r = await next({ ...e, instructions })
    markDirty()
    return flow.completeCompact(e, r)
  }).catch(($, e, next) => next(e))

  // A new session in this project (after /clear, or a fresh `claude`): offer the latest handoff when it is recent.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source !== 'clear' && e.source !== 'startup') return r
    // a new conversation starts with an empty task list (Claude Code keeps one per session); so does the bar's copy
    await update($, compactTasks, () => [])
    const root = flow.repoMain() ?? (await $.session.cwd())
    const stored = asStoredHandoff(await $.store.get(handoffKey(root)))
    const now = await $.clock.now()
    if (stored && now - stored.at < flow.handoffMaxAgeMs() && (await $.fs.exists(stored.path))) {
      await update($, compactTip, () => ({ reason: 'resume' as const, at: stored.at, what: null, handoff: stored.path }))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    markDirty()
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'hide') {
      await update($, isBandHidden, () => true)
      return { text: 'Context bar hidden. /context-bar to show it again.' }
    }
    if (arg === 'recalculate' || arg === 'exact') {
      await refresh('full')
      return { text: 'Context recalculated with the token-count API (free).' }
    }
    if (arg === 'handoff') {
      await flow.startHandoff()
      return { text: 'Asking Claude for a handoff. Then /clear runs.' }
    }
    if (arg === 'status') {
      const root = flow.repoMain() ?? (await $.session.cwd())
      const s = flow.snapshotForStatus()
      return {
        text: statusText({
          ...s,
          tip: await read($, compactTip),
          lastHandoff: asStoredHandoff(await $.store.get(handoffKey(root))),
          lastRun: asHandoffRun(await $.store.get(handoffRunKey(root))),
          openTasks: await flow.openTaskCount(),
          now: await $.clock.now(),
          version: VERSION,
        }),
      }
    }
    await update($, isBandHidden, () => false)
    const surfaces = await $.session.surfaces()
    const needsPane = arg === 'pane' || surfaces.some(s => s === 'vscode' || s === 'mobile')
    if (needsPane) await $.ui.open({ id: PANE, title: 'Context' })
    void refresh()
    return { text: needsPane ? 'Context bar opened.' : 'Context bar shown above the prompt.' }
  })

  on('command.run', { command: 'context-doctor' }, async ($, e) => {
    const args = parseArgs(e.args)
    if (args.help) return { text: USAGE }
    if (args.error) return { text: `${args.error}. ${USAGE}` }
    // each run uses its own flags, or the defaults: nothing carries over from an earlier run
    const model = args.model ?? DEFAULT_MODEL
    await update($, doctorModel, () => model)
    await update($, doctorEffort, () => args.effort ?? null)
    // every accordion starts closed, the filter cleared, the full audit folded
    await update($, doctorExpanded, () => [])
    await update($, doctorFilter, () => null)
    await update($, auditOpen, () => false)
    await update($, auditText, () => null)
    if (ops) await restoreLastRun(ops)
    await $.ui.open({ id: DOCTOR, title: 'Context doctor', focus: true, closeOnEscape: true })
    await scanDoctor()
    if (args.ask) void askAi()
    return {
      text: `Context doctor · AI model ${model}${args.effort ? ` · effort ${args.effort}` : ''}${args.ask ? ' · asking now' : ' · press "ask AI" for recommendations'}`,
    }
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: unknown } | null
    if (data && data.type === TOGGLE.type) await update($, legendOpen, v => !v)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    return view({
      els: $.ui.resolve(e),
      snap: current(await read($, snapshot)),
      selectedName: await read($, selected),
      counting: await read($, isCounting),
      error: await read($, lastError),
      columns: Math.max(30, e.props.bodyColumns),
      maxRows: e.props.maxRows,
      onPick: name => void update($, selected, cur => (cur === name ? null : name)),
      onExact: () => void refresh('full'),
      onCompact: flow.buttons.compact,
      compactRecommended: isRecommended(await read($, compactTip)),
      onClear: flow.buttons.handoff,
      clearRecommended: isHardEnd(await read($, compactTip)),
      legendOpen: await read($, legendOpen),
      onToggleLegend: () => void update($, legendOpen, v => !v),
      openItem: await read($, openItem),
      onOpenItem: key => void update($, openItem, cur => (cur === key ? null : key)),
      notice: noticeLine({
        els: $.ui.resolve(e),
        notice: await read($, doctorNotice),
        peek: await read($, doctorPeek),
        report: await read($, doctor),
        now: await $.clock.now(),
        tick: await read($, tick),
        columns: Math.max(30, e.props.bodyColumns) - 4,
        on: {
          toggle: () => void update($, doctorPeek, v => !v),
          dismiss: () => {
            void update($, doctorNotice, () => null)
            void update($, doctorPeek, () => false)
          },
          draft: (findingId, index, from) => void draft(findingId, index, from),
          copy: (text, surface) =>
            void $.ui.copy({ text, surface }).then(r => {
              $.ui.toast(r.isCopied ? `Copied: ${text}` : `Could not copy (${r.reason}) — ${text}`)
            }),
          openDoctor: () => void $.ui.open({ id: DOCTOR, title: 'Context doctor', focus: true, closeOnEscape: true }),
        },
      }),
      compact: compactLine({
        els: $.ui.resolve(e),
        tip: await read($, compactTip),
        running: await read($, compactRunning),
        result: await read($, compactResult),
        link: await read($, compactLink),
        isWorking: flow.isTurnRunning() || ('isWorking' in e.props && e.props.isWorking === true),
        now: await $.clock.now(),
        on: { ...flow.buttons, open: openFile($) },
      }),
    })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return view({
      els: $.ui.resolve(e),
      snap: current(await read($, snapshot)),
      selectedName: await read($, selected),
      counting: await read($, isCounting),
      error: await read($, lastError),
      columns: Math.max(30, e.props.bodyColumns),
      maxRows: Math.max(20, e.viewport?.rows ?? 30),
      onPick: name => void update($, selected, cur => (cur === name ? null : name)),
      onExact: () => void refresh('full'),
      onCompact: flow.buttons.compact,
      compactRecommended: isRecommended(await read($, compactTip)),
      onClear: flow.buttons.handoff,
      clearRecommended: isHardEnd(await read($, compactTip)),
      legendOpen: await read($, legendOpen),
      onToggleLegend: () => void update($, legendOpen, v => !v),
      openItem: await read($, openItem),
      onOpenItem: key => void update($, openItem, cur => (cur === key ? null : key)),
      notice: noticeLine({
        els: $.ui.resolve(e),
        notice: await read($, doctorNotice),
        peek: await read($, doctorPeek),
        report: await read($, doctor),
        now: await $.clock.now(),
        tick: await read($, tick),
        columns: Math.max(30, e.props.bodyColumns) - 4,
        on: {
          toggle: () => void update($, doctorPeek, v => !v),
          dismiss: () => {
            void update($, doctorNotice, () => null)
            void update($, doctorPeek, () => false)
          },
          draft: (findingId, index, from) => void draft(findingId, index, from),
          copy: (text, surface) =>
            void $.ui.copy({ text, surface }).then(r => {
              $.ui.toast(r.isCopied ? `Copied: ${text}` : `Could not copy (${r.reason}) — ${text}`)
            }),
          openDoctor: () => void $.ui.open({ id: DOCTOR, title: 'Context doctor', focus: true, closeOnEscape: true }),
        },
      }),
      compact: compactLine({
        els: $.ui.resolve(e),
        tip: await read($, compactTip),
        running: await read($, compactRunning),
        result: await read($, compactResult),
        link: await read($, compactLink),
        isWorking: flow.isTurnRunning() || ('isWorking' in e.props && e.props.isWorking === true),
        now: await $.clock.now(),
        on: { ...flow.buttons, open: openFile($) },
      }),
    })
  })

  on('ui.render', { component: 'Pane', requestId: DOCTOR }, async ($, e) => {
    const snap = current(await read($, snapshot))
    return doctorView({
      els: $.ui.resolve(e),
      report: await read($, doctor),
      rows: snap?.rows ?? [],
      expanded: await read($, doctorExpanded),
      busy: await read($, doctorBusy),
      error: await read($, doctorError),
      model: await read($, doctorModel),
      effort: await read($, doctorEffort),
      columns: Math.max(40, e.props.bodyColumns),
      now: await $.clock.now(),
      filter: await read($, doctorFilter),
      auditFolder,
      auditOpen: await read($, auditOpen),
      auditText: await read($, auditText),
      on: {
        filter: name => void update($, doctorFilter, cur => (cur === name || name === '' ? null : name)),
        open: openFile($),
        toggleAudit: () =>
          void update($, auditOpen, v => !v).then(open => {
            if (open) void loadAuditText()
          }),
        toggle: id =>
          void update($, doctorExpanded, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])),
        rescan: () => void scanDoctor(),
        ask: () => void askAi(),
        deep: id => void deepDive(id),
        draft: (id, step, from) => void draft(id, step, from),
        copy: (text, surface) =>
          void $.ui.copy({ text, surface }).then(r => {
            $.ui.toast(r.isCopied ? `Copied: ${text}` : `Could not copy (${r.reason}) — ${text}`)
          }),
        close: () => void $.ui.close({ id: DOCTOR }),
      },
    })
  })
}
