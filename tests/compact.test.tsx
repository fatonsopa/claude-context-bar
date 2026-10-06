import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { AgentInfo, On, SessionContextBreakdown, SessionMessage, SessionUsage } from 'claude-code'

import {
  DEFAULT_SETTINGS,
  IDLE,
  KEEP_LIST,
  STATE_TAG,
  backgroundTaskOf,
  busyReason,
  busyWarning,
  changedFiles,
  committed,
  doneText,
  endedTask,
  clearDoneText,
  compactingText,
  handoffDoneText,
  handoffLine,
  handoffFailedText,
  when,
  datedHandoffPath,
  extractHandoff,
  fallbackHandoffName,
  handoffName,
  missingSections,
  namedHandoffPath,
  offersHandoff,
  pushed,
  pushedTo,
  pushTarget,
  hostName,
  nextTasks,
  openTasks,
  missingTasks,
  resumePrompt,
  settingsFrom,
  handoffFile,
  handoffRequest,
  handoffMarkdown,
  handoffPath,
  hasKeepList,
  headOf,
  isLargeOutput,
  isTestRun,
  largeOutputText,
  shouldSuggest,
  testsFailed,
  tipText,
  withKeepList,
} from '../hooks/compact'
import { buildSnapshot } from '../hooks/snapshot'
import { BUTTON_COLOR, SQUARE, SUGGESTED_SQUARE } from '../hooks/barView'
import { MESSAGE_FG } from '../hooks/compactView'
import { ACCENT, BAD, BORDER, FREE, GOOD, MARKER, MUTED, PALETTE, WARN } from '../hooks/categories'
import { LIMIT_COLORS } from '../hooks/limitsView'
import { VERSION } from '../hooks/version'
import type { CompactTip, TrackedTask } from '../types'
import { BAND, BREAKDOWN, MEASURE, START, USAGE, engine, run } from './fixtures'

// ---------------------------------------------------------------- a session with a long conversation

const LONG: SessionContextBreakdown = {
  ...BREAKDOWN,
  categories: BREAKDOWN.categories.map(c =>
    c.name === 'Messages' ? { ...c, tokens: 120_000 } : c.name === 'Free space' ? { ...c, tokens: 777_000 } : c,
  ),
  totalTokens: 210_300,
  percentage: 21,
}
const LONG_USAGE: SessionUsage = { ...USAGE, context: { tokens: 210_300, window: 1_000_000, percent: 21, breakdown: LONG } }
const LONG_SNAP = buildSnapshot(LONG, 'summary', [], null, 0)
const SHORT_SNAP = buildSnapshot(BREAKDOWN, 'summary', [], null, 0)
const CONVERSATION: SessionMessage[] = [
  { role: 'user', text: 'add the export button', toolUses: [] },
  { role: 'assistant', text: 'Done, committed as abc1234.', toolUses: [] },
]

/** A header button shows it is suggested by ▣ in place of its ■, as a selected category does. */
const marked = async (ui: { find: (q: { key: string }) => Promise<unknown> }, key: string) =>
  (((await ui.find({ key })) as { text?: string } | undefined)?.text ?? '').startsWith(SUGGESTED_SQUARE)

/** Words Claude Code users do not use: the copy speaks /compact, context, /clear and handoff instead. */
const INVENTED = /\btid(y|ied|ying)\b|Claude's memory|\bhelpers?\b|start fresh|pick up/i

type World = {
  /** Every process the mod ran, as argv. */
  runs: string[][]
  submitted: string[]
  box: { text: string }
  written: { path: string; text: string }[]
  toasts: string[]
  filled: string[]
  compacts: { instructions?: string; trigger: string }[]
  /** The subagents the engine lists for this session; a test changes their status. */
  agents: AgentInfo[]
  /** What Claude wrote to the handoff draft this turn (null: nothing written). */
  draft: { text: string | null }
  /** Files the bar removed (its drafts). */
  removed: string[]
  /** Core commands the bar ran (`clear`). */
  commands: string[]
  /** Holds a compaction open until it resolves, so a test can see what the bar shows while one runs. */
  holdCompact: Promise<void> | null
  /** Files already in the handoff folder, as `fs.list` names them. */
  listing: string[]
  clock: ReturnType<typeof engine>
}

/** The machine beneath the plugin: a git repository at /proj on branch dev, a home folder, a store. */
function world(
  on: On,
  opts: {
    usage?: SessionUsage
    store?: Record<string, unknown>
    bash?: Record<string, { stdout: string; stderr: string; backgroundTaskId?: string }>
    /** The session is not inside a git repository. */
    noGit?: boolean
    /** `git commit` fails with this message on stderr. */
    commitFails?: string
    /** A `<name>-handoff.md` that already exists: committed and unchanged, changed locally, or untracked. */
    existingHandoff?: 'clean' | 'changed' | 'untracked'
    /** `git add` fails with this message on stderr. */
    addFails?: string
  } = {},
): World {
  const w: Omit<World, 'clock'> = {
    runs: [],
    submitted: [],
    box: { text: '' },
    written: [],
    toasts: [],
    filled: [],
    compacts: [],
    agents: [],
    draft: { text: null },
    removed: [],
    commands: [],
    listing: [],
    holdCompact: null,
  }
  const isDraft = (path: string) => /\/\.handoff-draft-\d{8}-\d{6}\.md$/.test(path)
  on('session.usage', () => ({ value: opts.usage ?? LONG_USAGE }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('fs.exists', ($, e) => ({
    value: isDraft(e.path)
      ? w.draft.text !== null
      : // the stored handoffs the resume tests point at; a new handoff file does not exist yet
        (e.path.startsWith('/home/me/.claude/handoffs/') && !e.path.endsWith('/export-button-handoff.md')) ||
        (opts.existingHandoff !== undefined && e.path.endsWith('/export-button-handoff.md')) ||
        // a file the bar wrote exists from then on
        w.written.some(f => f.path === e.path),
  }))
  on('fs.read', ($, e) => ({ value: isDraft(e.path) ? (w.draft.text ?? '') : '' }))
  on('fs.list', () => ({ value: w.listing.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })) }))
  on('command.run', ($, e) => {
    w.commands.push(e.command)
    return { text: '' }
  })
  on('agent.list', () => ({ value: w.agents }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('fs.write', ($, e) => {
    w.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    const cmd = e.argv.join(' ')
    if (e.argv[0] === 'rm') {
      const path = e.argv[e.argv.length - 1] ?? ''
      w.removed.push(path)
      if (isDraft(path)) w.draft.text = null
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (opts.addFails && cmd.startsWith('git add')) {
      return { value: { exitCode: 128, stdout: '', stderr: `${opts.addFails}\n`, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (opts.noGit && e.argv[0] === 'git') {
      return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd.startsWith('git ls-files --error-unmatch')) {
      const exitCode = opts.existingHandoff === 'untracked' ? 1 : 0
      return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd.startsWith('git status --porcelain --')) {
      const rel = e.argv[e.argv.length - 1] ?? ''
      const stdout = opts.existingHandoff === 'changed' ? ` M ${rel}\n` : opts.existingHandoff === 'untracked' ? `?? ${rel}\n` : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (opts.commitFails && cmd.startsWith('git commit')) {
      return { value: { exitCode: 1, stdout: '', stderr: `${opts.commitFails}\n`, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    // where a push went, when its output does not say: the branch's push remote and that remote's address
    const remotes: Record<string, string> = { origin: 'git@github.com:me/app.git', backup: 'https://gitlab.com/me/app.git' }
    if (cmd === 'git rev-parse --abbrev-ref @{push}') {
      return { value: { exitCode: 0, stdout: 'origin/dev\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd.startsWith('git remote get-url --push ')) {
      const url = remotes[e.argv[e.argv.length - 1] ?? '']
      return { value: { exitCode: url ? 0 : 2, stdout: url ? `${url}\n` : '', stderr: url ? '' : 'error: No such remote', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = cmd.startsWith('git rev-parse')
      ? '/proj\n/proj/.git\n/proj/.git\n'
      : cmd === 'git branch --show-current'
        ? 'dev\n'
        : cmd.startsWith('git log -1')
          ? 'abc1234\tAdd the export button\n'
          : cmd === 'git status --porcelain'
            ? ' M src/a.ts\nR  old.ts -> new.ts\n?? notes.md\n'
            : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(typeof e === 'string' ? e : String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
  on('prompt.fill', ($, e) => {
    w.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.read', () => ({ value: { text: w.box.text, cursor: w.box.text.length } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('session.compact', async ($, e) => {
    w.compacts.push({ instructions: e.instructions, trigger: e.trigger })
    if (w.holdCompact) await w.holdCompact
    return {
      messages: [{ role: 'user' as const, text: 'SUMMARY: the export button is done; next is the import page.', toolUses: [] }],
      tokensBefore: 400_000,
      tokensAfter: 90_000,
    }
  })
  let lastTaskId = 0
  on('tool.call', ($, e) => {
    const call = e as unknown as { tool: string; command?: string; subject?: string; taskId?: string }
    // the task tools, answered as Claude Code answers them: a new id per task, success for an update
    if (call.tool === 'TaskCreate') return { result: { task: { id: String(++lastTaskId), subject: call.subject ?? '' } } }
    if (call.tool === 'TaskUpdate') return { result: { success: true, taskId: call.taskId ?? '', updatedFields: [] } }
    if (call.tool === 'Bash' && call.command?.startsWith('git commit')) {
      return { result: { stdout: '[dev abc1234] Add the export button\n 2 files changed', stderr: '', interrupted: false } }
    }
    if (call.command === 'cat big.log') return { result: { stdout: 'x'.repeat(80_000), stderr: '', interrupted: false } }
    const canned = call.command ? opts.bash?.[call.command] : undefined
    if (canned) return { result: { ...canned, interrupted: false } }
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  mock.store(on, opts.store ?? {})
  const clock = engine(on)
  // the same object the stubs read, so a test that changes w.agents changes what the engine lists
  return Object.assign(w, { clock })
}

// ---------------------------------------------------------------- reading what a command did

test('a successful git commit is recognised by the line git prints; a dry run or other command is not', () => {
  expect(committed('git commit -m "x"', '[dev 548e39ad9] A submit run is judged\n 1 file changed')).toEqual({
    sha: '548e39ad9',
    subject: 'A submit run is judged',
  })
  expect(committed('git commit -m init', '[main (root-commit) abc1234] init')).toEqual({ sha: 'abc1234', subject: 'init' })
  expect(committed('git commit --dry-run -m x', '[dev abc1234] x')).toBeNull()
  expect(committed('git log -1', '[dev abc1234] x')).toBeNull()
  expect(committed('git commit -m x', 'nothing to commit, working tree clean')).toBeNull()
})

test('a test run is recognised, and counted as failing only when something failed', () => {
  expect(isTestRun('npx vitest run src/a.test.ts')).toBe(true)
  expect(isTestRun('npm run test:smoke')).toBe(true)
  expect(isTestRun('claude plugin test .')).toBe(true)
  expect(isTestRun('git status')).toBe(false)
  expect(testsFailed(false, 'Tests  2 failed | 10 passed')).toBe(true)
  expect(testsFailed(false, 'Tests  0 failed | 12 passed')).toBe(false)
  expect(testsFailed(true, '')).toBe(true)
})

test('long answers from a helper are the cure, not the problem', () => {
  expect(isLargeOutput('Bash', 20_000, 15_000)).toBe(true)
  expect(isLargeOutput('Bash', 2_000, 15_000)).toBe(false)
  expect(isLargeOutput('Agent', 20_000, 15_000)).toBe(false)
})

test('git status and git log lines read as files and a commit', () => {
  expect(changedFiles(' M src/a.ts\nR  old.ts -> new.ts\n?? notes.md\n')).toEqual(['src/a.ts', 'new.ts', 'notes.md'])
  expect(headOf('abc1234\tAdd the export button\n')).toEqual({ sha: 'abc1234', subject: 'Add the export button' })
  expect(headOf('')).toBeNull()
})

// ---------------------------------------------------------------- when to suggest

test('a suggestion needs a real amount of conversation, nothing under way, and no compaction just now', () => {
  const base = { snap: LONG_SNAP, busy: IDLE, lastCompactAt: null, now: 10 * 60 * 60_000, minConversation: DEFAULT_SETTINGS.suggestCompactAtTokens }
  expect(shouldSuggest(base)).toBe(true)
  expect(shouldSuggest({ ...base, snap: SHORT_SNAP })).toBe(false)
  expect(shouldSuggest({ ...base, busy: { ...IDLE, subagents: 1 } })).toBe(false)
  expect(shouldSuggest({ ...base, busy: { ...IDLE, merging: true } })).toBe(false)
  expect(shouldSuggest({ ...base, busy: { ...IDLE, testsFailing: true } })).toBe(false)
  expect(shouldSuggest({ ...base, lastCompactAt: base.now - 5 * 60_000 })).toBe(false)
  expect(shouldSuggest({ ...base, lastCompactAt: base.now - 11 * 60_000 })).toBe(true)
  expect(busyReason({ ...IDLE, subagents: 1 })).toBe('1 subagent is still running')
  expect(busyReason({ ...IDLE, subagents: 3 })).toBe('3 subagents are still running')
  expect(busyReason({ ...IDLE, shells: 1 })).toBe('1 background command is still running')
  expect(shouldSuggest({ ...base, busy: { ...IDLE, shells: 2 } })).toBe(false)
  expect(shouldSuggest({ ...base, minConversation: 200_000 })).toBe(false)
  expect(busyReason(IDLE)).toBeNull()
})

// ---------------------------------------------------------------- what every compaction keeps

test('every compaction keeps the person\'s own focus first, then the keep list', () => {
  const text = withKeepList('focus on the API changes')
  expect(text.startsWith('focus on the API changes')).toBe(true)
  expect(text).toContain(KEEP_LIST)
  expect(text).toContain('#autonomous')
  expect(text).toContain('Never write that something was approved unless the person said so.')
  expect(withKeepList(undefined)).toBe(KEEP_LIST)
  expect(hasKeepList(text)).toBe(true)
  expect(hasKeepList('focus on X')).toBe(false)
})

// ---------------------------------------------------------------- the words people read

test('everything the person reads uses Claude Code\'s own words: compact, context, clear, handoff, subagent', () => {
  const tips: CompactTip[] = [
    { reason: 'saved', at: 0, what: 'Add the export button', handoff: null },
    { reason: 'pushed', at: 0, what: 'dev -> dev', handoff: null },
    { reason: 'finished', at: 0, what: 'push-pipeline', handoff: null },
    { reason: 'resume', at: 0, what: null, handoff: '/home/me/.claude/handoffs/proj/x.md' },
  ]
  const texts = [
    ...tips.map(t => tipText(t, 30 * 60_000)),
    doneText({ before: 400_000, after: 90_000, max: 1_000_000, at: 0, auto: false }),
    doneText({ max: 1_000_000, at: 0, auto: true }),
    busyWarning('a push or release is still running'),
    largeOutputText(20_000, LONG_SNAP),
    largeOutputText(20_000, null),
    handoffDoneText({ at: 0, path: '/proj/x-handoff.md', then: 'compact', commit: 'committed' }),
    handoffFailedText({ at: 0, reason: 'no handoff was written', then: 'clear' }),
    clearDoneText(0),
  ]
  for (const t of texts) expect(INVENTED.test(t)).toBe(false)
  // what just finished, and nothing more: the marked button says which action fits, the bar how full the context is
  expect(tipText(tips[0] as CompactTip, 0)).toBe('✓ Changes committed')
  expect(tipText(tips[1] as CompactTip, 0)).toBe('✓ Pushed')
  expect(tipText({ ...(tips[1] as CompactTip), to: 'GitHub' }, 0)).toBe('✓ Pushed to GitHub')
  expect(tipText(tips[2] as CompactTip, 0)).toBe('✓ /push-pipeline finished')
  // no age, however long it waits
  expect(tipText(tips[0] as CompactTip, 25 * 60_000)).toBe('✓ Changes committed')
  // a handoff is offered at hard ends only, not after every commit
  expect(tips.map(t => offersHandoff(t))).toEqual([false, true, true, false])
  expect(doneText({ before: 400_000, after: 90_000, max: 1_000_000, at: 0, auto: false })).toBe(
    `Compact completed on ${when(0)}: context went from 40% to 9%.`,
  )
  expect(doneText({ max: 1_000_000, at: 0, auto: true })).toBe(`Auto-compact completed on ${when(0)}.`)
  expect(doneText({ before: 890_000, after: 20_000, max: 1_000_000, at: 0, auto: false, handoff: '/p/x-handoff.md' })).toBe(
    `Compact completed on ${when(0)}: context went from 89% to 2%.\nHandoff: /p/x-handoff.md`,
  )
  // the result format the person asked for: date, time, full path, then what starts
  const at = new Date(2026, 8, 7, 17, 39, 45).getTime()
  expect(when(at)).toBe('September 7, 5:39:45pm')
  expect(handoffDoneText({ at, path: '/proj/.claude/knowledge/handoffs/x-handoff.md', then: 'compact', commit: 'committed' })).toBe(
    'Handoff completed on September 7, 5:39:45pm: /proj/.claude/knowledge/handoffs/x-handoff.md\nNow starting compact...',
  )
  expect(handoffDoneText({ at, path: '/p/x-handoff.md', then: 'clear', commit: 'not committed: hook failed' })).toBe(
    'Handoff completed on September 7, 5:39:45pm: /p/x-handoff.md (not committed: hook failed)\nNow starting clear...',
  )
  // while compacting: the saved handoff, then "Compacting…" on a line of its own
  expect(compactingText(handoffLine({ at, path: '/p/x-handoff.md', commit: 'committed' }))).toBe(
    'Handoff completed on September 7, 5:39:45pm: /p/x-handoff.md\nCompacting… this can take a minute.',
  )
  expect(compactingText()).toBe('Compacting… this can take a minute.')
  expect(clearDoneText(at, '/p/x-handoff.md')).toBe('Clear completed on September 7, 5:39:45pm.\nHandoff: /p/x-handoff.md')
  expect(handoffFailedText({ at, reason: 'no handoff was written', then: 'compact' })).toBe(
    'Handoff failed on September 7, 5:39:45pm: no handoff was written. Nothing was compacted.',
  )
  expect(when(new Date(2026, 0, 2, 0, 5, 9).getTime())).toBe('January 2, 12:05:09am')
  expect(largeOutputText(20_000, LONG_SNAP)).toContain('use a subagent that reads them and reports back')
})

// ---------------------------------------------------------------- the handoff file

test('the handoff file lives under ~/.claude/handoffs/<project>/, outside the repository, and says how to use it', () => {
  const path = handoffPath('/home/me', '/Users/x/projects/My App', Date.UTC(2026, 9, 6, 17, 45, 12), 'compact')
  expect(path).toBe('/home/me/.claude/handoffs/my-app/20261006-174512-compact.md')
  const md = handoffMarkdown({
    project: 'my-app',
    at: Date.UTC(2026, 9, 6, 17, 45, 12),
    state: { folder: '/proj', branch: 'dev', head: { sha: 'abc1234', subject: 'Add X' }, changed: ['a.ts'], busy: IDLE },
    summary: 'SUMMARY TEXT',
    previous: '/home/me/.claude/handoffs/my-app/older.md',
  })
  expect(md).toContain('# Handoff — my-app — 2026-10-06 17:45 UTC')
  expect(md).toContain('Read this file and continue from where it ends.')
  expect(md).toContain('- Git branch: dev')
  expect(md).toContain('- Last commit: abc1234 "Add X"')
  expect(md).toContain('## Summary of the conversation\n\nSUMMARY TEXT')
  expect(md).toContain('## Earlier handoff\n\nThe handoff before this one: /home/me/.claude/handoffs/my-app/older.md')
  expect(md).toContain('Written when the context was compacted.')
})

// ---------------------------------------------------------------- the whole flow, through the engine

test('"handoff & compact": the handoff goes to a draft (never printed), is saved under its name and committed, then the conversation is compacted', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('✓ Changes committed')

  await ui.press({ key: 'compact-anytime' })
  await w.clock.settle()
  // 1: the request asks for a file, not a printed handoff; nothing is compacted yet
  expect(w.submitted.length).toBe(1)
  const req = w.submitted[0] ?? ''
  const draft = /Write tool to exactly this file: (\S+) \(/.exec(req)?.[1] ?? ''
  expect(draft).toMatch(/^\/proj\/\.claude\/knowledge\/handoffs\/\.handoff-draft-\d{8}-\d{6}\.md$/)
  expect(req).toContain('Do NOT print the handoff in your reply')
  expect(await bandText(ui)).toBe('Writing the handoff…')
  expect(w.compacts).toEqual([])

  // 2: Claude wrote the draft and replied with one line: saved under its name, draft removed, committed, reported
  w.draft.text = HANDOFF_BODY
  await $.turn.complete(handoffTurn('Handoff written.'))
  expect(w.written.find(f => f.path === SAVED)?.text.startsWith(HANDOFF_BODY)).toBe(true)
  expect(w.removed).toContain(draft)
  expect(w.runs.filter(a => a[0] === 'git' && (a[1] === 'add' || a[1] === 'commit')).map(a => a.slice(0, 2))).toEqual([
    ['git', 'add'],
    ['git', 'commit'],
  ])
  expect(await bandText(ui)).toMatch(completedOn(SAVED))
  expect(await bandText(ui)).toContain('Now starting compact...')

  // 3: then the compaction runs, as the button says: the saved handoff stays, "Compacting…" on a line of its own
  let release = () => {}
  w.holdCompact = new Promise<void>(resolve => {
    release = resolve
  })
  await w.clock.settle()
  expect(w.compacts.length).toBe(1)
  const during = await bandLines(ui)
  expect(during).toHaveLength(2)
  expect(during[0]).toMatch(completedOn(SAVED))
  expect(during[1]).toBe('Compacting… this can take a minute.')
  expect(await bandPaths(ui)).toEqual({ paths: [SAVED], links: 0, squeezed: 0 })
  release()
  await w.clock.settle()
  const sent = w.compacts[0]?.instructions ?? ''
  expect(sent.startsWith(`We just finished: Add the export button. A handoff for this work was just saved to ${SAVED}.`)).toBe(true)
  expect(sent).toContain(KEEP_LIST)
  expect(sent).toContain(`${STATE_TAG} Where things stood when the conversation was compacted:`)
  // 4: the result: how far the context went down, then the handoff, its path a link that opens the file
  const lines = await bandLines(ui)
  expect(lines[0]).toMatch(/^Compact completed on [A-Z][a-z]+ \d+, \d+:\d{2}:\d{2}[ap]m: context went from 40% to 9%\.$/)
  expect(lines[1]).toBe(`Handoff: ${SAVED}`)
  expect(lines).toHaveLength(2)
  // the path is drawn once, and pressing it opens the handoff file
  expect(await bandPaths(ui)).toEqual({ paths: [SAVED], links: 0, squeezed: 0 })
  await ui.press({ key: 'compact-open-1' })
  await w.clock.settle()
  expect(w.runs).toContainEqual(['open', SAVED])
  // yellow text on the terminal's own background: no band behind the result
  const texts = (await ui.findAll({ type: 'Text' })) as Node[]
  const result = texts.filter(t => visible(t).includes('Compact completed') || visible(t).includes('Handoff:'))
  expect(result.length).toBe(2)
  for (const t of result) {
    expect(t.props?.color).toBe(MESSAGE_FG)
    expect(t.props?.backgroundColor).toBeUndefined()
    expect(t.props?.bold).toBeFalsy()
  }
  await ui.unmount()
})

test('a /compact the person types gets the keep list and ends with a note of where things stood', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  // raised as the engine raises a person's own /compact
  const r = await $.session.compact({ trigger: 'manual', instructions: 'focus on the import page', messages: CONVERSATION })
  expect(w.compacts[0]?.instructions?.startsWith('focus on the import page')).toBe(true)
  expect(w.compacts[0]?.instructions).toContain(KEEP_LIST)
  const last = r.messages?.[r.messages.length - 1]
  expect(last?.role).toBe('user')
  expect(last?.text.startsWith(STATE_TAG)).toBe(true)
  expect(last?.text).toContain('- Git branch: dev')
  expect(last?.text).toContain('- Last commit: abc1234 "Add the export button"')
  expect(last?.text).not.toContain('Subagents still running')
  expect(last?.text).toMatch(/- Handoff: \/home\/me\/\.claude\/handoffs\/proj\/\d{8}-\d{6}-compact\.md/)
  // the bar's result names that handoff too, as a link
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const lines = await bandLines(ui)
  expect(lines[0]).toMatch(/^Compact completed on .*: context went from 40% to 9%\.$/)
  expect(lines[1]).toMatch(/^Handoff: \/home\/me\/\.claude\/handoffs\/proj\/\d{8}-\d{6}-compact\.md$/)
  expect(await bandPaths(ui)).toEqual({ paths: [lines[1]?.slice('Handoff: '.length)], links: 0, squeezed: 0 })
  await ui.unmount()
})

const HANDOFF_BODY = [
  '# Handoff — export-button — 2026-10-06 17:00 UTC',
  '## Goal',
  'Ship the export button.',
  '## Where things stand',
  '- Export button: done (commit abc1234, 12/12 tests).',
  '## Decisions and approvals',
  'none',
  '## Next steps',
  '1. Run `npm run test:smoke`.',
  '## How to verify',
  '`npm run test:smoke` → 12/12 on the last run.',
  '## How to resume',
  '1. git status. 2. Read this file. 3. Run How to verify. 4. Next steps 1.',
].join('\n')

/** The turn Claude answers the handoff request in, as the engine raises its end. */
const handoffTurn = (answer: string, isAborted = false) => ({
  answer,
  durationMs: 1_000,
  isAborted,
  turnId: 'turn-handoff',
  reason: isAborted ? ('aborted' as const) : ('answer' as const),
})

/** Where the bar saves the test handoff ("# Handoff — export-button — …"). */
const SAVED = '/proj/.claude/knowledge/handoffs/export-button-handoff.md'
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** "Handoff completed on September 7, 5:39:45pm: <path>" for any time. */
const completedOn = (path: string) => new RegExp(`Handoff completed on [A-Z][a-z]+ \\d+, \\d+:\\d{2}:\\d{2}[ap]m: ${esc(path)}`)
type Node = { type?: string; props?: Record<string, unknown>; children?: (Node | string)[] }
/** What a person reads in a node: its strings and Button labels; a column Box puts each child on a line of its own. */
const visible = (n: Node | string | undefined): string =>
  typeof n === 'string'
    ? n
    : !n
      ? ''
      : n.type === 'Button'
        ? String(n.props?.label ?? '')
        : (n.children ?? []).map(visible).join(n.type === 'Box' && n.props?.flexDirection === 'column' ? '\n' : n.props?.columnGap ? ' ' : '')
/** The bar's own line (what it is doing, or its last result), as one string. */
const bandText = async (ui: { find: (q: { key: string }) => Promise<unknown> }) =>
  visible((await ui.find({ key: 'compact' })) as Node | undefined).replace(/\s+/g, ' ').trim()
/** The bar's own line, line by line, as a person reads it. */
const bandLines = async (ui: { find: (q: { key: string }) => Promise<unknown> }) => {
  const lines: string[] = []
  for (let i = 0; i < 6; i++) {
    const line = (await ui.find({ key: `compact-line-${i}` })) as Node | undefined
    if (line) lines.push(visible(line).trim())
  }
  return lines
}
/** The pressable paths in the bar's line (a press opens the file), how many Links it draws (none: a terminal
 * without hyperlinks would print a Link's URL a second time), and how many rows holding a path do not wrap (none: a
 * row that cannot wrap squeezes its words into a narrow column beside a path too long to fit next to them). */
const bandPaths = async (ui: { findAll: (q: { type: string }) => Promise<unknown[]> }) => ({
  paths: ((await ui.findAll({ type: 'Button' })) as Node[])
    .filter(b => String(b.props?.key ?? '').startsWith('compact-open-'))
    .map(b => String(b.props?.label)),
  links: ((await ui.findAll({ type: 'Link' })) as Node[]).length,
  squeezed: ((await ui.findAll({ type: 'Box' })) as Node[]).filter(
    b =>
      String(b.props?.key ?? '').startsWith('compact-line-') &&
      (b.children ?? []).some(c => typeof c !== 'string' && String(c?.props?.key ?? '').startsWith('compact-open-')) &&
      b.props?.flexWrap !== 'wrap',
  ).length,
})

/**
 * Claude's handoff turn as it now runs: the request goes out on a 0 ms timer; Claude writes the draft with the Write
 * tool (`body`, or nothing) and replies with one line. The compaction or the clear then waits on its own 0 ms timer.
 */
async function claudeWrites($: Parameters<TestBody>[0], w: World, body: string | null, answer = 'Handoff written.') {
  await w.clock.settle()
  w.draft.text = body
  await $.turn.complete(handoffTurn(answer))
}

/** A turn that used a skill, as the engine raises its start and end. */
async function skillRun($: Parameters<TestBody>[0], skill: string, minutes: number) {
  await $.turn.start({ text: `run /${skill}`, turnId: `turn-${skill}` })
  await $.tool.call({ tool: 'Skill', skill })
  await $.turn.complete({ answer: 'Done.', durationMs: minutes * 60_000, isAborted: false, turnId: `turn-${skill}`, reason: 'answer' })
}

/** A session whose long skill run (a push, in this example) just ended, with the bar offering "Handoff and clear all context". */
async function skillRunJustEnded($: Parameters<TestBody>[0]) {
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await skillRun($, 'push-pipeline', 6)
}

test('a long skill run that ends is a finished piece of work; a short one is not', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await skillRun($, 'lint', 2)
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  await skillRun($, 'push-pipeline', 6)
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim() ?? '').toBe('✓ /push-pipeline finished')
  expect((await ui.find({ key: 'clear-anytime' }))?.text).toBe('handoff & clear')
  expect(await marked(ui, 'clear-anytime-box')).toBe(true)
  await ui.unmount()
})

test('while subagents still run nothing is suggested; the moment is offered once they finish', async ($, on) => {
  const w = world(on)
  w.agents = [{ id: 'a1', description: 'run the tests', type: 'general-purpose', status: 'running' }]
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await skillRun($, 'push-pipeline', 6)
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  w.agents = [{ id: 'a1', description: 'run the tests', type: 'general-purpose', status: 'completed' }]
  await w.clock.advance(12_000)
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim() ?? '').toBe('✓ /push-pipeline finished')
  await ui.unmount()
})

test('a push whose output does not name the remote (cut by `| tail -1`) still says where it went: git is asked', async ($, on) => {
  const w = world(on, {
    bash: {
      'git push 2>&1 | tail -1': { stdout: '   548e39a..abc1234  dev -> dev\n', stderr: '' },
      'cd ../mods && git push backup main 2>&1 | tail -1': { stdout: '   1a2b3c4..5d6e7f8  main -> main\n', stderr: '' },
    },
  })
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // no remote named: the branch's push remote (origin), on GitHub
  await $.tool.call({ tool: 'Bash', command: 'git push 2>&1 | tail -1' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim() ?? '').toBe('✓ Pushed to GitHub')
  expect(w.runs).toContainEqual(['git', 'remote', 'get-url', '--push', 'origin'])
  // another folder and a named remote: that remote's address, on GitLab
  await $.tool.call({ tool: 'Bash', command: 'cd ../mods && git push backup main 2>&1 | tail -1' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim() ?? '').toBe('✓ Pushed to GitLab')
  expect(w.runs).toContainEqual(['git', 'remote', 'get-url', '--push', 'backup'])
  await ui.unmount()
})

test('a git push that sent something is a hard end; "Everything up-to-date" is not', async ($, on) => {
  world(on, {
    bash: {
      'git push origin dev': { stdout: '', stderr: 'To github.com:me/app.git\n   548e39a..abc1234  dev -> dev\n' },
      'git push origin main': { stdout: '', stderr: 'Everything up-to-date\n' },
    },
  })
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'git push origin dev' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim() ?? '').toBe('✓ Pushed to GitHub')
  expect(await marked(ui, 'clear-anytime-box')).toBe(true)
  await ui.unmount()
})

test('"handoff & clear": the handoff is saved, then /clear is run, as the button says', async ($, on) => {
  const w = world(on)
  await skillRunJustEnded($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clear-anytime' })
  await claudeWrites($, w, HANDOFF_BODY)
  expect(await bandText(ui)).toMatch(completedOn(SAVED))
  expect(await bandText(ui)).toContain('Now starting clear...')
  expect(w.commands).toEqual([])
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
  expect(w.filled).toEqual([])
  expect(await bandLines(ui)).toEqual([expect.stringMatching(/^Clear completed on [A-Z][a-z]+ \d+, .*\.$/), `Handoff: ${SAVED}`])
  expect(await bandPaths(ui)).toEqual({ paths: [SAVED], links: 0, squeezed: 0 })
  await ui.unmount()
})

for (const [what, body, aborted] of [
  ['no draft written', null, false],
  ['an interrupted turn', HANDOFF_BODY, true],
] as const) {
  test(`no handoff (${what}): nothing is saved, nothing is compacted or cleared, and the bar says so`, async ($, on) => {
    const w = world(on)
    await skillRunJustEnded($)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'compact-anytime' })
    await w.clock.settle()
    w.draft.text = body
    await $.turn.complete(handoffTurn('I could not write it.', aborted))
    await w.clock.settle()
    expect(w.written.some(f => f.path === SAVED)).toBe(false)
    expect(w.compacts).toEqual([])
    expect(w.commands).toEqual([])
    expect(await bandText(ui)).toMatch(/^Handoff failed on [A-Z][a-z]+ \d+, .*: no handoff was written\. Nothing was compacted\.$/)
    await ui.unmount()
  })
}


test('the handoff request follows the published guidance: self-contained, evidence, verification, failed approaches, resume routine', () => {
  const req = handoffRequest({
    project: 'proj',
    at: Date.UTC(2026, 9, 6, 17, 0),
    state: { folder: '/proj', branch: 'dev', head: { sha: 'abc1234', subject: 'Add X' }, changed: [], busy: IDLE },
    draft: '/r/.handoff-draft-20261006-170000.md',
  })
  for (const section of [
    '## Goal',
    '## Where things stand',
    '## Decisions and approvals',
    '## Next steps',
    '## How to verify',
    '## Open problems',
    '## Tried and did not work',
    '## Files',
    '## Running',
    '## Out of scope',
    '## Open questions',
    '## How to resume',
  ]) {
    expect(req).toContain(section)
  }
  expect(req).toContain('Never call something done that was not verified.')
  expect(req).toContain('## Next steps (required):')
  expect(req).toContain('## Files: ')
  expect(req).not.toContain('## Files (required)')
  // written to a file, never printed in the transcript
  expect(req).toContain('Write it with the Write tool to exactly this file: /r/.handoff-draft-20261006-170000.md')
  expect(req).toContain('Do NOT print the handoff in your reply')
  expect(req).toContain('Start with "# Handoff — <name> — 2026-10-06 17:00 UTC". <name> names the file')
  expect(req).toContain('- Last commit: abc1234 "Add X"')
  expect(extractHandoff(`x <handoff>\n${HANDOFF_BODY}\n</handoff> y`)).toBe(HANDOFF_BODY)
  expect(extractHandoff('no markers here')).toBeNull()
  expect(extractHandoff('<handoff>  </handoff>')).toBeNull()
  const file = handoffFile({ body: HANDOFF_BODY, at: 0, state: { folder: '/proj', branch: null, head: null, changed: [], busy: IDLE }, path: '/h/x.md' })
  expect(file.endsWith('To continue in a new session, say: **Read /h/x.md and follow its "How to resume".**\n')).toBe(true)
})

test('a new session (after /clear or a fresh start) offers the latest handoff; Continue puts the resume request in the box', async ($, on) => {
  const path = '/home/me/.claude/handoffs/proj/20261006-170000-handoff.md'
  const w = world(on, { store: { 'handoff:proj': { path, at: 60_000 } } })
  await w.clock.set(30 * 60_000)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('↺ A handoff from your last session was saved 29 min ago — continue from it?')
  expect((await ui.find({ key: 'compact-resume' }))?.text).toBe('Continue')
  await ui.press({ key: 'compact-resume' })
  expect(w.filled[0] ?? '').toBe(
    `Read ${path}. If it has a "Task list to recreate on resume" section, first recreate those tasks exactly as it says. Then follow its "How to resume": check the folder and branch, run "How to verify", and tell me in two lines where things stand and what you will do first.`,
  )
  expect(await ui.find({ key: 'compact-resume' })).toBeUndefined()
  await ui.unmount()
})

test('a very long tool answer earns one tip, not one per call; a subagent\'s long report earns none', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'cat big.log' })
  await $.tool.call({ tool: 'Bash', command: 'cat big.log' })
  const tips = w.toasts.filter(t => t.startsWith('That step returned a lot of text'))
  expect(tips.length).toBe(1)
  expect(tips[0] ?? '').toContain('(about 2% of the context)')
})

test('a /compact typed while subagents still run gets a warning, and still goes ahead', async ($, on) => {
  const w = world(on)
  w.agents = [{ id: 'a1', description: 'run the tests', type: 'general-purpose', status: 'waiting' }]
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await w.clock.advance(12_000)
  await $.session.compact({ trigger: 'manual', messages: CONVERSATION })
  expect(w.toasts).toContain('Heads-up: 1 subagent is still running. Compacting now can lose details it still needs.')
  expect(w.compacts.length).toBe(1)
})

test('a fresh `claude` start offers the latest handoff too; the person\'s next message ends the offer', async ($, on) => {
  const path = '/home/me/.claude/handoffs/proj/20261006-170000-handoff.md'
  const w = world(on, { store: { 'handoff:proj': { path, at: 0 } } })
  await w.clock.set(60 * 60_000)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('↺ A handoff from your last session was saved 1 hour ago — continue from it?')
  expect(await ui.find({ key: 'compact-later' })).toBeUndefined()
  await $.prompt.submit({ text: 'something else first', origin: { kind: 'composer' }, wait: false })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  await ui.unmount()
})

test('a handoff older than 6 hours is not offered', async ($, on) => {
  const path = '/home/me/.claude/handoffs/proj/20261006-100000-handoff.md'
  const w = world(on, { store: { 'handoff:proj': { path, at: 0 } } })
  await w.clock.set(7 * 60 * 60_000)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  await ui.unmount()
})

test('a handoff is complete only when every required section is there and not empty', () => {
  expect(missingSections(HANDOFF_BODY)).toEqual([])
  // a trailing colon, a "(required)" marker or another case still counts as the heading
  expect(missingSections(HANDOFF_BODY.replace('## Next steps', '## next steps (required):'))).toEqual([])
  expect(missingSections(HANDOFF_BODY.replace('## Next steps\n1. Run `npm run test:smoke`.\n', ''))).toEqual(['Next steps'])
  // a heading with nothing under it is as good as missing
  expect(missingSections(HANDOFF_BODY.replace('`npm run test:smoke` → 12/12 on the last run.\n', ''))).toEqual(['How to verify'])
  expect(missingSections('# Handoff\n## Goal\nx')).toEqual([
    'Where things stand',
    'Decisions and approvals',
    'Next steps',
    'How to verify',
    'How to resume',
  ])
})

test('an incomplete handoff is saved and flagged, and nothing is compacted or cleared', async ($, on) => {
  const w = world(on)
  await skillRunJustEnded($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clear-anytime' })
  await claudeWrites($, w, HANDOFF_BODY.replace('## How to verify\n`npm run test:smoke` → 12/12 on the last run.\n', ''))
  await w.clock.settle()
  expect(w.written.find(f => f.path === SAVED)?.text.startsWith('> **Incomplete handoff:** missing How to verify.')).toBe(true)
  expect(w.commands).toEqual([])
  expect(await bandText(ui)).toMatch(new RegExp(`^Handoff failed on .*: ${esc(SAVED)} is missing How to verify\\. Nothing was cleared\\.$`))
  await ui.unmount()
})

// ---------------------------------------------------------------- any project

test('settings come from /config (the plugin\'s userConfig); anything missing or invalid keeps its default', () => {
  expect(settingsFrom({})).toEqual(DEFAULT_SETTINGS)
  expect(
    settingsFrom({ suggest_compact_at_tokens: 200_000, long_output_tokens: 5_000, long_skill_run_minutes: 10, offer_handoff_hours: 2 }),
  ).toEqual({ ...DEFAULT_SETTINGS, suggestCompactAtTokens: 200_000, longOutputTokens: 5_000, longSkillRunMinutes: 10, offerHandoffHours: 2 })
  expect(settingsFrom({ handoff_folder: 'docs/handoffs/', commit_handoffs: false })).toEqual({
    ...DEFAULT_SETTINGS,
    handoffFolder: 'docs/handoffs',
    commitHandoffs: false,
  })
  expect(settingsFrom({ handoff_folder: '../outside' }).handoffFolder).toBe('.claude/knowledge/handoffs')
  expect(settingsFrom({ handoff_folder: '/abs' }).handoffFolder).toBe('.claude/knowledge/handoffs')
  expect(settingsFrom({ suggest_compact_at_tokens: -1, long_output_tokens: 'lots' })).toEqual(DEFAULT_SETTINGS)
})

test('git push output: what was sent is read from the "from -> to" line', () => {
  expect(pushed('git push origin dev', 'To github.com:me/app.git\n   548e39a..abc1234  dev -> dev')).toBe('dev -> dev')
  expect(pushed('git push -u origin feat', ' * [new branch]      feat -> feat')).toBe('feat -> feat')
  expect(pushed('git push --force', ' + 1a2b3c...4d5e6f dev -> dev (forced update)')).toBe('dev -> dev')
  expect(pushed('git push', 'Everything up-to-date')).toBeNull()
  expect(pushed('git push --dry-run', '   548e39a..abc1234  dev -> dev')).toBeNull()
  expect(pushed('git status', '   548e39a..abc1234  dev -> dev')).toBeNull()
  // what a push command names: the folder it ran in and the remote, skipping options and redirections
  expect(pushTarget('git push origin dev')).toEqual({ dir: null, remote: 'origin' })
  expect(pushTarget('git push')).toEqual({ dir: null, remote: null })
  expect(pushTarget('cd ~/.claude/mods && git push -q 2>&1 | tail -2')).toEqual({ dir: '~/.claude/mods', remote: null })
  expect(pushTarget('git -C "/x/my repo" push -u upstream main')).toEqual({ dir: '/x/my repo', remote: 'upstream' })
  expect(pushTarget('git push -o ci.skip --force-with-lease origin main')).toEqual({ dir: null, remote: 'origin' })
  expect(pushTarget('git push --repo=backup')).toEqual({ dir: null, remote: 'backup' })
  expect(pushTarget('git push git@gitlab.com:me/app.git main')).toEqual({ dir: null, remote: 'git@gitlab.com:me/app.git' })
  expect(hostName('git@gitlab.com:me/app.git')).toBe('GitLab')
  expect(hostName('origin')).toBeNull()
  // where it went, from the "To <remote>" line, for any remote
  expect(pushedTo('To github.com:me/app.git\n   548e39a..abc1234  dev -> dev')).toBe('GitHub')
  expect(pushedTo('To git@github.com:fatonsopa/claude-context-bar.git\n * [new branch]      main -> main')).toBe('GitHub')
  expect(pushedTo('To https://gitlab.com/me/app.git\n   1a..2b  main -> main')).toBe('GitLab')
  expect(pushedTo('To ssh://git@bitbucket.org:7999/me/app.git\n   1a..2b  main -> main')).toBe('Bitbucket')
  expect(pushedTo('To https://git.example.org/me/app.git\n   1a..2b  main -> main')).toBe('git.example.org')
  expect(pushedTo('To /Users/me/backup.git\n   1a..2b  main -> main')).toBeNull()
  expect(pushedTo('To ../backup\n   1a..2b  main -> main')).toBeNull()
  expect(pushedTo('Everything up-to-date')).toBeNull()
})

test('nothing project-specific: a lock file or a skill name means nothing unless the run itself ends', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Skill', skill: 'push-pipeline' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('✓ Changes committed')
  await ui.unmount()
})

test('a setting changes behaviour: with "Suggest compacting at" set to 200k, nothing is suggested at 120k', { options: { suggest_compact_at_tokens: 200_000 } }, async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- background commands

/** A notification exactly as this session receives them when a background task ends. */
const notification = (id: string, status: string, toolUseId = 'toolu_x') =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/tmp/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command finished</summary>\n</task-notification>`

test('a background command is read from its tool result, and its end from its notification', () => {
  expect(backgroundTaskOf({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7' } })).toBe('b7')
  expect(backgroundTaskOf({ result: { stdout: 'x', stderr: '', interrupted: false } })).toBeNull()
  expect(endedTask(notification('b7', 'completed', 'toolu_9'))).toEqual({ id: 'b7', toolUseId: 'toolu_9', status: 'completed' })
  expect(endedTask('no tags here')).toEqual({ id: null, toolUseId: null, status: null })
})

test('while a background command runs nothing is suggested; when its notification says it ended, the moment is offered', async ($, on) => {
  world(on, {
    bash: { 'npm run test:all': { stdout: '', stderr: '', backgroundTaskId: 'bg1' } },
  })
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'npm run test:all', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()

  // another task's end changes nothing
  await $.prompt.submit({ text: notification('other', 'completed'), origin: { kind: 'task-notification' }, wait: false })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()

  await $.prompt.submit({ text: notification('bg1', 'failed'), origin: { kind: 'task-notification' }, wait: false })
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('✓ Changes committed')
  await ui.unmount()
})

test('a /compact typed while a background command runs gets a warning naming it', async ($, on) => {
  const w = world(on, { bash: { 'npm run build': { stdout: '', stderr: '', backgroundTaskId: 'bg2' } } })
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })
  await $.session.compact({ trigger: 'manual', messages: CONVERSATION })
  expect(w.toasts).toContain('Heads-up: 1 background command is still running. Compacting now can lose details it still needs.')
})

// ---------------------------------------------------------------- /context-bar handoff and status

test('/context-bar handoff starts the same flow as the button: written to a draft, saved, then /clear runs', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const r = await $.command.run(run('handoff'))
  expect(r.text).toBe('Asking Claude for a handoff. Then /clear runs.')
  await claudeWrites($, w, HANDOFF_BODY)
  expect(w.toasts.filter(t => /failed|Could not/.test(t))).toEqual([])
  expect(w.written.some(f => f.path === SAVED)).toBe(true)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

test('/context-bar status says what the flow sees: what runs, what waits, the last handoff, the settings', async ($, on) => {
  world(on, {
    bash: { 'npm run build': { stdout: '', stderr: '', backgroundTaskId: 'bg3' } },
    store: { 'handoff:proj': { path: '/home/me/.claude/handoffs/proj/20261006-170000-handoff.md', at: 0 } },
  })
  await $.session.start(START)
  await $.session.measure(MEASURE)
  expect((await $.command.run(run('status'))).text).toBe(
    [
      `context-bar ${VERSION}`,
      'Busy: nothing',
      'Suggestion shown: none',
      'Last handoff: /home/me/.claude/handoffs/proj/20261006-170000-handoff.md, 1 min ago',
      'Open tasks the next handoff carries: 0',
      'Settings: suggest at 80,000 tokens · long output 15,000 · long skill run 5 min · offer handoffs for 6 h',
      'Handoffs go to: .claude/knowledge/handoffs in the repository, committed',
      'Updates: none for a --plugin-dir checkout (git pull it)',
      'Drawn on: terminal',
    ].join('\n'),
  )
  await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const text = (await $.command.run(run('status'))).text ?? ''
  expect(text).toContain('Busy: 1 background command')
  expect(text).toContain('waiting to offer: saved (Add the export button)')
})

// ---------------------------------------------------------------- where the handoff goes

for (const [what, opts] of [
  ['git commit fails', { commitFails: 'COMMIT BLOCKED — branch-of-origin guard' }],
  ['git add fails', { addFails: "fatal: Unable to create '/proj/.git/index.lock': File exists." }],
] as const) {
  test(`regression (6 Oct): when ${what}, "handoff & compact" still compacts, and says the handoff is not committed`, async ($, on) => {
    const w = world(on, opts)
    await skillRunJustEnded($)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'compact-anytime' })
    await claudeWrites($, w, HANDOFF_BODY)
    expect(w.written.some(f => f.path === SAVED)).toBe(true)
    const reason = 'commitFails' in opts ? opts.commitFails : opts.addFails
    expect(await bandText(ui)).toContain(`${SAVED} (not committed: ${reason})`)
    await w.clock.settle()
    expect(w.compacts.length).toBe(1)
    await ui.unmount()
  })
}

test(
  'with "Commit handoffs" off, the handoff is saved in the folder set in /config, nothing is committed, and /clear runs',
  { options: { commit_handoffs: false, handoff_folder: 'docs/handoffs' } },
  async ($, on) => {
    const w = world(on)
    await skillRunJustEnded($)
    await $.command.run(run('handoff'))
    await claudeWrites($, w, HANDOFF_BODY)
    expect(w.written.some(f => f.path === '/proj/docs/handoffs/export-button-handoff.md')).toBe(true)
    expect(w.runs.some(a => a[0] === 'git' && a[1] === 'commit')).toBe(false)
    expect(w.toasts.some(t => completedOn('/proj/docs/handoffs/export-button-handoff.md').test(t))).toBe(true)
    await w.clock.settle()
    expect(w.commands).toEqual(['clear'])
  },
)

test('outside a git repository the handoff goes to ~/.claude/handoffs/<folder name>/, nothing is committed, and /clear runs', async ($, on) => {
  const w = world(on, { noGit: true })
  await skillRunJustEnded($)
  await $.command.run(run('handoff'))
  await claudeWrites($, w, HANDOFF_BODY)
  expect(w.written.some(f => f.path === '/home/me/.claude/handoffs/proj/export-button-handoff.md')).toBe(true)
  expect(w.runs.some(a => a[0] === 'git' && a[1] === 'commit')).toBe(false)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

// ---------------------------------------------------------------- the handoff's name

test('the handoff is named after the plan or the task, from its title; without one, the branch or "session"', () => {
  expect(handoffName('# Handoff — PROMPT_PIPELINE_LIVE_SUITE — 2026-10-06 19:50 UTC\n## Goal', 'x')).toBe('PROMPT_PIPELINE_LIVE_SUITE')
  expect(handoffName('# Handoff — context bar: compact suggestions — 2026-10-06 19:50 UTC', 'x')).toBe('context-bar-compact-suggestions')
  expect(handoffName('# Handoff - export-button - 2026-10-06 19:50 UTC', 'x')).toBe('export-button')
  expect(handoffName('## Goal\nno title', 'feature-login')).toBe('feature-login')
  expect(handoffName('# Handoff — ../../etc — 2026-10-06 19:50 UTC', 'x')).toBe('etc')
  expect(fallbackHandoffName('feature/login-page')).toBe('feature-login-page')
  expect(fallbackHandoffName('dev')).toBe('session')
  expect(fallbackHandoffName(null)).toBe('session')
  expect(namedHandoffPath('/r/.claude/knowledge/handoffs', 'export-button')).toBe('/r/.claude/knowledge/handoffs/export-button-handoff.md')
  expect(datedHandoffPath('/r/h', 'export-button', Date.UTC(2026, 9, 6, 19, 50, 1))).toBe('/r/h/export-button-handoff-20261006-1950.md')
})

for (const [state, expected] of [
  ['clean', '/proj/.claude/knowledge/handoffs/export-button-handoff.md'],
  ['changed', '/proj/.claude/knowledge/handoffs/export-button-handoff-19700101-0000.md'],
  ['untracked', '/proj/.claude/knowledge/handoffs/export-button-handoff-19700101-0000.md'],
] as const) {
  test(`an existing handoff for the same work that is ${state}: ${state === 'clean' ? 'updated in place (git keeps the old one)' : 'left alone, a dated file is written'}`, async ($, on) => {
    const w = world(on, { existingHandoff: state })
    await $.session.start(START)
    await $.session.measure(MEASURE)
    await $.command.run(run('handoff'))
    await claudeWrites($, w, HANDOFF_BODY)
    expect(w.written.find(f => f.path.includes('-handoff') && !f.path.includes('draft'))?.path).toBe(expected)
  })
}

// ---------------------------------------------------------------- always there

test('the top line always has "handoff & compact": dim when it is not the time, lit when the bar suggests it', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const button = async () => ui.find({ key: 'compact-anytime' }) as Promise<{ text?: string; props?: Record<string, unknown> } | undefined>
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  expect((await button())?.text).toBe('handoff & compact')
  expect((await button())?.props?.dimColor).toBeUndefined()
  expect(await marked(ui, 'compact-anytime-box')).toBe(false)

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  expect(await marked(ui, 'compact-anytime-box')).toBe(true)

  await ui.press({ key: 'compact-anytime' })
  await w.clock.settle()
  expect(w.submitted[0] ?? '').toContain('Do NOT print the handoff in your reply')
  await ui.unmount()
})

test('a suggestion stays through the person\'s next messages; it goes when acted on or when a compaction happens', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.prompt.submit({ text: 'make the buttons unbold', origin: { kind: 'composer' }, wait: false })
  await $.prompt.submit({ text: '<task-notification><task-id>x</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' }, wait: false })
  await w.clock.advance(25 * 60_000)
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toBe('✓ Changes committed')
  expect(await marked(ui, 'compact-anytime-box')).toBe(true)

  // any compaction (here Claude Code's own) shrinks the context: the suggestion has done its job
  await $.session.compact({ trigger: 'auto', messages: CONVERSATION })
  expect(await ui.find({ key: 'compact-text' })).toBeUndefined()
  expect(await marked(ui, 'compact-anytime-box')).toBe(false)
  await ui.unmount()
})

test('the buttons look like the categories: a ■ in their own colour, plain label, no brackets, | between', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  type El = { text?: string; props?: { plain?: boolean; dimColor?: boolean } } | undefined
  for (const [box, button, label] of [
    ['compact-anytime-box', 'compact-anytime', 'handoff & compact'],
    ['clear-anytime-box', 'clear-anytime', 'handoff & clear'],
    ['recalculate-box', 'recalculate', 'recalculate'],
  ] as const) {
    const el = (await ui.find({ key: button })) as El
    expect(el?.props?.plain).toBe(true)
    expect(el?.props?.dimColor).toBeUndefined()
    expect(el?.text).toBe(label)
    expect((await ui.find({ key: box }))?.text).toBe(`${SQUARE}${label}`)
  }
  // each ■ in its button's own colour, three different ones
  const squares = ((await ui.findAll({ type: 'Text' })) as { text?: string; props?: { color?: string } }[]).filter(t => t.text === SQUARE)
  expect(squares.map(t => t.props?.color).sort()).toEqual([BUTTON_COLOR.clear, BUTTON_COLOR.compact, BUTTON_COLOR.recalculate].sort())
  // a | between the two handoff buttons
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toContain('|')
  // recalculate sits in the limits line, at its right end, not in the header
  expect((await ui.find({ key: 'limits' }))?.text ?? '').toMatch(/■ recalculate$/)
  // a suggestion turns the button's ■ into ▣; the band text is not bold
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  expect(await marked(ui, 'compact-anytime-box')).toBe(true)
  // the suggestion is yellow text like the rest of the line: no background, not bold
  const band = (await ui.findAll({ type: 'Text' })) as { text?: string; props?: { bold?: boolean; color?: string; backgroundColor?: string } }[]
  const tip = band.find(t => t.text?.includes('Changes committed'))
  expect(tip?.props?.bold).toBeFalsy()
  expect(tip?.props?.color).toBe(MESSAGE_FG)
  expect(tip?.props?.backgroundColor).toBeUndefined()
  await ui.unmount()
})

// Claude Code's theme keys: each surface resolves them in the person's theme (light, dark, colour-blind, ANSI)
const THEME_KEYS = new Set([
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged',
  'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide',
])

test('every category colour keeps 3 : 1 on a light, a dark and a black background', () => {
  // WCAG relative luminance and contrast ratio
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  }
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
  }
  for (const colour of Object.values(PALETTE)) {
    for (const background of ['#FFFFFF', '#1E1E1E', '#000000']) expect(ratio(colour, background)).toBeGreaterThanOrEqual(3)
  }
  // eight hues, none repeated
  expect(new Set(Object.values(PALETTE)).size).toBe(Object.keys(PALETTE).length)
})

test('every other colour is a theme key, so it follows a light or a dark theme', () => {
  const others = [...Object.values(BUTTON_COLOR), MESSAGE_FG, ...Object.values(LIMIT_COLORS), FREE, MARKER, ACCENT, BORDER, MUTED, GOOD, WARN, BAD]
  for (const colour of others) expect(THEME_KEYS.has(colour)).toBe(true)
})

test('the band draws no colour tuned for one background, on any surface', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  const categories = new Set<string>(Object.values(PALETTE))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // the plugin's own tree, and the strip its surface module draws (the Client keyed `bar`)
    const drawn = [...(await ui.findAll({})), ...(await ui.findAll({ in: 'bar' }))]
    const colours = drawn
      .flatMap(n => {
        const p = n.props as { color?: unknown; backgroundColor?: unknown; borderColor?: unknown; hover?: { color?: unknown } }
        return [p.color, p.backgroundColor, p.borderColor, p.hover?.color]
      })
      .filter((c): c is string => typeof c === 'string')
    expect(colours.length).toBeGreaterThan(0)
    for (const colour of colours) expect(THEME_KEYS.has(colour) || categories.has(colour)).toBe(true)
    await ui.unmount()
  }
})

test('a suggested button is marked, so it stands out whatever the colours or theme', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'compact-anytime' }))?.text).toBe('handoff & compact')
  expect(await marked(ui, 'compact-anytime-box')).toBe(false)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
  expect((await ui.find({ key: 'compact-anytime-box' }))?.text).toBe(`${SUGGESTED_SQUARE}handoff & compact`)
  expect(await marked(ui, 'clear-anytime-box')).toBe(false)
  await ui.unmount()
})

// ---------------------------------------------------------------- never again (6 Oct)

test('a draft an earlier run left behind is removed when the next handoff starts, so the folder never keeps one', async ($, on) => {
  const w = world(on)
  w.listing = ['.handoff-draft-20261006-170000.md', 'export-button-handoff.md']
  await skillRunJustEnded($)
  await $.command.run(run('handoff'))
  expect(w.removed).toContain('/proj/.claude/knowledge/handoffs/.handoff-draft-20261006-170000.md')
  expect(w.removed).not.toContain('/proj/.claude/knowledge/handoffs/export-button-handoff.md')
})

test('/context-bar status says how the last handoff ended: committed, or why not', async ($, on) => {
  const w = world(on, { commitFails: 'COMMIT BLOCKED — branch-of-origin guard' })
  await skillRunJustEnded($)
  await $.command.run(run('handoff'))
  await claudeWrites($, w, HANDOFF_BODY)
  const text = (await $.command.run(run('status'))).text ?? ''
  expect(text).toContain(`Last handoff: ${SAVED}, `)
  expect(text).toContain('· not committed: COMMIT BLOCKED — branch-of-origin guard')
})

// The engine refuses a tree it cannot draw and then draws NOTHING of the bar (seen 6 Oct with an unkeyed hover).
// So every state the compaction line can be in is drawn here, on both surfaces, and must come out whole.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the bar draws whole in every state of the compaction line, on ${surface}`, async ($, on) => {
    const w = world(on, { store: { 'handoff:proj': { path: '/home/me/.claude/handoffs/proj/x-handoff.md', at: 0 } } })
    await $.session.start(START)
    await $.session.measure(MEASURE)
    const ui = await $.ui.mount({ ...BAND, surface })
    const whole = async (state: string) => {
      expect(`${state}: ${(await ui.find({ key: 'compact-anytime' }))?.text}`).toBe(`${state}: handoff & compact`)
      expect(`${state}: ${(await ui.find({ key: 'recalculate' }))?.text}`).toBe(`${state}: recalculate`)
    }
    await whole('idle')
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "Add the export button"' })
    await whole('suggested')
    await ui.press({ key: 'compact-anytime' })
    await w.clock.settle()
    await whole('writing the handoff')
    w.draft.text = HANDOFF_BODY
    await $.turn.complete(handoffTurn('Handoff written.'))
    await whole('handoff saved, compaction starting (two lines)')
    await w.clock.settle()
    await whole('compaction result')
    await $.classic.SessionStart({ source: 'clear' })
    await $.prompt.submit({ text: 'next', origin: { kind: 'composer' }, wait: false })
    await whole('after the person moved on')
    await ui.unmount()
  })
}

// ---------------------------------------------------------------- open tasks, carried across a handoff

const STATE = { folder: '/proj', branch: 'dev', head: { sha: 'abc1234', subject: 'Add X' }, changed: [], busy: IDLE }
const task = (id: string, subject: string, status: TrackedTask['status'] = 'pending', blockedBy: string[] = []): TrackedTask => ({
  id,
  subject,
  description: `About: ${subject}`,
  activeForm: null,
  status,
  blockedBy,
})

test('the bar keeps the task list exactly as Claude makes and changes it', () => {
  let tasks: TrackedTask[] = []
  const created = (id: string, subject: string) => ({ task: { id, subject } })
  tasks = nextTasks(tasks, 'TaskCreate', { subject: 'Write the import parser', description: 'CSV in, rows out', activeForm: 'Writing the parser' }, created('1', 'Write the import parser'))
  tasks = nextTasks(tasks, 'TaskCreate', { subject: 'Add the import page', description: 'Upload and preview' }, created('2', 'Add the import page'))
  tasks = nextTasks(tasks, 'TaskCreate', { subject: 'Ship the import', description: 'Push, then release' }, created('3', 'Ship the import'))
  tasks = nextTasks(tasks, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true, taskId: '1', updatedFields: ['status'] })
  tasks = nextTasks(tasks, 'TaskUpdate', { taskId: '2', addBlocks: ['3'] }, { success: true, taskId: '2', updatedFields: ['blocks'] })
  expect(tasks[0]).toEqual({ id: '1', subject: 'Write the import parser', description: 'CSV in, rows out', activeForm: 'Writing the parser', status: 'in_progress', blockedBy: [] })
  expect(tasks.map(t => [t.id, t.status, t.blockedBy])).toEqual([
    ['1', 'in_progress', []],
    ['2', 'pending', []],
    ['3', 'pending', ['2']],
  ])
  // a refused create, a failed update, an id the bar never saw, and any other tool change nothing
  expect(nextTasks(tasks, 'TaskCreate', { subject: 'x', description: 'y' }, undefined)).toEqual(tasks)
  expect(nextTasks(tasks, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false, taskId: '1', updatedFields: [] })).toEqual(tasks)
  expect(nextTasks(tasks, 'TaskUpdate', { taskId: '99', status: 'completed' }, { success: true })).toEqual(tasks)
  expect(nextTasks(tasks, 'Bash', { command: 'ls' }, {})).toEqual(tasks)
  // a done task leaves the open list; a deleted one is gone and stops blocking
  expect(openTasks(nextTasks(tasks, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })).map(t => t.id)).toEqual(['2', '3'])
  expect(nextTasks(tasks, 'TaskUpdate', { taskId: '2', status: 'deleted' }, { success: true }).map(t => [t.id, t.blockedBy])).toEqual([
    ['1', []],
    ['3', []],
  ])
  // TodoWrite replaces the whole list
  const todos = [
    { content: 'Fix the failing test', status: 'in_progress', activeForm: 'Fixing the failing test' },
    { content: 'Commit', status: 'pending', activeForm: 'Committing' },
  ]
  expect(nextTasks(tasks, 'TodoWrite', { todos }, {}).map(t => [t.id, t.subject, t.status, t.activeForm])).toEqual([
    ['todo-1', 'Fix the failing test', 'in_progress', 'Fixing the failing test'],
    ['todo-2', 'Commit', 'pending', 'Committing'],
  ])
})

test('the handoff request names every open task; the saved file holds them exactly, to recreate on resume', () => {
  const open = [task('1', 'Write the import parser', 'in_progress'), task('2', 'Add the import page'), task('3', 'Ship the import', 'pending', ['2'])]
  const req = handoffRequest({ project: 'app', at: 0, state: STATE, draft: '/d.md', tasks: open })
  expect(req).toContain('## Open tasks (required): the task list holds 3 open tasks, listed below. Write one "### <n>. <subject>" for each')
  expect(req).toContain('   1. [in_progress] Write the import parser — About: Write the import parser')
  expect(req).toContain('   3. [pending] Ship the import — About: Ship the import (blocked by 2)')
  // right after Next steps
  expect(req.indexOf('## Open tasks')).toBeGreaterThan(req.indexOf('## Next steps'))
  expect(req.indexOf('## Open tasks')).toBeLessThan(req.indexOf('## How to verify'))
  // no open tasks: no such section, and nothing to check
  expect(handoffRequest({ project: 'app', at: 0, state: STATE, draft: '/d.md', tasks: [] })).not.toContain('## Open tasks')
  expect(missingTasks(HANDOFF_BODY, [])).toEqual([])

  // each open task must be named in "Open tasks", by its exact subject
  const twoOfThree = `${HANDOFF_BODY}\n## Open tasks\n### 1. Write the import parser\nStatus: in_progress\nContext: parser.ts half done\n### 2. Add the import page\nStatus: pending\nContext: not started`
  expect(missingTasks(twoOfThree, open)).toEqual(['Ship the import'])
  expect(missingTasks(HANDOFF_BODY, open)).toEqual(['Write the import parser', 'Add the import page', 'Ship the import'])
  // a subject named outside the section does not count
  expect(missingTasks(`${twoOfThree}\n## How to resume\nShip the import later`, open)).toEqual(['Ship the import'])

  // the saved file: the exact list, written by the bar, dependencies by number
  const file = handoffFile({ body: twoOfThree, at: 0, state: STATE, path: '/p/x-handoff.md', tasks: open })
  expect(file).toContain('## Task list to recreate on resume')
  expect(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(file)?.[1] ?? 'null')).toEqual([
    { n: 1, subject: 'Write the import parser', description: 'About: Write the import parser', activeForm: null, status: 'in_progress', blockedBy: [] },
    { n: 2, subject: 'Add the import page', description: 'About: Add the import page', activeForm: null, status: 'pending', blockedBy: [] },
    { n: 3, subject: 'Ship the import', description: 'About: Ship the import', activeForm: null, status: 'pending', blockedBy: [2] },
  ])
  expect(file).toContain('**Read /p/x-handoff.md, recreate its open tasks, and follow its "How to resume".**')
  expect(handoffFile({ body: HANDOFF_BODY, at: 0, state: STATE, path: '/p/x-handoff.md' })).not.toContain('Task list to recreate')
  // a compaction's handoff carries them too
  expect(handoffMarkdown({ project: 'app', at: 0, state: STATE, summary: 'S', previous: null, tasks: open })).toContain('## Task list to recreate on resume')
  // and the resume request asks for them first
  expect(resumePrompt('/p/x-handoff.md')).toContain('If it has a "Task list to recreate on resume" section, first recreate those tasks exactly as it says. Then')
})

/** Four tasks as Claude makes them: one done, one under way, two waiting, the last blocked by the one before it. */
async function makeTasks($: Parameters<TestBody>[0]) {
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write the export tests', description: 'Done earlier' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write the import parser', description: 'CSV in, rows out', activeForm: 'Writing the import parser' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Add the import page', description: 'Upload and preview' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Ship the import', description: 'Push, then release' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '4', addBlockedBy: ['3'] })
}

const OPEN_TASKS_BODY = [
  HANDOFF_BODY,
  '## Open tasks',
  '### 1. Write the import parser',
  'Status: in_progress',
  'Context: src/import/parser.ts reads the header; rows next. Run `npm test -- parser`.',
  '### 2. Add the import page',
  'Status: pending',
  'Context: not started; the route is /import.',
  '### 3. Ship the import',
  'Status: pending',
  'Context: after the page; #push then #release.',
].join('\n')

test('"handoff & clear" with open tasks: each one is in the handoff, saved exactly, and the next session recreates them', async ($, on) => {
  const w = world(on)
  await skillRunJustEnded($)
  await makeTasks($)
  expect((await $.command.run(run('status'))).text).toContain('Open tasks the next handoff carries: 3')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clear-anytime' })
  await w.clock.settle()

  // 1: the request names the three open tasks, the done one left out
  const req = w.submitted[0] ?? ''
  expect(req).toContain('the task list holds 3 open tasks')
  expect(req).toContain('   1. [in_progress] Write the import parser — CSV in, rows out')
  expect(req).toContain('   3. [pending] Ship the import — Push, then release (blocked by 2)')
  expect(req).not.toContain('Write the export tests')

  // 2: Claude names every task: saved with the exact list, committed, then /clear runs
  await claudeWrites($, w, OPEN_TASKS_BODY)
  const saved = w.written.find(f => f.path === SAVED)?.text ?? ''
  expect(saved).toContain('## Open tasks\n### 1. Write the import parser')
  const list = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(saved)?.[1] ?? 'null') as { subject: string; status: string; blockedBy: number[]; activeForm: string | null }[]
  expect(list.map(t => [t.subject, t.status, t.blockedBy])).toEqual([
    ['Write the import parser', 'in_progress', []],
    ['Add the import page', 'pending', []],
    ['Ship the import', 'pending', [2]],
  ])
  expect(list[0]?.activeForm).toBe('Writing the import parser')
  expect(await bandText(ui)).toMatch(completedOn(SAVED))
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])

  // 3: the new conversation starts with an empty task list, and so does the bar's copy
  await $.classic.SessionStart({ source: 'clear' })
  expect((await $.command.run(run('status'))).text).toContain('Open tasks the next handoff carries: 0')
  await ui.unmount()
})

test('a handoff that leaves out an open task is flagged, and nothing is cleared', async ($, on) => {
  const w = world(on)
  await skillRunJustEnded($)
  await makeTasks($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clear-anytime' })
  await claudeWrites($, w, OPEN_TASKS_BODY.replace('### 3. Ship the import', '### 3. Release it'))
  expect(await bandText(ui)).toMatch(new RegExp(`^Handoff failed on .*: ${esc(SAVED)} is missing open task "Ship the import"\\. Nothing was cleared\\.$`))
  await w.clock.settle()
  expect(w.commands).toEqual([])
  await ui.unmount()
})

test('tasks a subagent makes are its own: they are not carried into the handoff', async ($, on) => {
  world(on)
  await skillRunJustEnded($)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Subagent step', description: 'its own', agentId: 'helper-1' } as never)
  expect((await $.command.run(run('status'))).text).toContain('Open tasks the next handoff carries: 0')
  await $.tool.call({ tool: 'TaskCreate', subject: 'Main step', description: 'the person\'s' })
  expect((await $.command.run(run('status'))).text).toContain('Open tasks the next handoff carries: 1')
})

test('after "handoff & clear" the new conversation shows the result AND the Continue offer for that handoff', async ($, on) => {
  const w = world(on)
  await skillRunJustEnded($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'clear-anytime' })
  await claudeWrites($, w, HANDOFF_BODY)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
  // /clear starts a new conversation: Claude Code raises SessionStart for it
  await $.classic.SessionStart({ source: 'clear' })
  const lines = await bandLines(ui)
  expect(lines[0]).toMatch(/^Clear completed on /)
  expect(lines[1]).toBe(`Handoff: ${SAVED}`)
  // the offer to continue from that handoff is there too, with its button
  expect((await ui.find({ key: 'compact-text' }))?.text?.trim()).toMatch(/^↺ A handoff from your last session was saved .* — continue from it\?$/)
  await ui.press({ key: 'compact-resume' })
  expect(w.filled[0] ?? '').toBe(resumePrompt(SAVED))
  await ui.unmount()
})
