# ai-dev-architecture

Keep long Claude Code sessions on track: see what fills the context, and hand work over without losing it.

![The context bar above the Claude Code prompt: tokens used, the two handoff buttons, rate limits and the colour strip](context-bar/docs/images/bar.png)

Long sessions fail in three quiet ways. This repository's **context-bar** plugin fixes each:

- **The context fills up unseen**, and auto-compact drops details you still needed. The bar shows what fills the
  window and how close auto-compact is, and suggests compacting at a natural stopping point.
- **A new session starts from zero.** One button writes a checked handoff (goal, decisions, approvals, open tasks,
  next commands), then compacts or clears. The next session continues from it.
- **You can't see what costs tokens on every turn.** The context doctor finds big memory files, unused MCP servers
  and skills Claude can't see, and plans the fix.

Version 0.17.7 · [changelog](CHANGELOG.md)

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Update and uninstall](#update-and-uninstall)
- [Usage](#usage)
- [Settings](#settings)
- [Privacy and cost](#privacy-and-cost)
- [Contributing](#contributing)
- [License](#license)

## Requirements

- Claude Code 2.1.275 or later (built and tested on 2.1.292).
- git, for the commit and push suggestions and for committing handoffs.
- A dark terminal theme. Light themes are not tuned yet.

## Install

In a Claude Code session:

```
/plugin install context-bar --marketplace fatonsopa/ai-dev-architecture
```

Confirm the marketplace, then pick a scope. The bar appears above the prompt. The same in two steps:

```
/plugin marketplace add fatonsopa/ai-dev-architecture
/plugin install context-bar@ai-dev-architecture
```

From your shell: `claude plugin install context-bar@ai-dev-architecture` (after `claude plugin marketplace add
fatonsopa/ai-dev-architecture`). The repository is private: Claude Code clones it with your own GitHub access (`gh auth
login` or an SSH key).

To run a local checkout for one session: `claude --plugin-dir <path>/context-bar`.

## Update and uninstall

```bash
claude plugin update context-bar@ai-dev-architecture
claude plugin uninstall context-bar@ai-dev-architecture
```

Auto-update is off for this marketplace by default. Turn it on in `/plugin` → **Marketplaces**.

## Usage

### The Context Bar

![The bar with its categories open](context-bar/docs/images/bar-categories.png)

**Features:**

- **How full the context is**: tokens used, where auto-compact starts, and a % badge that turns yellow at 60% of the
  way to auto-compact and red at 85%. `est.` means a local estimate; press **recalculate** for an exact count (free).
- **What fills it**: the colour strip shows the window by category. Press `▸` (or click the strip) to list the
  categories with their tokens. Press a category to see its items, largest first, and an item marked `▸` to see its
  sections or tools. `✕ close` closes it.
- **Rate limits and cost**: each rate-limit window (session, week, a model's week) with a meter, % and time to reset,
  and this session's cost at API prices.
- **Handoff buttons**: **handoff & compact** and **handoff & clear** ([Handoff](#handoff)). After a commit, a push or
  a long skill run, the bar marks the one to press.
- **Context doctor progress**: while the doctor's AI works, a line shows its progress. Press it for the summary, the
  top 5 actions (**draft** puts one in your prompt box) and the audit file (**[copy path]**, **[open doctor]**). `✕`
  removes the line.

It updates within 1.5 s of every prompt and tool call.

### Handoff

**handoff & compact** saves a handoff and keeps the session, with a lighter context: use it to carry on with the same
work. **handoff & clear** saves a handoff and starts a clean conversation: use it before unrelated work. Both:

1. Claude writes the handoff to a hidden draft file. It is not printed in the chat.
2. The bar checks it. Required: Goal, Where things stand, Decisions and approvals, Next steps, How to verify, How to
   resume, and Open tasks (when there are any). If anything is missing, the file is saved and flagged, and nothing is
   compacted or cleared.
3. The bar saves it as `<repo>/.claude/knowledge/handoffs/<name>-handoff.md`, commits that file alone, and adds the
   git state and the open tasks (as JSON).
4. The bar compacts or runs `/clear`.

![After handoff & compact: the context went from 21% to 1%, and the handoff path](context-bar/docs/images/handoff-compact-done.png)

![After handoff & clear: the handoff path and the Continue offer](context-bar/docs/images/handoff-clear-done.png)

Click the handoff path under the result to open the file. After `/clear`, or in a new session within 6 hours, press
**Continue**: it puts a request in your prompt box to recreate the open tasks and follow the handoff's "How to
resume". It goes away when you send anything else.

Pressed while Claude is mid-step, a button does nothing. If git refuses the commit, the line says
`(not committed: <reason>)` and the compact or clear still runs.

Every compaction, yours or automatic, keeps approvals, the plan, modes and open errors. Its summary is saved to
`~/.claude/handoffs/<project>/<time>-compact.md`.

### Context doctor

**What it is:** an audit of what takes room in the context window, by the same categories as the bar. Open it with
`/context-doctor`.

**What it does:** it measures each category and flags what costs tokens on every request: large memory files, MCP
servers you never call, skills Claude can't see, unused agents, and how close auto-compact is. On request, an AI
audit turns each finding into step-by-step fixes with the tokens each one frees, and **draft** hands a fix to Claude,
which asks before editing.

**When to use it:** when the context is already large at the start of a session; after adding MCP servers, skills,
agents or memory files; or when auto-compact keeps arriving sooner than you expect.

`/context-doctor [--model=opus|sonnet|haiku|fable|<id>] [--effort=low|medium|high|xhigh|max] [ask]`

**Features:**

- **Findings by category**, the same categories as the bar. Press a category to show only its findings; press a
  finding to see what was measured and why it matters. **⟳ rescan** measures again; **✕ close** (or Escape) closes
  the pane.
- **AI audit** (paid, optional): a summary and a step-by-step plan per finding, with the tokens each step frees. The
  cost is shown on the **✦ ask AI** button. Saved as Markdown with `CD-` references in
  `.claude/knowledge/context-audits/`: **[open]** opens the file, **[copy path]** copies its path, and `▸ full audit`
  shows it in the pane.
- **Deep-dive** (paid, optional): a finer plan from one memory file's full text.
- **Draft**: puts any step's instruction in the prompt box. Nothing runs until you press Enter, and it asks before
  editing.
- **Ready-made commands** to copy: `/mcp`, `ENABLE_TOOL_SEARCH=true`, `/skill-doctor`, `/agents`, `/compact`,
  `/clear`, a file's path.
- **Progress in the bar** while the AI works, so the pane can be closed.

<img src="context-bar/docs/images/context-doctor.png" alt="The context doctor: findings by category, a memory file finding open, and the ask AI button with its cost" width="497">

**Checks** (free, run locally):

| Category | Flags | Severity |
|---|---|---|
| memory files | A file of 3k+ tokens | med, high from 10k |
| mcp tools | A server of 2k+ tokens never called this session | med, high from 10k |
| skills | Skills that don't fit the listing · a listing of 3k+ tokens | med · low |
| agents | Agent descriptions of 2k+ tokens | low |
| tools · system prompt | 25k+ · 10k+ tokens | info |
| messages | Context 40% / 60% of the way to auto-compact | med / high |

### Commands

| Command | Does |
|---|---|
| `/context-bar` · `off` · `pane` | Show · hide · open as a pane |
| `/context-bar recalculate` | Exact count |
| `/context-bar handoff` | Same as **handoff & clear** |
| `/context-bar status` | Version, running work, suggestion, last handoff, open tasks, settings |
| `/context-doctor help` | Usage |

## Settings

`/plugin` → **Installed** → **context-bar** → **Configure options**.

| Option | Default |
|---|---|
| Suggest compacting at (tokens of conversation) | 80,000 |
| Long output tip at (tokens in one tool result) | 15,000 |
| Long skill run (minutes) | 5 |
| Offer a handoff for (hours) | 6 |
| Handoff folder (relative to the repository) | `.claude/knowledge/handoffs` |
| Commit handoffs | on |

## Privacy and cost

The bar, the suggestions and the doctor's checks run locally. **recalculate** is free. A handoff is one normal Claude
turn. **ask AI** and **deep-dive** send the measurements (or one file) to the chosen model; each button shows the cost
first. The plugin commits handoffs but never pushes.

## Contributing

Open an issue or a pull request. Before each change:

```bash
claude plugin validate context-bar
claude plugin test context-bar
```

Bump the version in `context-bar/.claude-plugin/plugin.json` and `context-bar/hooks/version.ts`, and add a
[changelog](CHANGELOG.md) entry.

## License

No license yet: all rights reserved by Faton Sopa.
