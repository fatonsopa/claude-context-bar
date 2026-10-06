// Compaction helpers: when the bar suggests /compact, what every compaction must
// keep, the note on where things stood that is put back afterwards, and the handoff file a later session can read.
// Pure functions only; ./register.tsx wires them to the engine.

import type { SessionMessage } from 'claude-code'
import type { Snapshot, CompactTip } from '../types'
import { catOf, shortPath } from './categories'

/** No new suggestion this soon after a compaction. */
export const QUIET_AFTER_COMPACT_MS = 10 * 60_000
/** The long-output tip at most this often. */
export const QUIET_LARGE_OUTPUT_MS = 15 * 60_000
/** Tools whose long answers are the cure, not the problem. */
const NO_LARGE_TIP: readonly string[] = ['Agent', 'Task']

// ---------------------------------------------------------------- the person's settings

/**
 * The bar's preferences, set in /config (the plugin's `userConfig`, see .claude-plugin/plugin.json). They are the
 * person's, not any project's: nothing here names a project, a file or a workflow.
 */
export type BarSettings = {
  /** Suggest compacting only when the conversation itself takes at least this many tokens. */
  suggestCompactAtTokens: number
  /** One tool result at least this big earns the "use a subagent for long output" tip. */
  longOutputTokens: number
  /** A skill run (a turn that used a skill) at least this long is a finished piece of work. */
  longSkillRunMinutes: number
  /** A handoff older than this is not offered to a new session. */
  offerHandoffHours: number
  /** Where "handoff & clear" / "handoff & compact" saves the handoff, relative to the repository root. */
  handoffFolder: string
  /** Commit that one file right after saving it, so an untracked file never blocks a push that wants a clean tree. */
  commitHandoffs: boolean
}

export const DEFAULT_SETTINGS: BarSettings = {
  suggestCompactAtTokens: 80_000,
  longOutputTokens: 15_000,
  longSkillRunMinutes: 5,
  offerHandoffHours: 6,
  handoffFolder: '.claude/knowledge/handoffs',
  commitHandoffs: true,
}

/** The manifest's `userConfig` keys for each setting. */
export const SETTING_KEYS: Readonly<Record<keyof BarSettings, string>> = {
  suggestCompactAtTokens: 'suggest_compact_at_tokens',
  longOutputTokens: 'long_output_tokens',
  longSkillRunMinutes: 'long_skill_run_minutes',
  offerHandoffHours: 'offer_handoff_hours',
  handoffFolder: 'handoff_folder',
  commitHandoffs: 'commit_handoffs',
}

const NUMBER_SETTINGS = ['suggestCompactAtTokens', 'longOutputTokens', 'longSkillRunMinutes', 'offerHandoffHours'] as const

/** A folder inside the repository: relative, no `..`, no leading slash. */
export function isRepoFolder(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && !v.startsWith('/') && !v.split('/').includes('..')
}

/** The settings from the plugin's options; anything missing or invalid keeps its default. */
export function settingsFrom(options: Readonly<Record<string, unknown>>): BarSettings {
  const out: BarSettings = { ...DEFAULT_SETTINGS }
  for (const key of NUMBER_SETTINGS) {
    const v = options[SETTING_KEYS[key]]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v
  }
  const folder = options[SETTING_KEYS.handoffFolder]
  if (isRepoFolder(folder)) out.handoffFolder = folder.trim().replace(/\/+$/, '')
  const commit = options[SETTING_KEYS.commitHandoffs]
  if (typeof commit === 'boolean') out.commitHandoffs = commit
  return out
}

/** How much of the window the conversation itself takes: the part a compaction can shrink. */
export function conversationTokens(snap: Snapshot | null): number {
  if (!snap) return 0
  return snap.rows.filter(r => r.kind === 'used' && catOf(r.name) === 'messages').reduce((sum, r) => sum + r.tokens, 0)
}

/** "34%": how full the context is, as the bar's badge shows it. */
export function fullness(snap: Snapshot | null): string {
  return snap ? `${Math.round(snap.percent)}%` : '?'
}

// ---------------------------------------------------------------- reading what a command did

const COMMIT_LINE = /^\[([^\]\s]+)(?: \([^)]*\))? ([0-9a-f]{7,40})\] (.+)$/m

/** A `git commit` that succeeded prints `[branch sha] subject`; anything else (a dry run, a failure) is not one. */
export function committed(command: string, output: string): { sha: string; subject: string } | null {
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(command) || /--dry-run\b/.test(command)) return null
  const m = COMMIT_LINE.exec(output)
  const sha = m?.[2]
  const subject = m?.[3]
  return sha && subject ? { sha, subject: subject.trim() } : null
}

const PUSHED_REF = /^\s*(?:[+*]|\S+\.\.\.?\S+)\s.*?(\S+) -> (\S+)/m

/** A `git push` that sent something prints a `<from> -> <to>` line; "Everything up-to-date" or a failure is not one. */
export function pushed(command: string, output: string): string | null {
  if (!/\bgit\b[\s\S]*\bpush\b/.test(command) || /--dry-run\b|\s-n\b/.test(command)) return null
  const m = PUSHED_REF.exec(output)
  return m?.[1] && m[2] ? `${m[1]} -> ${m[2]}` : null
}

const TEST_RUN =
  /\b(vitest|jest|playwright\s+test|pytest|deno\s+test|bun\s+test|go\s+test|cargo\s+test|plugin\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?test[\w:-]*)\b/

export function isTestRun(command: string): boolean {
  return TEST_RUN.test(command)
}

/** A test run failed when the command errored or its report counts at least one failure. */
export function testsFailed(isError: boolean, output: string): boolean {
  return isError || /\b[1-9]\d* (?:failed|failing|fail)\b/i.test(output)
}

/** Tool results this big are worth the tip, from anything but a helper's report. */
export function isLargeOutput(tool: string, tokens: number, atTokens: number): boolean {
  return tokens >= atTokens && !NO_LARGE_TIP.includes(tool)
}

// ---------------------------------------------------------------- when to suggest

/** What is under way right now that a compaction could lose details of. */
export type Busy = {
  /** Subagents of this session that have not finished (pending, running or waiting), as the engine lists them. */
  subagents: number
  /** Background commands this session started whose end has not been reported yet. */
  shells: number
  merging: boolean
  testsFailing: boolean
}

export const IDLE: Busy = { subagents: 0, shells: 0, merging: false, testsFailing: false }

/** A command that went to the background: its tool result names the task (`backgroundTaskId`). */
export function backgroundTaskOf(r: unknown): string | null {
  const result = (r as { result?: unknown } | null)?.result as { backgroundTaskId?: unknown } | null | undefined
  return result && typeof result.backgroundTaskId === 'string' && result.backgroundTaskId ? result.backgroundTaskId : null
}

/**
 * A background task's end, as its notification names it: the task's id, the call that started it and how it ended
 * (`completed`, `failed`, `killed`). The engine reads the same three from the same notification (UserMessageTask).
 */
export function endedTask(text: string): { id: string | null; toolUseId: string | null; status: string | null } {
  const tag = (name: string) => new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`).exec(text)?.[1] ?? null
  return { id: tag('task-id'), toolUseId: tag('tool-use-id'), status: tag('status') }
}

/** Why now is a bad moment, in plain words; null when it is fine. */
export function busyReason(b: Busy): string | null {
  if (b.subagents > 0) return `${b.subagents} subagent${b.subagents === 1 ? ' is' : 's are'} still running`
  if (b.shells > 0) return `${b.shells} background command${b.shells === 1 ? ' is' : 's are'} still running`
  if (b.merging) return 'a git merge or rebase is in progress'
  if (b.testsFailing) return 'tests are still failing'
  return null
}

/** Whether a finished step is worth a suggestion: nothing under way, a real amount to free, no compaction just now. */
export function shouldSuggest(a: {
  snap: Snapshot | null
  busy: Busy
  lastCompactAt: number | null
  now: number
  minConversation: number
}): boolean {
  if (busyReason(a.busy)) return false
  if (a.lastCompactAt !== null && a.now - a.lastCompactAt < QUIET_AFTER_COMPACT_MS) return false
  return conversationTokens(a.snap) >= a.minConversation
}

// ---------------------------------------------------------------- what the bar says

function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

/** The suggestion's first line, in the words Claude Code itself uses: compact, context, clear, handoff. */
export function tipText(tip: CompactTip, snap: Snapshot | null, now: number): string {
  const text = tipWords(tip, snap, now)
  // a suggestion stays until it is acted on, so it says how old it is once a minute has passed
  return tip.reason !== 'resume' && now - tip.at >= 60_000 ? `${text} · ${ago(now - tip.at)}` : text
}

function tipWords(tip: CompactTip, snap: Snapshot | null, now: number): string {
  switch (tip.reason) {
    case 'saved':
      return `✓ Changes committed — good moment for handoff & compact · context ${fullness(snap)} full`
    case 'pushed':
      return `✓ Pushed${tip.what ? ` (${tip.what})` : ''} — handoff & compact to keep going, or handoff & clear for an unrelated next task · context ${fullness(snap)} full`
    case 'finished':
      return `✓ ${tip.what ? `/${tip.what}` : 'The skill run'} finished — handoff & compact to keep going, or handoff & clear for an unrelated next task · context ${fullness(snap)} full`
    case 'resume':
      return `↺ A handoff from your last session was saved ${ago(now - tip.at)} — continue from it?`
  }
}

/** A finished push or skill run is a hard end: the bar offers a handoff there, not after every commit. */
export function offersHandoff(tip: CompactTip): boolean {
  return tip.reason === 'pushed' || tip.reason === 'finished'
}


export const RUNNING_TEXT = { compact: 'Compacting… this can take a minute.', handoff: 'Writing the handoff…' } as const



/** The toast when a compaction ends. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "October 6, 10:41:47pm", in the person's local time. */
export function when(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12 || 12
  const two = (n: number) => String(n).padStart(2, '0')
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${h}:${two(d.getMinutes())}:${two(d.getSeconds())}${d.getHours() < 12 ? 'am' : 'pm'}`
}

/** The line naming the handoff a compaction or a clear left; the bar draws its path as a link to the file. */
function handoffNote(path: string | null | undefined): string {
  return path ? `\nHandoff: ${path}` : ''
}

/** What a finished compaction reports, and the handoff it left. */
export function doneText(a: { before?: number; after?: number; max: number; at: number; auto: boolean; handoff?: string | null }): string {
  const pctOf = (n: number) => `${Math.round((n / Math.max(1, a.max)) * 100)}%`
  const change = a.before !== undefined && a.after !== undefined ? `: context went from ${pctOf(a.before)} to ${pctOf(a.after)}` : ''
  return `${a.auto ? 'Auto-compact' : 'Compact'} completed on ${when(a.at)}${change}.${handoffNote(a.handoff)}`
}

/** A saved handoff, its full path, and a commit problem if there was one. */
export function handoffLine(a: { at: number; path: string; commit: string | null }): string {
  const note = a.commit && a.commit !== 'committed' ? ` (${a.commit})` : ''
  return `Handoff completed on ${when(a.at)}: ${a.path}${note}`
}

/** The saved handoff, then what the button starts next. */
export function handoffDoneText(a: { at: number; path: string; then: 'clear' | 'compact'; commit: string | null }): string {
  return `${handoffLine(a)}\nNow starting ${a.then}...`
}

/** The saved handoff, and the compaction that follows it on a line of its own. */
export function compactingText(handoffLine?: string): string {
  return handoffLine ? `${handoffLine}\n${RUNNING_TEXT.compact}` : RUNNING_TEXT.compact
}

/** A file path as a `file://` URL, each part percent-encoded (a space, `#` or `?` in a folder name stays part of the path). */
export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/** A handoff that did not complete, and that nothing was compacted or cleared because of it. */
export function handoffFailedText(a: { at: number; reason: string; then: 'clear' | 'compact' }): string {
  return `Handoff failed on ${when(a.at)}: ${a.reason}. Nothing was ${a.then === 'compact' ? 'compacted' : 'cleared'}.`
}

export function clearDoneText(at: number, handoff?: string | null): string {
  return `Clear completed on ${when(at)}.${handoffNote(handoff)}`
}

/** The toast when someone tidies up while something is under way. */
export function busyWarning(reason: string): string {
  return `Heads-up: ${reason}. Compacting now can lose details it still needs.`
}

export function largeOutputText(tokens: number, snap: Snapshot | null): string {
  const share = snap ? Math.max(1, Math.round((tokens / Math.max(1, snap.max)) * 100)) : null
  const size = share !== null ? ` (about ${share}% of the context)` : ''
  return `That step returned a lot of text${size}. Tip: for long logs or big files, ask Claude to use a subagent that reads them and reports back.`
}



/** The commit message for one saved handoff. */
export function handoffCommitMessage(project: string, at: number): string {
  return `Handoff for the next session (${project}, ${new Date(at).toISOString().replace('T', ' ').slice(0, 16)} UTC)`
}

/** Branch names that say nothing about the work, so they never name a handoff. */
const TRUNK_BRANCHES: readonly string[] = ['main', 'master', 'dev', 'develop', 'development', 'staging', 'production', 'trunk']

/** A name safe as a file name: letters, digits, `_`, `.`, `-`; anything else becomes `-`; at most 80 characters. */
export function fileSafeName(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80)
    .replace(/[-._]+$/g, '')
}

/** The name when Claude gave none: the branch, unless it is a trunk branch; otherwise "session". */
export function fallbackHandoffName(branch: string | null): string {
  const name = branch && !TRUNK_BRANCHES.includes(branch) ? fileSafeName(branch) : ''
  return name || 'session'
}

/**
 * The handoff's name, from its title line "# Handoff — <name> — <date> UTC": the plan being implemented or a short
 * name for the task, as Claude wrote it. The file is named after it.
 */
export function handoffName(body: string, fallback: string): string {
  const m = /^#\s+Handoff\s*[—–-]\s*(.+?)\s*[—–-]\s*\d{4}-\d{2}-\d{2}\b/m.exec(body)
  const name = m?.[1] ? fileSafeName(m[1]) : ''
  return name && name.toLowerCase() !== 'handoff' ? name : fallback
}

/** `<dir>/<name>-handoff.md`: the same work's next handoff updates the same file, and git keeps the earlier ones. */
export function namedHandoffPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}-handoff.md`
}

/** The draft Claude writes the handoff to: hidden, and removed by the bar once it is saved under its name. */
export function draftHandoffPath(dir: string, ms: number): string {
  return `${dir.replace(/\/+$/, '')}/.handoff-draft-${stamp(ms)}.md`
}

export function isDraftName(name: string): boolean {
  return /^\.handoff-draft-\d{8}-\d{6}\.md$/.test(name)
}

/** `<dir>/<name>-handoff-<YYYYMMDD-HHMM>.md`: used instead when the named file may not be overwritten. */
export function datedHandoffPath(dir: string, name: string, ms: number): string {
  return `${dir.replace(/\/+$/, '')}/${name}-handoff-${stamp(ms).slice(0, 13)}.md`
}


/** What `/context-bar status` prints: what the compaction flow sees right now. */
export function statusText(a: {
  busy: Busy
  turnRunning: boolean
  tip: CompactTip | null
  waiting: string | null
  settings: BarSettings
  lastHandoff: { path: string; at: number } | null
  /** The last handoff run: where it went and how it ended (committed, or why not). */
  lastRun: { path: string | null; at: number; outcome: string } | null
  now: number
  version: string
}): string {
  const running = [
    a.turnRunning ? 'a turn' : null,
    a.busy.subagents ? `${a.busy.subagents} subagent${a.busy.subagents === 1 ? '' : 's'}` : null,
    a.busy.shells ? `${a.busy.shells} background command${a.busy.shells === 1 ? '' : 's'}` : null,
    a.busy.merging ? 'a git merge or rebase' : null,
    a.busy.testsFailing ? 'failing tests (last run)' : null,
  ].filter(Boolean)
  const tip = a.tip ? `${a.tip.reason}${a.tip.what ? ` (${a.tip.what})` : ''}` : 'none'
  const run = a.lastRun ?? (a.lastHandoff ? { ...a.lastHandoff, outcome: '' } : null)
  const handoff = run ? `${run.path ?? 'not saved'}, ${ago(a.now - run.at)}${run.outcome ? ` · ${run.outcome}` : ''}` : 'none yet'
  return [
    `context-bar ${a.version}`,
    `Busy: ${running.length ? running.join(', ') : 'nothing'}`,
    `Suggestion shown: ${tip}${a.waiting ? ` · waiting to offer: ${a.waiting}` : ''}`,
    `Last handoff: ${handoff}`,
    `Settings: suggest at ${a.settings.suggestCompactAtTokens.toLocaleString('en-US')} tokens · long output ${a.settings.longOutputTokens.toLocaleString('en-US')} · long skill run ${a.settings.longSkillRunMinutes} min · offer handoffs for ${a.settings.offerHandoffHours} h`,
    `Handoffs go to: ${a.settings.handoffFolder} in the repository${a.settings.commitHandoffs ? ', committed' : ', not committed'}`,
  ].join('\n')
}

export const RESUME_TOAST = 'Press Enter to send. Claude reads the handoff and continues.'

/** "Continue": the handoff's own resume routine, then a short check-in before any new work. */
export function resumePrompt(handoff: string): string {
  return `Read ${handoff}, then follow its "How to resume": check the folder and branch, run "How to verify", and tell me in two lines where things stand and what you will do first.`
}

// ---------------------------------------------------------------- the handoff Claude writes

export const HANDOFF_OPEN = '<handoff>'
export const HANDOFF_CLOSE = '</handoff>'

/**
 * The sections. Order and content follow Anthropic's guidance for carrying work across sessions: self-contained (files
 * and interfaces named, out of scope stated), evidence rather than claims, failed approaches recorded so they are not
 * repeated, and a verification step the next session runs before new work.
 * (code.claude.com/docs/en/best-practices; anthropic.com/engineering/effective-harnesses-for-long-running-agents)
 */
export type HandoffSection = { title: string; required: boolean; guide: string }

export const HANDOFF_SECTIONS: readonly HandoffSection[] = [
  { title: 'Goal', required: true, guide: 'what the person is trying to achieve, in their own words where they gave them, and what "done" means.' },
  {
    title: 'Where things stand',
    required: true,
    guide: 'what is done, each item with its evidence (commit, test result, output); what is in progress; what is not started. Mark anything not verified as "unverified". Never call something done that was not verified.',
  },
  {
    title: 'Decisions and approvals',
    required: true,
    guide: 'every decision and approval the person gave, quoted, with what it covered and why; what still waits for approval; modes switched on or off (for example #autonomous).',
  },
  { title: 'Next steps', required: true, guide: 'numbered, the very next action first, each with the exact command, file or ID.' },
  { title: 'How to verify', required: true, guide: 'the commands or tests that prove the current state works, and their last result.' },
  { title: 'Open problems', required: false, guide: 'errors and failing tests still open, with the exact message and file:line.' },
  { title: 'Tried and did not work', required: false, guide: 'approaches that failed or were rejected, and why, so they are not repeated.' },
  { title: 'Files', required: false, guide: 'files created or changed in this session, and why; backups taken, with their paths.' },
  { title: 'Running', required: false, guide: 'subagents, background tasks, pipelines or servers still running, with their IDs or ports.' },
  { title: 'Out of scope', required: false, guide: 'what the person said not to do, or what was deliberately left out.' },
  { title: 'Open questions', required: false, guide: 'what only the person can answer.' },
  {
    title: 'How to resume',
    required: true,
    guide: '1. Check the folder and branch (pwd, git status, git log --oneline -5). 2. Read this handoff. 3. Run "How to verify" before any new work. 4. Start "Next steps" item 1.',
  },
]

const REQUIRED_SECTIONS = HANDOFF_SECTIONS.filter(x => x.required).map(x => x.title)

/** The one prompt "handoff & clear" / "handoff & compact" sends: Claude replies with the handoff; the bar saves it. */
export function handoffRequest(a: { project: string; at: number; state: MachineState; draft: string }): string {
  const when = new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)
  return [
    'Write a handoff for the next Claude Code session. It starts with none of this conversation, so it must be self-contained: everything the next session needs is in the handoff.',
    `Write it with the Write tool to exactly this file: ${a.draft} (create it; touch no other file; run nothing else). Do NOT print the handoff in your reply: once the file is written, reply with one line, "Handoff written." The context bar then names it, saves it and commits it.`,
    '',
    `Start with "# Handoff — <name> — ${when} UTC". <name> names the file: the exact folder name of the plan being implemented when there is one (a folder in .claude/knowledge/, for example PROMPT_PIPELINE_LIVE_SUITE), otherwise a short kebab-case name for the work (2 to 5 words, for example context-bar-compact-suggestions). Use the same name as an earlier handoff for the same work.`,
    'Then these "##" sections in this order. Always include the ones marked (required), writing "none" when there is nothing; leave any other section out when it has nothing:',
    ...HANDOFF_SECTIONS.map(x => `## ${x.title}${x.required ? ' (required)' : ''}: ${x.guide}`),
    '',
    'Be concrete: paths, IDs, numbers, commands. Every line must help the next session act; no padding. Never invent: write "unknown" when you do not know.',
    'Read from git just now (use these, do not guess):',
    ...stateLines(a.state),
  ].join('\n')
}

/** The handoff inside Claude's reply; null when the reply has none. */
export function extractHandoff(answer: string): string | null {
  const start = answer.indexOf(HANDOFF_OPEN)
  const end = answer.lastIndexOf(HANDOFF_CLOSE)
  if (start < 0 || end <= start) return null
  const body = answer.slice(start + HANDOFF_OPEN.length, end).trim()
  return body || null
}

const norm = (title: string) => title.toLowerCase().replace(/\s*\(required\)\s*/, '').replace(/[:.\s]+$/, '').trim()

/**
 * The required sections a handoff lacks: no "## <title>" heading (case and a trailing colon do not matter), or a
 * heading with nothing under it before the next heading. Empty when the handoff is complete.
 */
export function missingSections(body: string): string[] {
  const filled = new Map<string, boolean>()
  let current: string | null = null
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h?.[1]) {
      current = norm(h[1].split(':')[0] ?? h[1])
      if (!filled.has(current)) filled.set(current, false)
      continue
    }
    if (/^#\s/.test(line)) {
      current = null
      continue
    }
    if (current && line.trim()) filled.set(current, true)
  }
  return REQUIRED_SECTIONS.filter(title => filled.get(norm(title)) !== true)
}


/** The saved file: Claude's handoff (flagged when incomplete), then the state exactly as git reported it, then how to continue. */
export function handoffFile(a: { body: string; at: number; state: MachineState; path: string; missing?: readonly string[] }): string {
  const when = new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)
  const warning = a.missing?.length ? [`> **Incomplete handoff:** missing ${a.missing.join(', ')}. Check with the person before relying on it.`, ''] : []
  return [
    ...warning,
    a.body,
    '',
    '---',
    '',
    `## Read from git when this handoff was written (${when} UTC)`,
    '',
    ...stateLines(a.state),
    '',
    `To continue in a new session, say: **Read ${a.path} and follow its "How to resume".**`,
    '',
  ].join('\n')
}

// ---------------------------------------------------------------- what every compaction keeps

export const KEEP_LIST = [
  'This summary replaces the conversation, so keep the following exactly, in the person\'s own words where they gave any:',
  '1. Every mode or setting the person switched on or off (for example "#autonomous" on or off), and which one is current now.',
  '2. Every approval the person gave: their exact words and exactly what it covered. Say what is still waiting for approval. Never write that something was approved unless the person said so.',
  '3. The task or plan being worked on: its name, which steps are done and which are next.',
  '4. Helpers (subagents, background tasks) still running: their IDs and what each is doing.',
  '5. Errors or failing tests still open: the exact message and file:line.',
  '6. Files changed, backups taken (with their paths), and anything promised but not done yet.',
].join('\n')

/**
 * The person's own focus first, then the keep list. A project's own rules for the summary belong in its CLAUDE.md
 * ("Compact Instructions"), which Claude Code applies to every compaction itself.
 */
export function withKeepList(instructions: string | undefined): string {
  const parts = [instructions?.trim() || null, KEEP_LIST]
  return parts.filter((p): p is string => !!p).join('\n\n')
}

/** Already carries the keep list: a second pass (a hook that ran twice) adds nothing. */
export function hasKeepList(instructions: string | undefined): boolean {
  return !!instructions && instructions.includes(KEEP_LIST)
}

// ---------------------------------------------------------------- where things stood

/** Read from the machine at the moment of the compaction, never from the conversation. */
export type MachineState = {
  folder: string
  branch: string | null
  head: { sha: string; subject: string } | null
  changed: string[]
  busy: Busy
}

export const STATE_TAG = '[context-bar]'

export function stateLines(s: MachineState): string[] {
  const lines = [`- Folder: ${shortPath(s.folder)}`]
  if (s.branch) lines.push(`- Git branch: ${s.branch}`)
  if (s.head) lines.push(`- Last commit: ${s.head.sha} "${s.head.subject}"`)
  if (s.changed.length) {
    const shown = s.changed.slice(0, 8).join(', ')
    const more = s.changed.length > 8 ? ` and ${s.changed.length - 8} more` : ''
    lines.push(`- Changed, not yet committed (${s.changed.length}): ${shown}${more}`)
  } else {
    lines.push('- Changed, not yet committed: none')
  }
  if (s.busy.subagents > 0) lines.push(`- Subagents still running: ${s.busy.subagents}`)
  if (s.busy.shells > 0) lines.push(`- Background commands still running: ${s.busy.shells}`)
  if (s.busy.merging) lines.push('- A git merge or rebase is in progress')
  if (s.busy.testsFailing) lines.push('- The last test run failed')
  return lines
}

/** The note put back right after a compaction, so the exact state does not depend on how well the summary kept it. */
export function stateMessage(s: MachineState, handoff: string | null): SessionMessage {
  const lines = [
    `${STATE_TAG} Where things stood when the conversation was compacted (read from git, not from the conversation):`,
    ...stateLines(s),
  ]
  if (handoff) lines.push(`- Handoff: ${handoff}`)
  return { role: 'user', text: lines.join('\n'), toolUses: [] }
}

/**
 * For a compaction the bar itself starts: the engine does not run a plugin's own hooks on its own call, so the state
 * cannot be put back as a note afterwards; the summary is asked to end with it instead.
 */
export function stateInstruction(s: MachineState): string {
  return [
    'End the summary with this block, copied exactly as written (it was read from git just now):',
    `${STATE_TAG} Where things stood when the conversation was compacted:`,
    ...stateLines(s),
  ].join('\n')
}

/** `git status --porcelain` lines to paths (a rename keeps its new name). */
export function changedFiles(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.length > 3)
    .map(l => {
      const path = l.slice(3)
      const arrow = path.indexOf(' -> ')
      return arrow >= 0 ? path.slice(arrow + 4) : path
    })
}

/** `git log -1 --format=%h%x09%s` to a commit. */
export function headOf(line: string): { sha: string; subject: string } | null {
  const [sha, ...rest] = line.trim().split('\t')
  return sha ? { sha, subject: rest.join('\t').trim() } : null
}

// ---------------------------------------------------------------- the handoff file

/** `compact`: written by a compaction, with its summary · `handoff`: written by Claude for the next session, before /clear */
export type HandoffKind = 'compact' | 'handoff'

export function projectSlug(root: string): string {
  const base = root.replace(/\/+$/, '').split('/').pop() ?? 'project'
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}

/** `20261006-174512`, in UTC so names sort the same on every machine. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export function handoffDir(home: string, root: string): string {
  return `${home.replace(/\/+$/, '')}/.claude/handoffs/${projectSlug(root)}`
}

export function handoffPath(home: string, root: string, ms: number, kind: HandoffKind): string {
  return `${handoffDir(home, root)}/${stamp(ms)}-${kind}.md`
}

const SUMMARY_CHARS = 120_000

function cap(text: string, n: number): string {
  return text.length > n ? `${text.slice(0, n)}\n\n…(${text.length - n} more characters left out)` : text
}

/** The conversation as the compaction left it: its summary and the messages it kept, our own state note left out. */
export function summaryText(messages: readonly SessionMessage[]): string {
  const body = messages
    .filter(m => m.text.trim() && !m.text.startsWith(STATE_TAG))
    .map(m => `**${m.role === 'user' ? 'Summary / person' : 'Claude'}:**\n\n${m.text.trim()}`)
    .join('\n\n---\n\n')
  return cap(body, SUMMARY_CHARS)
}

/** The file a compaction leaves: its summary and the state. (Claude's own handoff is `handoffFile`.) */
export function handoffMarkdown(a: {
  project: string
  at: number
  state: MachineState
  summary: string
  previous: string | null
}): string {
  const when = new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)
  const why = 'Written when the context was compacted. The summary below is what the conversation was replaced with.'
  const out = [
    `# Handoff — ${a.project} — ${when} UTC`,
    '',
    why,
    '',
    'To continue in a new session, say: **Read this file and continue from where it ends.**',
    '',
    '## Where things stood',
    '',
    ...stateLines(a.state),
  ]
  out.push('', '## Summary of the conversation', '', a.summary)
  if (a.previous) out.push('', '## Earlier handoff', '', `The handoff before this one: ${a.previous}`)
  return `${out.join('\n')}\n`
}
