# context-bar

A Claude Code mod: a live context bar above the prompt, `/context-doctor`, and compact and handoff suggestions at
natural stopping points. It works in any project: every signal it reads is one Claude Code or git gives everywhere.

## Compact and handoff suggestions

The bar's top line always has two buttons, styled like the categories (a coloured ■, then the label, which lights up
in that colour under the pointer), with a | between them:

- **handoff & compact**: Claude writes a handoff for the work, it is saved (and committed), then the conversation is
  compacted.
- **handoff & clear**: the same handoff, then `/clear` goes in the prompt box for your Enter.

At a good moment the right button's ■ becomes ▣ and a yellow line under the colour strip says what just finished,
and nothing more: "✓ Changes committed", "✓ Pushed to GitHub" (the host is read from the push, or asked of git when the output is cut; any remote works),
"✓ /<skill> finished". There is no Later: the suggestion stays until you press one of the two buttons, a compaction
shrinks the context, or a newer moment replaces it.

| When | The bar offers |
|---|---|
| A `git commit` succeeded | **handoff & compact** lights up |
| A `git push` sent something | **handoff & compact** and **handoff & clear** light up |
| A turn that used a skill ran longer than *Long skill run* | **handoff & compact** and **handoff & clear** light up |
| `/clear` or a fresh `claude` start, with a handoff newer than *Offer a handoff for* | **Continue** (in the line below) |

Nothing is suggested while a turn runs, while subagents or background commands are still running, during a git merge
or rebase, or while the last test run failed. A moment that comes while work is running is offered as soon as it
finishes (a background command counts until its end notification arrives). Typing `/compact` at such a time shows a
warning and still compacts.

`/context-bar handoff` starts the handoff below at any time; `/context-bar status` prints what the bar sees (what is
running, what suggestion waits, the last handoff, the settings).

- **handoff & compact** first has Claude write the handoff (as below), then compacts with a keep list (modes such as `#autonomous`, approvals quoted, the plan and its steps,
  running subagents, open errors, files and backups) and puts the git state back after the summary. Every
  compaction, typed or automatic, gets the keep list; a project's own rules belong in its CLAUDE.md
  ("Compact Instructions"). The summary is saved to `~/.claude/handoffs/<project>/<time>-compact.md`.
- **handoff & compact** / **handoff & clear**: Claude writes the handoff with the Write tool to a hidden draft in the
  handoff folder (one collapsed Write in the transcript, a one-line reply; the handoff is never printed), in fixed
  sections following Anthropic's guidance for carrying work across sessions. The bar checks the required sections,
  saves it as `<name>-handoff.md`, removes the draft, commits that one file by path, and reports
  "Handoff completed on <date, time>: <full path>", with "Compacting… this can take a minute." on the line under it
  (or it runs `/clear`). When it ends: "Compact completed on <date, time>: context went from 89% to 2%." (or "Clear
  completed on …") and "Handoff: <full path>" under it. Every handoff path in the bar is a link that opens the file.
  The whole line (suggestions included) is yellow text, with no background. A failed commit is only a note on the handoff line
  ("not committed: <reason>"); a missing or incomplete handoff stops the action and says so ("Handoff failed on …").
  `/context-bar status` shows how the last run ended. A compaction you type, or an automatic one, ends with
  "Handoff: <path>" naming the summary file it saved.

- **Open tasks** carry across a handoff. The bar keeps an exact copy of the session's task list (every `TaskCreate`,
  `TaskUpdate` and `TodoWrite`; a subagent's own tasks are left out). A handoff then needs an "Open tasks" section
  naming each open task by its exact subject, with its status and the context to pick it up cold; one left out stops
  the handoff ("is missing open task …"). The bar appends "Task list to recreate on resume": the open tasks exactly as
  the list held them (subject, description, activeForm, status, blocked by), and "Continue" asks the next session to
  recreate them first. `/context-bar status` shows how many open tasks the next handoff carries. The copy starts empty
  after `/clear` or a fresh start, like Claude Code's own list; tasks made before the bar loaded are not in it.

`recalculate` sits at the right end of the limits line.

## Settings (`/config`)

| Setting | Default |
|---|---|
| Suggest compacting at (tokens of conversation) | 80,000 |
| Long output tip at (tokens in one tool result) | 15,000 |
| Long skill run (minutes) | 5 |
| Offer a handoff for (hours) | 6 |
| Handoff folder (relative to the repository) | `.claude/knowledge/handoffs` |
| Commit handoffs | on |

## Develop

```bash
claude plugin validate ~/.claude/mods/context-bar
claude plugin test ~/.claude/mods/context-bar
tsc -p ~/.claude/mods/context-bar --noUnusedLocals
# the version /context-bar status shows must equal the manifest's
grep -q "'$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ~/.claude/mods/context-bar/.claude-plugin/plugin.json)'" ~/.claude/mods/context-bar/hooks/version.ts && echo version ok
```

| File | What it holds |
|---|---|
| `hooks/register.tsx` | the hooks and the engine access they build |
| `hooks/snapshot.ts`, `hooks/barView.tsx` | the context reading and the bar |
| `hooks/compact.ts` | compaction rules and wording (pure functions) |
| `hooks/compactFlow.ts`, `hooks/compactView.tsx` | the compaction and handoff flow, and its line in the bar |
| `hooks/doctor*.ts*`, `hooks/auditFile.ts`, `hooks/notice*` | `/context-doctor` |
