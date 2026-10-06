// The compaction flow: notices finished work (a commit, a push, a long skill run), decides when to suggest compacting,
// adds the keep list and the git state to every compaction, and runs "handoff & clear" / "handoff & compact". It holds this
// session's flow state; ./register.tsx builds its engine access (CompactOps) in session.start and wires the hooks.

import type { AgentInfo, SessionCompactResult, SessionCompactTrigger } from 'claude-code'

import type { CompactTip, Snapshot, TrackedTask } from '../types'
import { estimate } from './categories'
import {
  IDLE,
  when,
  handoffFailedText,
  handoffDoneText,
  handoffLine,
  compactingText,
  clearDoneText,
  isDraftName,
  draftHandoffPath,
  RUNNING_TEXT,
  QUIET_LARGE_OUTPUT_MS,
  RESUME_TOAST,
  busyReason,
  backgroundTaskOf,
  busyWarning,
  changedFiles,
  committed,
  doneText,
  endedTask,
  extractHandoff,
  handoffFile,
  handoffCommitMessage,
  handoffDir,
  datedHandoffPath,
  fallbackHandoffName,
  handoffMarkdown,
  handoffName,
  namedHandoffPath,
  handoffPath,
  handoffRequest,
  hasKeepList,
  headOf,
  isLargeOutput,
  isTestRun,
  largeOutputText,
  pushed,
  pushedTo,
  TASK_TOOLS,
  nextTasks,
  openTasks,
  missingTasks,
  pushTarget,
  hostName,
  missingSections,
  projectSlug,
  resumePrompt,
  shouldSuggest,
  stateInstruction,
  stateMessage,
  summaryText,
  testsFailed,
  withKeepList,
} from './compact'
import type { BarSettings, Busy, MachineState } from './compact'
import { errorText } from './errors'

/** What compacting needs from the engine, built in `session.start` like `Ops`. */
export type CompactOps = {
  agents: () => Promise<AgentInfo[]>
  /** Runs `fn` as its own dispatch after `ms`: how a prompt is submitted from a command, which may not submit itself. */
  later: (ms: number, fn: () => void) => void
  run: (argv: string[], cwd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<unknown>
  home: () => Promise<string | undefined>
  submit: (text: string) => Promise<unknown>
  compact: (instructions: string) => Promise<SessionCompactResult>
  fill: (text: string) => Promise<unknown>
  toast: (text: string) => void
  cwd: () => Promise<string>
  now: () => Promise<number>
  snapshot: () => Promise<Snapshot | null>
  getTip: () => Promise<CompactTip | null>
  setTip: (t: CompactTip | null) => Promise<unknown>
  /** What the bar shows while it works (a handoff being written, a compaction), or null. */
  setRunning: (v: string | null) => Promise<unknown>
  /** The last result the bar reports (a handoff, a compaction, a clear), shown until the person's next message. */
  setResult: (v: string | null) => Promise<unknown>
  /** The handoff file the bar's line names, drawn there as a link to the file. */
  setLink: (path: string | null) => Promise<unknown>
  /** This session's task list as the bar saw it made and changed; kept across reloads of the mod. */
  getTasks: () => Promise<TrackedTask[]>
  setTasks: (tasks: TrackedTask[]) => Promise<unknown>
  /** Runs /clear, as the person typing it would. */
  clear: () => Promise<unknown>
  /** Removes one file the flow itself made (its handoff draft). */
  remove: (path: string) => Promise<unknown>
  list: (dir: string) => Promise<readonly { name: string }[]>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
}

/** What a tool call brought back, as text: what the model read when the engine says, else the tool's own output. */
function outputOf(r: unknown): string {
  const x = r as { text?: unknown; result?: unknown } | null
  if (!x) return ''
  if (typeof x.text === 'string') return x.text
  const res = x.result as { stdout?: unknown; stderr?: unknown } | string | null | undefined
  if (typeof res === 'string') return res
  if (res && typeof res === 'object') {
    if (typeof res.stdout === 'string') return `${res.stdout}\n${typeof res.stderr === 'string' ? res.stderr : ''}`
    try {
      return JSON.stringify(res)
    } catch {
      return ''
    }
  }
  return ''
}

/** The first non-empty line of a command's output: the reason a person needs. */
function firstLine(text: string): string {
  return text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
}

/** The last handoff for one project, kept in the plugin's store so a new session can find it. */
type StoredHandoff = { path: string; at: number }
export const handoffKey = (root: string) => `handoff:${projectSlug(root)}`
/** The last handoff run for one project and how it ended, for `/context-bar status`. */
export const handoffRunKey = (root: string) => `handoff-run:${projectSlug(root)}`
export function asHandoffRun(v: unknown): { path: string | null; at: number; outcome: string } | null {
  const x = v as { path?: unknown; at?: unknown; outcome?: unknown } | null
  return x && typeof x.at === 'number' && typeof x.outcome === 'string' && (typeof x.path === 'string' || x.path === null)
    ? { path: x.path, at: x.at, outcome: x.outcome }
    : null
}
export function asStoredHandoff(v: unknown): StoredHandoff | null {
  const x = v as { path?: unknown; at?: unknown } | null
  return x && typeof x.path === 'string' && typeof x.at === 'number' ? { path: x.path, at: x.at } : null
}

/**
 * The flow for one session. Its state lives here; the engine is reached only through the CompactOps it is given.
 * Nothing in it is specific to a project: every signal is one Claude Code or git gives in any repository.
 */
export function createCompactFlow(settings: BarSettings) {
  let compactOps: CompactOps | null = null
  /** The repository's folders, read once: its root, and git's own folder (where a merge or rebase leaves its files). */
  let repo: { root: string; gitDir: string; main: string } | null | undefined
  let busy: Busy = IDLE
  let turnRunning = false
  /** The skills the running turn has used: a long turn that used one is a finished piece of work. */
  let turnSkills: string[] = []
  let lastCompactAt: number | null = null
  let lastLargeTipAt = -Infinity
  /** Background commands this session started and has not heard the end of: task id → the call that started it. */
  const shells = new Map<string, string | null>()
  /** A moment that came while something was still running: offered as soon as nothing is. */
  let deferred: { reason: 'saved' | 'pushed' | 'finished'; what: string | null; to: string | null } | null = null

  async function repoOf(t: CompactOps): Promise<{ root: string; gitDir: string; main: string } | null> {
    if (repo !== undefined) return repo
    try {
      const r = await t.run(
        ['git', 'rev-parse', '--show-toplevel', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'],
        await t.cwd(),
      )
      const [root, gitDir, common] = r.stdout.split('\n').map(x => x.trim())
      repo = r.exitCode === 0 && root && gitDir && common ? { root, gitDir, main: common.replace(/\/\.git\/?$/, '') } : null
    } catch {
      repo = null
    }
    return repo
  }

  /** Subagents of this session that have not finished, as the engine lists them. */
  async function countSubagents(t: CompactOps): Promise<number> {
    try {
      return (await t.agents()).filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting').length
    } catch {
      return busy.subagents
    }
  }

  /** Every 12 s: are subagents still running, is a merge or rebase under way; then offer a moment that was waiting. */
  async function checkWork(): Promise<void> {
    const t = compactOps
    if (!t) return
    const r = await repoOf(t)
    const [subagents, merging] = await Promise.all([
      countSubagents(t),
      r
        ? Promise.all(['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].map(f => t.exists(`${r.gitDir}/${f}`))).then(x => x.some(Boolean))
        : Promise.resolve(false),
    ])
    busy = { ...busy, subagents, merging }
    await offerDeferred()
  }

  /** A moment that waited for running work: offered once nothing runs any more. */
  async function offerDeferred(): Promise<void> {
    if (!deferred || busyReason(busy)) return
    const d = deferred
    deferred = null
    await suggest(d.reason, d.what, d.to)
  }

  /** A background task's notification arrived: if it is one of this session's commands and it ended, it no longer counts. */
  async function onTaskNotification(text: string): Promise<void> {
    const ended = endedTask(text)
    if (!ended.status || ended.status === 'running') return
    for (const [id, toolUseId] of shells) {
      if (id === ended.id || (toolUseId !== null && toolUseId === ended.toolUseId)) shells.delete(id)
    }
    busy = { ...busy, shells: shells.size }
    await offerDeferred()
  }

  async function suggest(reason: 'saved' | 'pushed' | 'finished', what: string | null, to: string | null = null): Promise<void> {
    const t = compactOps
    if (!t) return
    busy = { ...busy, subagents: await countSubagents(t) }
    if (busyReason(busy)) {
      deferred = { reason, what, to }
      return
    }
    const now = await t.now()
    const minConversation = settings.suggestCompactAtTokens
    if (!shouldSuggest({ snap: await t.snapshot(), busy, lastCompactAt, now, minConversation })) return
    await t.setTip({ reason, at: now, what, handoff: null, ...(to ? { to } : {}) })
  }

  /**
   * Where a push went when its output does not say (`git push -q`, `git push 2>&1 | tail -1`): asked of git itself, in
   * the folder the command ran in, for the remote it named, else the branch's push remote, else `origin`.
   */
  async function pushHost(t: CompactOps, command: string): Promise<string | null> {
    const target = pushTarget(command)
    if (target.remote && hostName(target.remote)) return hostName(target.remote)
    const cwd = await t.cwd()
    const home = (await t.home()) ?? ''
    const dir = !target.dir
      ? cwd
      : target.dir.startsWith('~')
        ? `${home}${target.dir.slice(1)}`
        : target.dir.startsWith('/')
          ? target.dir
          : `${cwd}/${target.dir}`
    const git = async (args: string[]): Promise<string> => {
      try {
        const x = await t.run(['git', ...args], dir)
        return x.exitCode === 0 ? x.stdout.trim() : ''
      } catch {
        return ''
      }
    }
    const remote = target.remote ?? ((await git(['rev-parse', '--abbrev-ref', '@{push}'])).split('/')[0] || 'origin')
    const url = await git(['remote', 'get-url', '--push', remote])
    return url ? hostName(url) : null
  }

  /** After each main-conversation tool call: a skill used, a test run, a commit, a push, a very long answer. */
  async function afterTool(
    tool: string,
    call: { command?: unknown; skill?: unknown; tool_use_id?: unknown },
    r: unknown,
  ): Promise<void> {
    const t = compactOps
    if (!t) return
    // the task list, exactly: every task made or changed, so a handoff can carry the open ones
    if (TASK_TOOLS.includes(tool)) await t.setTasks(nextTasks(await t.getTasks(), tool, call, (r as { result?: unknown } | null)?.result))
    const out = outputOf(r)
    const background = backgroundTaskOf(r)
    if (background) {
      shells.set(background, typeof call.tool_use_id === 'string' ? call.tool_use_id : null)
      busy = { ...busy, shells: shells.size }
    }
    if (tool === 'Skill' && typeof call.skill === 'string') turnSkills.push(call.skill)
    if (tool === 'Bash' && typeof call.command === 'string') {
      const isError = (r as { isError?: unknown } | null)?.isError === true
      if (isTestRun(call.command)) busy = { ...busy, testsFailing: testsFailed(isError, out) }
      const c = isError ? null : committed(call.command, out)
      if (c) await suggest('saved', c.subject)
      const p = isError ? null : pushed(call.command, out)
      if (p) await suggest('pushed', p, pushedTo(out) ?? (await pushHost(t, call.command)))
    }
    const tokens = estimate(out)
    if (isLargeOutput(tool, tokens, settings.longOutputTokens)) {
      const now = await t.now()
      if (now - lastLargeTipAt >= QUIET_LARGE_OUTPUT_MS) {
        lastLargeTipAt = now
        t.toast(largeOutputText(tokens, await t.snapshot()))
      }
    }
  }

  /** Read from the machine, never from the conversation. */
  async function machineState(t: CompactOps): Promise<MachineState> {
    const r = await repoOf(t)
    if (!r) return { folder: await t.cwd(), branch: null, head: null, changed: [], busy }
    const git = async (args: string[]): Promise<string> => {
      try {
        const x = await t.run(['git', ...args], r.root)
        return x.exitCode === 0 ? x.stdout : ''
      } catch {
        return ''
      }
    }
    const [branch, head, status] = await Promise.all([
      git(['branch', '--show-current']),
      git(['log', '-1', '--format=%h%x09%s']),
      git(['status', '--porcelain']),
    ])
    return { folder: r.root, branch: branch.trim() || null, head: headOf(head), changed: changedFiles(status), busy }
  }

  /** Where this project's handoffs go: ~/.claude/handoffs/<project>/, outside the repository. */
  async function handoffPlace(t: CompactOps): Promise<{ home: string; root: string } | null> {
    const home = await t.home()
    if (!home) return null
    return { home, root: (await repoOf(t))?.main ?? (await t.cwd()) }
  }

  /** Saves a handoff file and remembers it as this project's latest, for "Continue" after /clear. */
  async function saveHandoff(t: CompactOps, root: string, path: string, at: number, text: string): Promise<void> {
    await t.run(['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))], root)
    await t.write(path, text)
    await t.storeSet(handoffKey(root), { path, at })
  }

  /** The handoff a compaction leaves: its summary and the state. Never stops the compaction. */
  async function writeCompactHandoff(t: CompactOps, state: MachineState, summary: string): Promise<string | null> {
    try {
      const place = await handoffPlace(t)
      if (!place) return null
      const now = await t.now()
      const path = handoffPath(place.home, place.root, now, 'compact')
      const previous = asStoredHandoff(await t.storeGet(handoffKey(place.root)))
      const tasks = openTasks(await t.getTasks())
      const text = handoffMarkdown({ project: projectSlug(place.root), at: now, state, summary, previous: previous?.path ?? null, tasks })
      await saveHandoff(t, place.root, path, now, text)
      return path
    } catch {
      return null
    }
  }

  /**
   * After any compaction that stands: no suggestion for a while, the handoff saved, and a short "compacted" naming the
   * handoff: the one "handoff & compact" saved (`saved`), else the one this compaction wrote.
   */
  async function finishCompact(
    t: CompactOps,
    r: Extract<SessionCompactResult, { skip?: undefined }>,
    state: MachineState,
    auto: boolean,
    saved?: string,
  ): Promise<string | null> {
    lastCompactAt = await t.now()
    await t.setTip(null)
    const handoff = await writeCompactHandoff(t, state, summaryText(r.messages))
    const shown = saved ?? handoff
    const snap = await t.snapshot()
    const text = doneText({ before: r.tokensBefore, after: r.tokensAfter, max: snap?.max ?? 1, at: await t.now(), auto, handoff: shown })
    if (shown) await t.setLink(shown)
    await t.setResult(text)
    t.toast(text)
    return handoff
  }

  /**
   * The compaction step of "handoff & compact", focused on what just finished. The engine does not run this plugin's own
   * session.compact hook on this call, so the keep list, the state and the after-work are done here.
   */
  async function compactNow(handoff?: { path: string; line: string }, finished?: string | null): Promise<void> {
    const t = compactOps
    if (!t) return
    if (turnRunning) {
      t.toast('Wait until Claude finishes the current step, then compact.')
      return
    }
    const tip = await t.getTip()
    await t.setRunning(compactingText(handoff?.line))
    try {
      const state = await machineState(t)
      const focus =
        [
          (finished ?? tip?.what) ? `We just finished: ${finished ?? tip?.what}.` : null,
          handoff ? `A handoff for this work was just saved to ${handoff.path}.` : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      const r = await t.compact(`${withKeepList(focus)}\n\n${stateInstruction(state)}`)
      if (r.skip !== undefined) {
        const text = `Compact failed on ${when(await t.now())}: ${r.skip}.`
        await t.setResult(text)
        t.toast(text)
      }
      else await finishCompact(t, r, state, false, handoff?.path)
    } catch (err) {
      const text = `Compact failed on ${when(await t.now())}: ${errorText(err)}.`
      await t.setResult(text)
      t.toast(text)
    } finally {
      await t.setRunning(null)
      await t.setTip(null)
    }
  }

  /** A handoff Claude is writing: its draft file, where it will be saved, the repository, and the git state then. */
  let pendingHandoff: {
    /** The file Claude writes the handoff to; the bar names, saves and removes it once the turn ends. */
    draft: string
    dir: string
    root: string
    repoRoot: string | null
    at: number
    state: MachineState
    fallbackName: string
    /** The open tasks when it was asked for: each must be in the handoff, and they are saved with it for resume. */
    tasks: TrackedTask[]
    /** What follows a saved handoff, as the button says: a compaction, or /clear. */
    then: 'clear' | 'compact'
    /** What had just finished when it was asked for (the suggestion's subject), for the compaction's focus. */
    finished: string | null
  } | null = null

  /**
   * "handoff & compact" / "handoff & clear", step 1: ask Claude, in one prompt, to write the handoff to a draft file
   * (one collapsed Write in the transcript, a one-line reply). Step 2 runs when that turn ends (`finishHandoff`).
   */
  async function startHandoff(then: 'clear' | 'compact' = 'clear'): Promise<void> {
    const t = compactOps
    if (!t) return
    if (turnRunning) {
      t.toast('Wait until Claude finishes the current step, then hand off.')
      return
    }
    const r = await repoOf(t)
    const place = await handoffPlace(t)
    if (!r && !place) {
      t.toast('No repository and no home folder found, so the handoff cannot be saved. Nothing was compacted or cleared.')
      return
    }
    const at = await t.now()
    const state = await machineState(t)
    const finished = (await t.getTip())?.what ?? null
    // in a repository: <root>/<handoff folder>/, committed by path; outside one: ~/.claude/handoffs/<project>/.
    // The file name comes from the handoff itself (its title), so it is chosen when the turn ends.
    const dir = r ? `${r.root}/${settings.handoffFolder}` : handoffDir(place?.home ?? '', place?.root ?? '')
    const root = place?.root ?? r?.main ?? state.folder
    await removeDrafts(t, dir)
    const draft = draftHandoffPath(dir, at)
    await t.run(['mkdir', '-p', dir], r?.root ?? root).catch(() => undefined)
    const tasks = openTasks(await t.getTasks())
    pendingHandoff = { draft, dir, root, repoRoot: r?.root ?? null, at, state, fallbackName: fallbackHandoffName(state.branch), tasks, then, finished }
    await t.setTip(null)
    await t.setRunning(RUNNING_TEXT.handoff)
    // Submitted from a dispatch of its own: the engine refuses a submit from inside a command hook ("it would wait on
    // the turn this hook is holding"). Queued, not awaited: it runs as a turn of its own once the session is idle.
    const request = handoffRequest({ project: projectSlug(r?.main ?? place?.root ?? state.folder), at, state, draft, tasks })
    t.later(0, () => {
      void t.submit(request).catch(async (err: unknown) => {
        pendingHandoff = null
        await t.setRunning(null)
        t.toast(`Could not ask for the handoff: ${errorText(err)}. Nothing was compacted or cleared.`)
      })
    })
  }

  /** Drafts an earlier run left behind (a reload mid-handoff): never left in the folder, since a push wants a clean tree. */
  async function removeDrafts(t: CompactOps, dir: string): Promise<void> {
    try {
      for (const entry of await t.list(dir)) if (isDraftName(entry.name)) await t.remove(`${dir}/${entry.name}`)
    } catch {
      // no folder yet: nothing left behind
    }
  }

  /**
   * Step 2: the turn that wrote the handoff ended. Name it, save it, commit it, then do what the button says. A failed
   * commit is a warning, never a stop: the handoff is already saved on disk. Only a missing or incomplete handoff stops
   * the compaction or the clear, because then there would be nothing reliable to come back to.
   */
  async function finishHandoff(answer: string, isAborted: boolean): Promise<void> {
    const t = compactOps
    const p = pendingHandoff
    pendingHandoff = null
    if (!t || !p) return
    await t.setRunning(null)
    let body: string | null = null
    if (!isAborted && (await t.exists(p.draft).catch(() => false))) body = (await t.read(p.draft).catch(() => '')).trim() || null
    // a reply that carried the handoff in its text (an older prompt) still counts
    if (!body && !isAborted) body = extractHandoff(answer)
    await t.remove(p.draft).catch(() => undefined)
    if (!body) return failed(t, p, null, 'no handoff was written')
    // every required section, and every open task by its exact subject
    const missing = [...missingSections(body), ...missingTasks(body, p.tasks).map(subject => `open task "${subject}"`)]
    const path = await chooseHandoffPath(t, p, handoffName(body, p.fallbackName))
    try {
      await saveHandoff(t, p.root, path, p.at, handoffFile({ body, at: p.at, state: p.state, path, missing, tasks: p.tasks }))
    } catch (err) {
      return failed(t, p, null, `it could not be saved (${errorText(err)})`)
    }
    if (missing.length) return failed(t, p, path, `${path} is missing ${missing.join(', ')}`)
    const committed = p.repoRoot && settings.commitHandoffs ? await commitHandoff(t, p.repoRoot, path, p.at) : null
    const commitNote = committed === null ? null : committed.ok ? 'committed' : `not committed: ${committed.reason}`
    const now = await t.now()
    await record(t, p.root, { path, at: now, outcome: commitNote ?? 'saved' })
    const next = handoffDoneText({ at: now, path, then: p.then, commit: commitNote })
    await t.setLink(path)
    await t.setResult(null)
    await t.setRunning(next)
    t.toast(next)
    // its own dispatch, after this turn's end has settled; then what the button says
    const line = handoffLine({ at: now, path, commit: commitNote })
    if (p.then === 'compact') t.later(0, () => void compactNow({ path, line }, p.finished))
    else
      t.later(0, () =>
        void t
          .clear()
          .then(async () => {
            await t.setRunning(null)
            await t.setResult(clearDoneText(await t.now(), path))
          })
          .catch(async (err: unknown) => {
            await t.setRunning(null)
            const text = `Clear failed on ${when(await t.now())}: ${errorText(err)}. The handoff is saved: ${path}. Type /clear yourself.`
            await t.setResult(text)
            t.toast(text)
          }),
      )
  }

  /** A handoff that did not complete: said in the bar and recorded; nothing is compacted or cleared. */
  async function failed(t: CompactOps, p: { root: string; then: 'clear' | 'compact' }, path: string | null, reason: string): Promise<void> {
    const now = await t.now()
    await record(t, p.root, { path, at: now, outcome: `failed: ${reason}` })
    if (path) await t.setLink(path)
    const text = handoffFailedText({ at: now, reason, then: p.then })
    await t.setResult(text)
    t.toast(text)
  }

  /** What `/context-bar status` reports about the last handoff: where it went and how it ended. */
  async function record(t: CompactOps, root: string, last: { path: string | null; at: number; outcome: string }): Promise<void> {
    await t.storeSet(handoffRunKey(root), last).catch(() => undefined)
  }

  /**
   * `<name>-handoff.md`, updated in place when it is a committed file with no local changes (git keeps the earlier
   * version). Otherwise (uncommitted changes, perhaps another session's; an untracked file; commits off; no git) a new
   * dated file, so nothing that is not in git is ever overwritten.
   */
  async function chooseHandoffPath(
    t: CompactOps,
    p: { dir: string; repoRoot: string | null; at: number },
    name: string,
  ): Promise<string> {
    const named = namedHandoffPath(p.dir, name)
    if (!(await t.exists(named).catch(() => true))) return named
    if (!p.repoRoot || !settings.commitHandoffs) return datedHandoffPath(p.dir, name, p.at)
    const rel = named.startsWith(`${p.repoRoot}/`) ? named.slice(p.repoRoot.length + 1) : named
    try {
      const tracked = await t.run(['git', 'ls-files', '--error-unmatch', '--', rel], p.repoRoot)
      const status = await t.run(['git', 'status', '--porcelain', '--', rel], p.repoRoot)
      const clean = tracked.exitCode === 0 && status.exitCode === 0 && status.stdout.trim() === ''
      return clean ? named : datedHandoffPath(p.dir, name, p.at)
    } catch {
      return datedHandoffPath(p.dir, name, p.at)
    }
  }

  /**
   * Commits the one handoff file by path (`git commit -- <file>` commits only that file, whatever else is staged), so
   * nothing another session has in the working tree or the index is touched. Skipped while a merge or rebase runs.
   */
  async function commitHandoff(t: CompactOps, repoRoot: string, path: string, at: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (busy.merging) return { ok: false, reason: 'a git merge or rebase is in progress' }
    const rel = path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path
    try {
      const add = await t.run(['git', 'add', '--', rel], repoRoot)
      if (add.exitCode !== 0) return { ok: false, reason: firstLine(add.stderr) || `git add exited ${add.exitCode}` }
      const commit = await t.run(['git', 'commit', '-m', handoffCommitMessage(projectSlug(repoRoot), at), '--', rel], repoRoot)
      if (commit.exitCode !== 0) return { ok: false, reason: firstLine(commit.stderr || commit.stdout) || `git commit exited ${commit.exitCode}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: errorText(err) }
    }
  }

  async function resumeFromHandoff(): Promise<void> {
    const t = compactOps
    if (!t) return
    const tip = await t.getTip()
    await t.setTip(null)
    if (!tip?.handoff) return
    await t.fill(resumePrompt(tip.handoff))
    t.toast(RESUME_TOAST)
  }

  const compactOn = {
    /** "Handoff & compact": Claude writes the handoff, it is saved, then the conversation is compacted. */
    compact: () => void startHandoff('compact'),
    /** "handoff & clear" / "handoff & compact": Claude writes the handoff, it is saved, then /clear goes in the prompt box. */
    handoff: () => void startHandoff('clear'),
    resume: () => void resumeFromHandoff(),
  }

  /**
   * The person sent a message. A compact suggestion stays: it is still true until they act on it, a compaction
   * shrinks the context, or a newer moment replaces it. Only the offer to continue from the last handoff goes, since
   * typing something else means they started on other work.
   */
  async function onPersonPrompt(): Promise<void> {
    const t = compactOps
    if (!t) return
    await t.setResult(null)
    if ((await t.getTip())?.reason === 'resume') await t.setTip(null)
  }

  /** Before any compaction (typed, automatic or another plugin's): the keep list, and a warning if now is a bad moment. */
  async function prepareCompact(e: {
    trigger: SessionCompactTrigger
    instructions?: string
    agentId?: string
  }): Promise<{ instructions: string; warning: string | null }> {
    const instructions =
      e.instructions !== undefined && hasKeepList(e.instructions)
        ? e.instructions
        : withKeepList(e.instructions)
    const why = e.agentId === undefined && e.trigger === 'manual' ? busyReason(busy) : null
    return { instructions, warning: why ? busyWarning(why) : null }
  }

  /** After a compaction that stands, on the main conversation: the handoff saved and the git state put back as a note. */
  async function completeCompact(
    e: { trigger: SessionCompactTrigger; agentId?: string },
    r: SessionCompactResult,
  ): Promise<SessionCompactResult> {
    const t = compactOps
    if (e.agentId !== undefined || e.trigger === 'precompute' || !t || r.skip !== undefined) return r
    const state = await machineState(t)
    const handoff = await finishCompact(t, r, state, e.trigger === 'auto')
    return { ...r, messages: [...r.messages, stateMessage(state, handoff)] }
  }

  return {
    setOps: (o: CompactOps) => {
      compactOps = o
    },
    isTurnRunning: () => turnRunning,
    /** How old a handoff may be and still be offered to a new session. */
    handoffMaxAgeMs: () => settings.offerHandoffHours * 3_600_000,
    /** The repository's main folder once read; null outside git or before the first read. */
    repoMain: () => repo?.main ?? null,
    buttons: compactOn,
    checkWork,
    afterTool,
    onTaskNotification,
    onPersonPrompt,
    /** `/context-bar handoff`: the same flow as the button, at any time. */
    startHandoff,
    /** What `/context-bar status` reports. */
    snapshotForStatus: () => ({ busy, turnRunning, waiting: deferred ? `${deferred.reason}${deferred.what ? ` (${deferred.what})` : ''}` : null, settings }),
    /** How many open tasks the next handoff carries, for /context-bar status. */
    openTaskCount: async () => (compactOps ? openTasks(await compactOps.getTasks()).length : 0),
    prepareCompact,
    completeCompact,
    onTurnStart: () => {
      turnRunning = true
      turnSkills = []
    },
    /** The handoff turn ends in step 2; any other long turn that used a skill is a finished piece of work. */
    onTurnComplete: async (answer: string, isAborted: boolean, durationMs: number) => {
      turnRunning = false
      const skills = turnSkills
      turnSkills = []
      if (pendingHandoff) {
        await finishHandoff(answer, isAborted).catch(() => {})
        return
      }
      const last = skills[skills.length - 1]
      if (!isAborted && last && durationMs >= settings.longSkillRunMinutes * 60_000) await suggest('finished', last).catch(() => {})
    },
  }
}

export type CompactFlow = ReturnType<typeof createCompactFlow>
