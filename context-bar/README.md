# context-bar

**See what fills Claude Code's context window, and keep long work going across compactions and new sessions.**

A Claude Code mod with three parts:

- **The context bar**, above the prompt: how full the context is, what fills it by category, your rate limits, and
  this session's cost.
- **Compact and handoff**: two buttons that write a proper handoff and then compact or clear. At natural stopping
  points the bar suggests which one to press. Open tasks carry over to the next session.
- **The context doctor** (`/context-doctor`): an audit of what takes room in the context, with AI recommendations you
  can act on.

It works in any project. Every signal it reads is one that Claude Code or git gives everywhere; nothing is tied to one
repository.

![The context bar above the prompt: 385k of 1M used, auto-compact at 967k, the two handoff buttons, the session and week limits, and the colour strip](docs/images/bar.png)

Version 0.17.5 · built and tested on Claude Code 2.1.292 · [changelog](../CHANGELOG.md)

## Contents

- [Install](#install)
- [The context bar](#the-context-bar)
  - [Header](#header)
  - [Limits line](#limits-line)
  - [Colour strip](#colour-strip)
  - [Categories](#categories)
  - [The doctor's line in the bar](#the-doctors-line-in-the-bar)
  - [When the bar updates](#when-the-bar-updates)
- [Compact and handoff](#compact-and-handoff)
  - [The two buttons](#the-two-buttons)
  - [When the bar suggests one](#when-the-bar-suggests-one)
  - [handoff & compact](#handoff--compact)
  - [handoff & clear](#handoff--clear)
  - [The handoff](#the-handoff)
  - [Open tasks carry over](#open-tasks-carry-over)
  - [Every compaction keeps what matters](#every-compaction-keeps-what-matters)
  - [Other messages](#other-messages)
- [The context doctor](#the-context-doctor)
  - [The pane, top to bottom](#the-pane-top-to-bottom)
  - [What it checks](#what-it-checks)
  - [A finding](#a-finding)
  - [The doctor's buttons](#the-doctors-buttons)
  - [Running it](#running-it)
- [Every button](#every-button)
- [Commands](#commands)
- [Settings](#settings)
- [Privacy and cost](#privacy-and-cost)
- [Files it writes](#files-it-writes)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Develop](#develop)

## Install

```
/plugin install context-bar --marketplace fatonsopa/ai-dev-architecture
```

Answer `y` to add the marketplace, then pick a scope. The bar appears above the prompt.

To run it from a local checkout instead, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`
(under `env`), or start Claude Code with `claude --plugin-dir <path>/context-bar`.

## The context bar

![The bar with its categories open, and the messages category opened to its third level](docs/images/bar-categories.png)

`/context-bar off` hides the bar and `/context-bar` shows it again. In VS Code and on mobile it opens as a pane.

### Header

From left to right:

- **`◆ context`** and how it was counted: `est.` is a local estimate with no API call; `exact` is counted with Claude
  Code's free token-count API (after **recalculate**).
- **`▸`** lists the [categories](#categories) under the strip; it turns into `▾`, and a second press hides them.
- **Tokens used of the window**, then where auto-compact starts (`compacts at 967k`), or `auto-compact off`.
- **The two buttons**, [handoff & compact and handoff & clear](#the-two-buttons), separated by `|`.
- **The badge**: how much of the window is used, as a percentage. Its colour says how close auto-compact is: green
  under 60% of the way there, yellow under 85%, red from 85%. With auto-compact off, it is measured against the whole
  window.

Until the first measurement, the header reads `◆ context  measuring…`. If Claude Code cannot give its context
breakdown, it reads `unavailable: <reason>`.

### Limits line

Under the header, after a blank line:

```
session ▰▰▱▱▱▱ 31% | resets in 2m | week ▰▱▱▱▱▱ 24% | resets in 1d 16h | session spent in api cost $0.42      ■ recalculate
```

- **One entry per rate-limit window** your account reports: the session window, the week, and the model-specific
  weeks. Each label has its own colour (session blue, week purple, a model's week pink, any other window yellow).
- **The meter and percentage.** Six cells, green under 60%, yellow under 85%, red from 85%. A window that is not yet
  full never reads 100%.
- **When it resets**, in teal. When the line is too narrow, `resets in 2h 14m` shortens to `↻ 2h 14m`; when even that
  does not fit, the entries wrap onto a second line.
- **`session spent in api cost`**: what this session would cost at API list prices. On a subscription it is a measure
  of how heavy the session is, not a bill.
- **`■ recalculate`**, at the far right, counts the context exactly with the free token-count API. It reads
  `recalculating…` while it counts; afterwards the header says `exact`.

Off a subscription, or before Claude's first reply, there are no windows to show and only the cost appears.

### Colour strip

One cell per share of the window, in each category's colour, with a mark where auto-compact starts. Click anywhere on
the strip to show or hide the categories, the same as `▸`.

### Categories

Each category shows its tokens and its share of the window: system prompt, tools, mcp server instructions, mcp tools,
memory files, skills, agents, messages and free space. Deferred tools are listed apart and dimmed, since they load only
when used; free space is dimmed too. Under the pointer a category's name lights up in its colour.

- **Press a category** to open it under the list. Its `■` becomes `▣`, and a title line reads
  `▸ memory files · 42k · 6 items`. **`✕ close`** at the right of that line (or a second press on the category) closes
  it.
- **Its items**, largest first: a small bar sized against the largest item, the name, the tokens, and the share of the
  category. As many items as the terminal's height allows (up to 14); the rest are summed on one line,
  `+ 9 more · 12k`. A category Claude Code does not break down says `not itemized by the engine`.
- **Free space** says how much is left before auto-compact: `600k free · 367k until auto-compact at 967k` (or
  `auto-compact is off`).
- **An item marked `▸`** opens a third level in place when pressed: a file's sections, a server's tools, or a short
  preview of a text. Up to 12 entries, then `+ N more`. A second press closes it.

### The doctor's line in the bar

While the [context doctor](#the-context-doctor) asks the AI, a line under the limits shows the job, so you can keep
working with the doctor's pane closed:

| State | The line |
|---|---|
| Working | `◐ context doctor · auditing with opus · 12s` (the spinner turns; `deep-diving` for a deep-dive) |
| Done | `✓ context audit ready · CD-3 · $0.12` (`deep-dive ready` for a deep-dive) |
| Failed | `✗ context doctor audit failed` |

**Press the line** to open a panel under it, and again to close it:

- while it works: how long ago it started;
- if it failed: the error;
- when it is done: the AI's summary, the **top 5 actions** (each with its `CD-` reference, the tokens it should free,
  and a **draft** button), and `full audit: <path>` with **[copy path]** and **[open doctor]**.

**✕** beside the line removes it (once the job has ended).

### When the bar updates

The bar measures again within 1.5 seconds of every prompt and every tool call, and at least every 30 seconds otherwise.
Every 12 seconds it also checks for running subagents and a git merge or rebase, so a suggestion held back during
such work is offered as soon as it ends.

## Compact and handoff

### The two buttons

| Button | What it does |
|---|---|
| **handoff & compact** (mint) | Claude writes a handoff for the work. The bar saves it (and commits it), then compacts the conversation. |
| **handoff & clear** (rose) | The same handoff, then the bar runs `/clear`. |

Both always sit in the header, each after a `■` in its colour; under the pointer the label lights up in that colour.
Pressed while Claude is in the middle of a step, a button does nothing and says
`Wait until Claude finishes the current step, then hand off.`

### When the bar suggests one

At a good moment, the right button's `■` becomes `▣` and a line under the strip says what just finished:

| When | The line says | Suggested |
|---|---|---|
| A `git commit` succeeded | `✓ Changes committed` | handoff & compact |
| A `git push` sent something | `✓ Pushed to GitHub` (GitLab, Bitbucket, … or the host) | both |
| A turn that used a skill ran longer than *Long skill run* | `✓ /<skill> finished` | both |
| `/clear` or a new session, with a handoff newer than *Offer a handoff for* | `↺ A handoff from your last session was saved … — continue from it?` | **Continue** |

- **Only when there is something to free.** A commit, push or skill run is suggested only when the conversation (the
  messages category) holds at least *Suggest compacting at* tokens (80,000 by default), and never within 10 minutes
  of a compaction.
- **Only your own steps.** A subagent's commits and pushes, a failed git command, and a skill run you interrupted don't
  count.
  When a push's output does not name the host, the bar asks git for the remote; if git cannot tell either, the line
  says `✓ Pushed`.
- **Not in the middle of work.** Nothing is suggested while a turn runs, while subagents or background commands are
  still running, during a git merge or rebase, or while the last test run failed (vitest, jest, Playwright, pytest,
  deno, bun, go, cargo, `npm test` and the like). A moment that comes during such work is offered as soon as the work
  ends.
- **It stays** until you press a button, a compaction shrinks the context, or a newer moment replaces it. There is no
  "later" button. Only the **Continue** offer goes away on your next message, since that means you started on other
  work.

If you type `/compact` at a bad moment, the bar warns you and still compacts (see [Other messages](#other-messages)).

### handoff & compact

Use it when you keep working on the same thing and want a lighter context: after a commit, a push, or a long skill
run. The conversation goes on in the same session, with a summary in place of the history and a handoff on disk in
case you need more detail later.

**Before you press it.** Wait for Claude to finish its current step; pressed mid-turn, the bar says
`Wait until Claude finishes the current step, then hand off.` and does nothing.

**What happens, and what the bar shows at each step:**

1. **Claude writes the handoff.** One collapsed Write in the transcript and a one-line reply, "Handoff written." The
   handoff goes to a hidden draft file and is never printed, so it isn't paid for twice.

   ```
   Writing the handoff…
   ```
2. **The bar checks it.** Every required section must be there, and every open task must be named. If anything is
   missing, the file is saved but flagged and **nothing is compacted**:

   ```
   Handoff failed on October 6, 10:41:47pm: /…/handoffs/<name>-handoff.md is missing How to verify. Nothing was compacted.
   ```
3. **The bar saves and commits it** as `<name>-handoff.md`, named after the plan or the work (for example
   `context-bar-compact-suggestions-handoff.md`), and removes the draft. It commits only that file, by path, so
   nothing else you have staged goes with it. If git refuses (a hook, a merge in progress), the line says
   `(not committed: <reason>)` and the compaction still runs.
4. **The bar compacts the conversation.** The summary is focused on what just finished and told where the handoff
   is; it keeps the [keep list](#every-compaction-keeps-what-matters) and the git state.

   ```
   Handoff completed on October 6, 10:41:47pm: /…/.claude/knowledge/handoffs/<name>-handoff.md
   Compacting… this can take a minute.
   ```
5. **The result**, until your next message:

   ```
   Compact completed on October 6, 10:42:30pm: context went from 89% to 2%.
   Handoff: /…/.claude/knowledge/handoffs/<name>-handoff.md
   ```

   ![The bar after handoff & compact: "Compact completed on October 6, 11:51:35pm: context went from 21% to 1%." and, under it, the handoff path to click](docs/images/handoff-compact-done.png)

   If the compaction itself fails, the handoff is still saved and the line says `Compact failed on …: <reason>.`

**After it.** Click the handoff path to open the file: under the pointer it turns yellow and underlined, and a press
opens it in your default app for Markdown. Your task list stays as it was, since the session goes on. A copy of the
summary is saved to `~/.claude/handoffs/<project>/<time>-compact.md`. The bar makes no new suggestion for the next 10
minutes.

### handoff & clear

Use it when the next task has nothing to do with this one: you want a clean context, and everything worth keeping
written down first. The conversation ends; a new, empty one starts, and the handoff is waiting for it.

**Before you press it.** Wait for Claude to finish its current step; pressed mid-turn, the bar says
`Wait until Claude finishes the current step, then hand off.` and does nothing. `/context-bar handoff` does the same
as the button, from the prompt.

**What happens, and what the bar shows at each step:**

1. **Claude writes the handoff.** One collapsed Write in the transcript and a one-line reply, "Handoff written." The
   handoff goes to a hidden draft file and is never printed, so it isn't paid for twice.

   ```
   Writing the handoff…
   ```
2. **The bar checks it.** Every required section must be there, and every open task must be named. If anything is
   missing, the file is saved but flagged and **nothing is cleared**:

   ```
   Handoff failed on October 6, 10:41:47pm: /…/handoffs/<name>-handoff.md is missing How to verify. Nothing was cleared.
   ```
3. **The bar saves and commits it** as `<name>-handoff.md`, named after the plan or the work, and removes the draft.
   It commits only that file, by path. If git refuses, the line says `(not committed: <reason>)` and the clear still
   runs.
4. **The bar runs `/clear`.**

   ```
   Handoff completed on October 6, 10:41:47pm: /…/.claude/knowledge/handoffs/<name>-handoff.md
   Now starting clear...
   ```
5. **The result**, in the new conversation, with the offer to continue under it:

   ```
   Clear completed on October 6, 10:41:52pm.
   Handoff: /…/.claude/knowledge/handoffs/<name>-handoff.md
   ↺ A handoff from your last session was saved 1 min ago — continue from it?      Continue
   ```

   ![The bar after handoff & clear: "Clear completed on October 6, 11:56:50pm.", the handoff path to click under it, and the offer to continue from the handoff with its Continue button](docs/images/handoff-clear-done.png)

   If `/clear` itself fails, the handoff is still saved and the line says so:
   `Clear failed on …: <reason>. The handoff is saved: <path>. Type /clear yourself.`

**After it: pick the work up again.** The new conversation starts with an empty context and an empty task list.
Click the handoff path to read the file first, if you like. **Continue** puts this request in the prompt box and says
`Press Enter to send. Claude reads the handoff and continues.`:

```
Read /…/<name>-handoff.md. If it has a "Task list to recreate on resume" section, first recreate those tasks exactly
as it says. Then follow its "How to resume": check the folder and branch, run "How to verify", and tell me in two
lines where things stand and what you will do first.
```

The offer also appears when you start `claude` fresh in the same project, as long as the handoff is newer than
*Offer a handoff for* (6 hours by default). It goes away when you send anything else, since that means you started on
other work.

### The handoff

Sections follow Anthropic's guidance for carrying work across sessions: self-contained, evidence instead of claims,
failed approaches recorded, and a check to run before new work.

| Section | Required |
|---|---|
| Goal | yes |
| Where things stand (each item with its evidence) | yes |
| Decisions and approvals (quoted) | yes |
| Next steps (numbered, with exact commands) | yes |
| Open tasks | when the task list has open tasks |
| How to verify | yes |
| Open problems · Tried and did not work · Files · Running · Out of scope · Open questions | when there is something to say |
| How to resume | yes |

Under Claude's text, the bar adds the git state it read itself (folder, branch, last commit, uncommitted files). The
commit is named `Handoff for the next session (<project>, <date> <time> UTC)`.

### Open tasks carry over

The bar keeps an exact copy of the session's task list: every `TaskCreate`, `TaskUpdate` and `TodoWrite`. A
subagent's own tasks are left out.

- The handoff must have an **Open tasks** section with one entry per open task: its exact subject, its status, and the
  context needed to pick it up cold (where it stopped, the files, the next command). A handoff that leaves one out
  fails the check.
- The bar appends **Task list to recreate on resume**: the open tasks exactly as the list held them (subject,
  description, spinner text, status, and what each is blocked by), as JSON.
- **Continue** asks the next session to recreate those tasks first, then follow "How to resume".

`/context-bar status` shows how many open tasks the next handoff will carry.

### Every compaction keeps what matters

Every compaction (yours, an automatic one, or the button's) gets a keep list: modes switched on or off (such as
`#autonomous`), approvals in your own words, the plan and its steps, running subagents, open errors, and files and
backups. After the summary, the bar puts back a note of where things stood in git. The summary is also saved to
`~/.claude/handoffs/<project>/<time>-compact.md` and named on the result line. Project-specific rules for summaries
belong in the project's `CLAUDE.md` ("Compact Instructions"), which Claude Code applies itself.

### Other messages

| The bar says | When |
|---|---|
| `Compact completed on October 6, 10:42:30pm: context went from 89% to 2%.` and `Handoff: <path>` | After a `/compact` you typed. The path is the saved summary. |
| `Auto-compact completed on …: context went from 93% to 3%.` and `Handoff: <path>` | After an automatic compaction. |
| `Heads-up: 2 subagents are still running. Compacting now can lose details it still needs.` | A compaction starts while work is under way: subagents, background commands, a git merge or rebase, or failing tests. The compaction still runs. |
| `That step returned a lot of text (about 4% of the context). Tip: for long logs or big files, ask Claude to use a subagent that reads them and reports back.` | One tool result in the main conversation holds at least *Long output tip at* tokens (15,000 by default). Not for a subagent's report; at most once every 15 minutes. |
| `Wait until Claude finishes the current step, then hand off.` | A handoff button was pressed in the middle of a step. Nothing happened. |
| `Could not ask for the handoff: <reason>. Nothing was compacted or cleared.` | The request to Claude could not be sent. |
| `No repository and no home folder found, so the handoff cannot be saved. Nothing was compacted or cleared.` | There is nowhere to save the handoff. |
| `Could not open <path>: <reason>` | Clicking a handoff path failed. |

## The context doctor

`/context-doctor` opens a pane that audits the context window by the same categories as the bar.

<img src="docs/images/context-doctor.png" alt="The context doctor: 406k of 1M, 4 findings; each category with its tokens, share and findings; the memory files category open with a high and a medium finding; and the ask AI button with its estimated cost" width="497">

How it works:

1. **Findings, without AI.** It measures what each category holds and flags what is worth a look (see
   [What it checks](#what-it-checks)). This part is free and runs on your machine.
2. **✦ ask AI** (optional, paid). One model call over the measurements. It returns a summary and, for each finding, a
   plan: numbered steps, each saying exactly where, what to change, how to check it worked, and the tokens it should
   free. The AI can also add findings the checks missed, filed under one of the bar's categories. The button shows
   the model and the estimated cost before you press it.
3. **deep-dive** (optional, paid). One more call over a single memory file's full text, for a finer plan.
4. **draft** puts a step's instruction in your prompt box. Nothing runs until you press Enter, and every drafted
   instruction ends with "Show me the proposed change and wait for my approval before editing anything."

Each AI audit is saved as Markdown, with references (`CD-3`, `CD-3.2`) you can quote, in the project's
`.claude/knowledge/context-audits/` (or `.claude/context-audits/` when there is no `.claude/knowledge/`). The
project's last AI run is kept, so the doctor shows it again in a later session until you ask anew.

### The pane, top to bottom

1. **Header**: `◆ context doctor`, then `406k of 1M · 4 findings` and either `could free ~45k` (what the AI's plans
   should free) or, before asking, `120k at stake` (the tokens held by findings above info).
2. **Buttons**: **⟳ rescan** and **✦ ask AI · opus · ~$0.12** on the left, **✕ close** on the right.
3. **What it is doing**, while it works: `scanning…`, `asking opus…` or `deep-diving with opus…`. An error shows in
   red.
4. **The AI's summary**, in italics, once you have asked.
5. **The audit file**: `full audit: <path>` with **[open]** and **[copy path]**; before the first AI audit,
   `full audit: none yet — ✦ ask AI saves it in <folder>/`.
6. **When**: `last AI run October 6, 10:41:47pm (5 min ago) · opus · $0.12 · scanned October 6, 10:45:02pm`, or
   `last AI run none yet — press ✦ ask AI`.
7. **Category chips**: each of the bar's categories with its tokens, share and `2 findings` (or `no findings`, dimmed),
   the largest categories first. Press one to show only its findings; the list then starts with the category's name,
   its numbers and **✕ all categories**.
8. **The findings** (see [A finding](#a-finding)). With none: `Nothing crosses a threshold. Ask the AI for a second
   opinion if you want one.`
9. **`▸ full audit · CD-… · <time>`**: press to read the whole saved audit inside the pane, as Markdown; press again
   to fold it.
10. **The last three AI calls**: `AI · audit · claude-opus-5-5 · 40k in · 3k out · $0.42 at API prices`, with the
    error when one failed.

### What it checks

| Category | Finding | Severity |
|---|---|---|
| memory files | Each memory file of 3,000 tokens or more: `<file> loads 12k tokens every request`, with its biggest sections | med; high from 10,000 |
| mcp tools | Each MCP server whose loaded tools hold 2,000 tokens or more and none was called this session | med; high from 10,000 |
| skills | Skills that don't fit the listing, so Claude can't see them | med |
| skills | A skill listing of 3,000 tokens or more, with how many skills this session used | low |
| agents | Custom agent descriptions of 2,000 tokens or more, with the ones not used this session | low |
| tools | Built-in tool definitions of 25,000 tokens or more, with the largest | info |
| system prompt | A system prompt of 10,000 tokens or more | info |
| messages | How far the context is toward auto-compact: med from 40% of the way, high from 60% | med or high |
| free space | Below 40% of the way: `auto-compact far away`, nothing to do | info |

### A finding

A finding's row shows `▸`, its category, its severity (`● high` red, `● med` yellow, `○ low` grey, `· info`), its
title (with its `CD-` reference once an audit is saved), its tokens, its share of the window, and `−12k` when a plan
should free that much. Press the title to open it:

- **measured**: the numbers behind it.
- **why**: why it matters.
- **AI plan**: the AI's steps, numbered `CD-3.1`, `CD-3.2` …, each with the tokens it should free and a **draft**
  button. Before you ask: `press "✦ ask AI" above for a plan`.
- **deep-dive** and **deep plan**: the deep-dive's note and its further steps, also with **draft**.
- **actions**: the finding's own buttons (below).

Press the title again to close it.

### The doctor's buttons

| Button | Where | What it does |
|---|---|---|
| **⟳ rescan** | top | Measures again. Free, no AI. |
| **✦ ask AI · opus · ~$0.12** | top | The paid AI audit. The label shows the model, the effort (when set) and the estimated cost; it reads `asking opus…` while it works. |
| **✕ close** | top right | Closes the pane. Escape does the same. |
| **[open]** | full audit line | Opens the audit file in your default app. |
| **[copy path]** | full audit line | Copies the audit file's path. |
| a category chip | chip list | Shows only that category's findings. A second press shows all again. |
| **✕ all categories** | above a filtered list | Shows every category's findings again. |
| a finding's title | each finding | Opens or closes the finding. |
| **draft** | each plan step | Puts that step's instruction in your prompt box. |
| **draft this edit** | memory file finding | Puts a request in your prompt box: propose which sections to keep, shorten or move out, with the tokens each saves. |
| **deep-dive this file · ~$0.05** | memory file finding | The paid deep-dive over the file's full text. Reads `deep-diving…` while it works. Its steps are added to the audit file. |
| **copy path** | memory file finding | Copies the file's path. |
| **copy /mcp** | MCP server finding | Copies `/mcp`, to disconnect servers you don't use here. |
| **copy ENABLE_TOOL_SEARCH=true** | MCP server finding | Copies the setting that loads MCP tools only when needed. |
| **copy /skill-doctor** | skills findings | Copies `/skill-doctor`. |
| **copy /agents** | agents finding | Copies `/agents`. |
| **copy /compact** | messages finding | Copies `/compact keep the current task, decisions and open questions`. |
| **copy /clear** | messages finding | Copies `/clear`. |
| **`▸ full audit · CD-…`** | bottom | Shows the whole saved audit inside the pane; a second press folds it. |

What the buttons say back:

| Message | After |
|---|---|
| `Placed in your input box — read it, then press Enter to send.` | any **draft** button |
| `Copied: <text>`, or `Could not copy (<reason>) — <text>` | any **copy** button |
| `Context audit saved · $0.12 · <path>` | an AI audit |
| `Context doctor: deep-dive ready · $0.05 · added to <path>` | a deep-dive |
| `The context doctor is already working — one moment.` | asking again while a call runs |

### Running it

```
/context-doctor                          # open, scan, and wait for "ask AI"
/context-doctor ask                      # open and ask the AI straight away
/context-doctor --model=sonnet --effort=high ask
/context-doctor help                     # the usage line
```

`--model` takes `opus` (default: claude-opus-5-5), `sonnet`, `haiku`, `fable`, or any model id. `--effort` takes `low`,
`medium`, `high`, `xhigh` or `max`. Each run uses its own flags; nothing carries over from the last run. Each opening
starts with every finding closed, no filter and the full audit folded. While the AI works, the
[doctor's line in the bar](#the-doctors-line-in-the-bar) shows its progress, so the pane can be closed.

## Every button

| Button | Where | What it does |
|---|---|---|
| `▸` / `▾` | bar header | Shows or hides the categories. |
| the colour strip | bar | Shows or hides the categories. |
| **handoff & compact** | bar header | Handoff, then compact. [More](#handoff--compact) |
| **handoff & clear** | bar header | Handoff, then `/clear`. [More](#handoff--clear) |
| **recalculate** | limits line, right | Counts the context exactly, free. |
| a category | categories | Opens it under the list; a second press closes it. |
| **✕ close** | an open category | Closes it. |
| an item with `▸` | an open category | Opens its third level; a second press closes it. |
| the handoff path | result line | Opens the handoff file. |
| **Continue** | after `/clear` or in a new session | Puts the request to resume from the handoff in your prompt box. |
| the doctor's line | bar, while or after an AI call | Opens or closes its panel. |
| **draft** | the doctor's panel in the bar | Puts that action's instruction in your prompt box. |
| **[copy path]** | the doctor's panel in the bar | Copies the audit file's path. |
| **[open doctor]** | the doctor's panel in the bar | Opens the context doctor pane. |
| **✕** | beside the doctor's line | Removes the line. |
| every button in the doctor's pane | `/context-doctor` | See [The doctor's buttons](#the-doctors-buttons). |

## Commands

| Command | What it does |
|---|---|
| `/context-bar` | Show the bar (or open it as a pane in VS Code and on mobile) |
| `/context-bar off` (or `hide`) | Hide the bar |
| `/context-bar pane` | Open the bar as a pane |
| `/context-bar recalculate` (or `exact`) | Count the context exactly with the free token-count API |
| `/context-bar handoff` | Start **handoff & clear** now |
| `/context-bar status` | What the bar sees: version, what is running, the suggestion, the last handoff and how it ended, open tasks, settings |
| `/context-doctor [--model=…] [--effort=…] [ask]` | Open the context doctor ([Running it](#running-it)) |
| `/context-doctor help` | The doctor's usage line |

## Settings

Set in `/config`, under the plugin's options.

| Setting | Key | Default | What it changes |
|---|---|---|---|
| Suggest compacting at (tokens of conversation) | `suggest_compact_at_tokens` | 80,000 | The smallest conversation for which a commit, push or skill run is suggested |
| Long output tip at (tokens in one tool result) | `long_output_tokens` | 15,000 | When the [long output tip](#other-messages) appears |
| Long skill run (minutes) | `long_skill_run_minutes` | 5 | How long a turn that used a skill must run to be suggested |
| Offer a handoff for (hours) | `offer_handoff_hours` | 6 | How long **Continue** is offered after a handoff |
| Handoff folder (relative to the repository) | `handoff_folder` | `.claude/knowledge/handoffs` | Where handoffs are saved |
| Commit handoffs | `commit_handoffs` | on | Whether each handoff is committed |

## Privacy and cost

- **The bar and the suggestions** run on your machine. They read Claude Code's own context breakdown, tool results
  and git. Nothing leaves your machine. **recalculate** uses Claude Code's token-count API, which is free.
- **A handoff** is one ordinary Claude turn, billed like any message. It is saved and committed locally; the bar never
  pushes.
- **The context doctor's findings** are computed locally. **✦ ask AI** sends one request to the chosen model with the
  measurements: category sizes, memory file paths with their section headings, sizes and opening lines, MCP server
  and tool names, skill and agent names, and which tools were used. A **deep-dive** sends that one file's full text.
  Each call's cost is estimated on its button before you press it, and the actual cost is shown afterwards at API
  list prices.

## Files it writes

| What | Where |
|---|---|
| Handoffs (in a git repository) | `<repo>/<handoff folder>/<name>-handoff.md`, committed by path |
| Handoffs (outside a repository) | `~/.claude/handoffs/<project>/` |
| A compaction's summary | `~/.claude/handoffs/<project>/<time>-compact.md` |
| Context doctor audits | `<repo>/.claude/knowledge/context-audits/` or `<repo>/.claude/context-audits/` |

The latest handoff per project, the last handoff run's outcome and the doctor's last AI run per project are kept in
Claude Code's plugin store, for **Continue**, `/context-bar status` and the doctor.

## Limitations

- The task-list copy starts when the bar loads. Tasks made before that in the same session are not carried.
- Colours are tuned for dark terminals: every button and the yellow line keep a 4.5 : 1 contrast on a dark background.
  Light themes are not tuned yet.
- Clicking a handoff path opens it with `open` (macOS) or `xdg-open` (Linux), in your default app for Markdown.
- The handoff path has no colour of its own until the pointer is over it: a button in Claude Code takes a colour only
  under the pointer.

## Troubleshooting

| Problem | What to do |
|---|---|
| No bar above the prompt | Run `/context-bar`. If it was hidden, this shows it. |
| The header says `unavailable: <reason>` | Claude Code did not give its context breakdown. `/context-bar recalculate` measures again. |
| Not sure which version is running | `/context-bar status` prints it on its first line. |
| `Handoff failed … is missing <section>` | Claude left a section or an open task out. The file is saved and flagged; nothing was compacted or cleared. Press the button again. |
| `not committed: <reason>` | The handoff is saved but git refused the commit (a hook, a merge in progress). Commit it yourself if you want it in git. |
| A suggestion seems missing | Something may still be running, or the conversation is under *Suggest compacting at*. `/context-bar status` shows what is busy and what is waiting to be offered. |
| `Could not open <path>` | Open the file yourself; the path is the whole line after `Handoff:`. |

## Develop

```bash
claude plugin validate context-bar      # manifest, hooks module, state contract
claude plugin test context-bar          # the test suite
tsc -p context-bar --noUnusedLocals     # after Claude Code has loaded the mod once (it writes the types)
```

`hooks/version.ts` must match `version` in `.claude-plugin/plugin.json`; `/context-bar status` prints it.

| File | What it holds |
|---|---|
| `hooks/register.tsx` | The hooks, and the engine access they use |
| `hooks/snapshot.ts`, `hooks/categories.ts` | Reading the context breakdown into rows, colours and lists |
| `hooks/barView.tsx`, `hooks/barClient.tsx`, `hooks/limitsView.tsx` | The bar, its clickable strip, and its limits line |
| `hooks/limits.ts` | The rate-limit windows and their colours |
| `hooks/compact.ts` | Compaction and handoff rules and wording (pure functions) |
| `hooks/compactFlow.ts`, `hooks/compactView.tsx` | The compact and handoff flow, and its line in the bar |
| `hooks/doctor.ts`, `hooks/doctorView.tsx`, `hooks/auditFile.ts` | The context doctor |
| `hooks/noticeView.tsx` | The doctor's progress and result in the bar |
| `hooks/errors.ts`, `hooks/version.ts` | Error text, and the mod's version |
| `types/index.d.ts` | The mod's state contract |
| `tests/` | The test suite (`claude plugin test`) |
