# ai-dev-architecture

Claude Code mods. One so far: **context-bar**. It shows what fills the context window and hands work over across
compactions and new sessions.

![The context bar above the prompt](context-bar/docs/images/bar.png)

Version 0.17.6 · Claude Code 2.1.292 · [changelog](CHANGELOG.md)

## Install

```
/plugin install context-bar --marketplace fatonsopa/ai-dev-architecture
```

From a checkout: `claude --plugin-dir <path>/context-bar`.

## The bar

![The bar with its categories open](context-bar/docs/images/bar-categories.png)

| Part | Shows |
|---|---|
| Header | Tokens used, where auto-compact starts, a % badge (green, then yellow from 60% of the way to auto-compact, red from 85%). `est.` = local estimate, `exact` = counted by the API. |
| Limits line | Each rate-limit window (session, week, a model's week): meter, %, time to reset. Then this session's cost at API prices. |
| Colour strip | The window by category, with a mark where auto-compact starts. |
| Categories | Tokens and share of each category. Inside: items, largest first; inside an item: a file's sections or a server's tools. |
| Doctor line | The context doctor's progress (`◐ … auditing … 12s`), then `✓ context audit ready` or `✗ … failed`. |

It updates within 1.5 s of every prompt and tool call.

## Buttons

| Button | Does |
|---|---|
| `▸`, or a click on the strip | Show or hide the categories |
| A category · `✕ close` | Open it · close it |
| An item marked `▸` | Open its sections or tools |
| **recalculate** | Count the context exactly (free) |
| **handoff & compact** | Write a handoff, then compact |
| **handoff & clear** | Write a handoff, then `/clear` |
| The handoff path | Open the handoff file |
| **Continue** | Put "resume from this handoff" in the prompt box |
| The doctor line | Show the AI's summary, top 5 actions and the audit file |
| **draft** · **[copy path]** · **[open doctor]** · `✕` | In that panel: draft an action · copy the audit path · open the doctor · remove the line |

## Handoff

1. Claude writes the handoff to a hidden draft file. It is not printed in the chat.
2. The bar checks it. Required: Goal, Where things stand, Decisions and approvals, Next steps, How to verify, How to
   resume, and Open tasks (when there are any). If anything is missing, the file is saved and flagged, and nothing is
   compacted or cleared.
3. The bar saves it as `<repo>/.claude/knowledge/handoffs/<name>-handoff.md`, commits that file alone, and adds the
   git state and the open tasks (as JSON).
4. The bar compacts or runs `/clear`.

![After handoff & compact](context-bar/docs/images/handoff-compact-done.png)

![After handoff & clear, with Continue](context-bar/docs/images/handoff-clear-done.png)

**Continue** appears after `/clear`, or in a new session within 6 hours of the handoff. It recreates the open tasks,
then follows the handoff's "How to resume". It goes away when you send anything else.

Pressed while Claude is mid-step, a button does nothing. If git refuses the commit, the line says
`(not committed: <reason>)` and the compact or clear still runs.

Every compaction, yours or automatic, keeps approvals, the plan, modes and open errors. Its summary is saved to
`~/.claude/handoffs/<project>/<time>-compact.md`.

## Suggestions

| After | Line under the strip | Marked button |
|---|---|---|
| `git commit` | `✓ Changes committed` | handoff & compact |
| `git push` | `✓ Pushed to GitHub` | both |
| A skill run over 5 min | `✓ /<skill> finished` | both |
| `/clear` or a new session | `↺ A handoff … — continue from it?` | **Continue** |

Only when the conversation holds 80k+ tokens. Never within 10 min of a compaction. Never while subagents, background
commands, a git merge or rebase, or failing tests are running. In those cases it waits until the work ends. A
suggestion stays until you press a button or the context shrinks.

## Context doctor

`/context-doctor [--model=opus|sonnet|haiku|fable|<id>] [--effort=low|medium|high|xhigh|max] [ask]`

<img src="context-bar/docs/images/context-doctor.png" alt="The context doctor" width="497">

**Checks** (free, run locally):

| Category | Flags | Severity |
|---|---|---|
| memory files | A file of 3k+ tokens | med, high from 10k |
| mcp tools | A server of 2k+ tokens never called this session | med, high from 10k |
| skills | Skills that don't fit the listing · a listing of 3k+ tokens | med · low |
| agents | Agent descriptions of 2k+ tokens | low |
| tools · system prompt | 25k+ · 10k+ tokens | info |
| messages | Context 40% / 60% of the way to auto-compact | med / high |

**Features:**

- **Findings by category**, the same categories as the bar. Filter by category; open a finding to see what was
  measured and why it matters.
- **AI audit** (paid, optional): a summary and a step-by-step plan per finding, with the tokens each step frees. The
  cost is shown before you run it. Saved as Markdown with `CD-` references in `.claude/knowledge/context-audits/`,
  and readable in the pane.
- **Deep-dive** (paid, optional): a finer plan from one memory file's full text.
- **Draft**: puts any step's instruction in the prompt box. Nothing runs until you press Enter, and it asks before
  editing.
- **Ready-made commands** to copy: `/mcp`, `ENABLE_TOOL_SEARCH=true`, `/skill-doctor`, `/agents`, `/compact`,
  `/clear`, a file's path.
- **Progress in the bar** while the AI works, so the pane can be closed.

## Commands

| Command | Does |
|---|---|
| `/context-bar` · `off` · `pane` | Show · hide · open as a pane |
| `/context-bar recalculate` | Exact count |
| `/context-bar handoff` | Same as **handoff & clear** |
| `/context-bar status` | Version, running work, suggestion, last handoff, open tasks, settings |
| `/context-doctor help` | Usage |

## Settings (`/config`)

| Key | Default |
|---|---|
| `suggest_compact_at_tokens` | 80,000 |
| `long_output_tokens` | 15,000 |
| `long_skill_run_minutes` | 5 |
| `offer_handoff_hours` | 6 |
| `handoff_folder` | `.claude/knowledge/handoffs` |
| `commit_handoffs` | on |

## Privacy and cost

The bar, the suggestions and the doctor's checks run locally. **recalculate** is free. A handoff is one normal Claude
turn. **ask AI** and **deep-dive** send the measurements (or one file) to the chosen model; each button shows the cost
first. Nothing is pushed.

## Develop

```bash
claude plugin validate context-bar
claude plugin test context-bar
```

Each change: bump `context-bar/.claude-plugin/plugin.json` and `context-bar/hooks/version.ts`, add a changelog entry,
commit, push.
