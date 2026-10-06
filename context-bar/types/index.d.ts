/** One row of the context breakdown, as /context lists it, with how the bar shows it. */
export type Row = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
  /** The engine's theme key for the row. */
  color: string
  /** What the bar prints for it: `system prompt`, `tools`, `memory files`... */
  label: string
  /** The colour the bar draws it in. */
  display: string
  /** Which kind of category it is (`memory`, `mcp`, `skills`...), set by the bar. */
  cat: string
}

/**
 * One thing inside a category (a memory file, an MCP server, a skill...), and what is inside it: `children`
 * (a file's sections, a server's tools) or `preview` (a section's, tool's or skill's own text).
 */
export type Item = { label: string; tokens: number; note?: string; children?: Item[]; preview?: string }

/** What a category is made of, and how its numbers were obtained. */
export type Detail = { caption: string; items: Item[] }

/** The context window at one moment. */
export type Snapshot = {
  /** `summary` = local estimate (no API call); `full` = counted with the free token-count API. */
  detail: 'summary' | 'full'
  at: number
  model: string
  total: number
  max: number
  percent: number
  /** Token count at which auto-compaction runs; null when auto-compact is off. */
  threshold: number | null
  rows: Row[]
  details: { [category: string]: Detail }
  /** The account's rate-limit windows as the last API response reported them (session, week, ...). */
  limits: Limit[]
  /** What this session has cost so far, in US dollars as /cost totals it; null where the host keeps no ledger. */
  cost: number | null
}

/** One rate-limit window, as the bar shows it. */
export type Limit = {
  /** The engine's word for the window: `five_hour`, `seven_day`, `spend_limit`, or another it reports. */
  kind: string
  /** What the bar prints: `session`, `week`, `fable week`... */
  label: string
  /** 0 to 100 (past 100 on an exceeded spend limit). */
  percent: number
  /** ISO 8601, when the window resets; null when the engine gave none. */
  resetsAt: string | null
}

// ---------------------------------------------------------------- context doctor

export type Severity = 'high' | 'med' | 'low' | 'info'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** What a button on a finding does. Nothing here changes anything by itself. */
export type DoctorAction =
  | { kind: 'prompt'; label: string; text: string } // placed in the input box; the person reads it and presses Enter
  | { kind: 'copy'; label: string; text: string } // copied to the clipboard
  | { kind: 'deep'; label: string } // one more AI call, over this file's full text

/** One recommended step, from the AI, written as a specification. */
export type AiStep = {
  /** The step in one line. */
  text: string
  /** Exactly where: the file and section, the MCP server, the skill or the agent. */
  where?: string
  /** The specification: precisely what to change. */
  change?: string
  /** How to check it worked once done. */
  acceptance?: string
  /** Tokens the step would free, as the AI estimated it; null when it gave none. */
  saves: number | null
  /** A ready instruction for Claude Code that carries the step out (it asks for approval before editing). */
  prompt?: string
}

export type Finding = {
  id: string
  /** Its reference in the saved audit (`CD-3`); its steps are `CD-3.1`, `CD-3.2`... Set when an AI audit is saved. */
  ref?: string
  /** The /context row it belongs to ("Memory files", "MCP tools"...), labelled and coloured exactly as the bar does. */
  category: string
  categoryKind: Row['kind']
  severity: Severity
  title: string
  tokens: number
  measured: string[]
  why: string
  actions: DoctorAction[]
  path?: string
  /** Tokens a deep-dive would send (the file's full text), for the cost shown on its button. */
  deepTokens?: number
  plan?: AiStep[]
  deep?: { note: string; steps: AiStep[] }
  source: 'rule' | 'ai'
}

/** One AI call and what it cost. */
export type AiRun = {
  kind: 'audit' | 'deep'
  model: string
  inTokens: number
  outTokens: number
  /** US dollars at API list prices; null for a model whose price this mod does not know. */
  cost: number | null
  at: number
  summary: string
  error?: string
}

export type DoctorReport = {
  at: number
  total: number
  max: number
  threshold: number | null
  findings: Finding[]
  /** Tokens the audit prompt would send, for the cost shown on the button. */
  aiInputTokens: number
  runs: AiRun[]
  summary: string | null
  /** The audit file the last AI audit was saved to; deep-dives rewrite it. */
  audit: { id: string; path: string; at: number } | null
}

/** The doctor's long job (an AI audit or a deep-dive) as the bar announces it: running, ready, or failed. */
export type DoctorNotice = {
  state: 'running' | 'ready' | 'failed'
  kind: 'audit' | 'deep'
  model: string
  startedAt: number
  endedAt: number | null
  /** Why it failed. */
  message: string | null
}

/** Tools, skills and agents called in this session, by name, with how many times. */
export type Seen = {
  tools: { [name: string]: number }
  skills: { [name: string]: number }
  agents: { [name: string]: number }
}

// ---------------------------------------------------------------- compacting (compaction)

/** A suggestion the bar shows: compact after a finished step, or continue from a handoff in a new session. */
export type CompactTip = {
  /** `saved`: a commit landed · `pushed`: a git push went out · `finished`: a long skill run ended · `resume`: a new session with a recent handoff */
  reason: 'saved' | 'pushed' | 'finished' | 'resume'
  /** When the step finished, or when the notes were written (`resume`). */
  at: number
  /** What finished: the commit's subject, the pushed refs (`dev -> dev`) or the skill's name; null when unknown. */
  what: string | null
  /** For `resume`: the handoff file to read. */
  handoff: string | null
  /** For `pushed`: where the push went (`GitHub`, `GitLab`, or the host); absent when it is not known. */
  to?: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      /** The compaction suggestion shown in the bar; null when there is none. */
      compactTip: CompactTip | null
      /** What the bar shows while it works (a handoff being written, a compaction); null when nothing runs. */
      compactRunning: string | null
      /** The last result the bar reports (a handoff, a compaction, a clear); null once the person sends a message. */
      compactResult: string | null
      /** The handoff file the line names, drawn there as a link to it; null before the first. */
      compactLink: string | null
      snapshot: Snapshot | null
      selected: string | null
      isCounting: boolean
      isBandHidden: boolean
      error: string | null
      doctor: DoctorReport | null
      doctorExpanded: string[]
      doctorModel: string
      doctorEffort: Effort | null
      doctorBusy: string | null
      doctorError: string | null
      seen: Seen
      /** Whether the categories under the bar are shown (hidden until the bar is clicked). */
      legendOpen: boolean
      /** The item opened to its third level, as `<category>::<item label>`; null when none is. */
      openItem: string | null
      /** The doctor's running or finished job, shown in the bar; null once dismissed. */
      doctorNotice: DoctorNotice | null
      /** Whether the bar shows the job's summary and top actions. */
      doctorPeek: boolean
      /** Bumped while a job runs, so the bar's spinner and elapsed time move. */
      tick: number
      /** The doctor pane's category filter: a /context row name, or null for every category. */
      doctorFilter: string | null
      /** Whether the doctor pane shows the last run's full audit file. */
      auditOpen: boolean
      /** The last audit file's Markdown, once read (or just written). */
      auditText: string | null
    }
  }
}
