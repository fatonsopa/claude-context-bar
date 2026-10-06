# Changelog

All notable changes to the mods in this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## context-bar

### [0.17.1] — 2026-10-06

#### Fixed
- After **handoff & clear**, the "Clear completed" line hid the **Continue** offer, and the first message removed both,
  so the handoff could not be continued from the bar. The bar now shows its result with the suggestion (or the offer
  to continue) on the line under it.

### [0.17.0] — 2026-10-06

#### Added
- Open tasks carry across a handoff. The bar keeps an exact copy of the session's task list (`TaskCreate`,
  `TaskUpdate`, `TodoWrite`; a subagent's own tasks are left out).
- The handoff request lists the open tasks and requires an "Open tasks" section naming each by its exact subject; a
  handoff that leaves one out is flagged and nothing is compacted or cleared.
- The saved handoff ends with "Task list to recreate on resume" (subject, description, spinner text, status, blocked
  by), and **Continue** asks the next session to recreate those tasks first.
- `/context-bar status` shows how many open tasks the next handoff carries.

### [0.16.1] — 2026-10-06

#### Fixed
- "✓ Pushed to GitHub" lost its destination when the push output had no `To <remote>` line (`git push 2>&1 | tail -1`).
  The bar now asks git for the remote's address, in the folder the command ran in.

### [0.16.0] — 2026-10-06

#### Changed
- The suggestion line says only what finished: "✓ Changes committed", "✓ Pushed to GitHub", "✓ /<skill> finished".
  The advice, the refs, the context percentage and the age are gone; the marked button (▣) already shows which
  action fits.

### [0.15.1] — 2026-10-06

#### Changed
- The suggestion line is yellow text with no background, like the rest of that line.

### [0.15.0] — 2026-10-06

#### Changed
- While compacting, "Compacting… this can take a minute." has a line of its own under the saved handoff.
- A finished compaction reads "Compact completed on …: context went from X% to Y%." with "Handoff: <path>" under it.
- Status and result lines are yellow text with no background.

#### Added
- Every handoff path in the bar is a link that opens the file.

### 0.14.0 and earlier

Before 0.15.0 the mod was not kept in this repository. By 0.14.0 it had the context bar, `/context-doctor`, and the
compact and handoff suggestions with checked handoffs saved and committed in the project.

[0.17.1]: https://github.com/fatonsopa/ai-dev-architecture/compare/5dc4d19...main
[0.17.0]: https://github.com/fatonsopa/ai-dev-architecture/compare/746fb5d...5dc4d19
[0.16.1]: https://github.com/fatonsopa/ai-dev-architecture/compare/63dd66f...746fb5d
[0.16.0]: https://github.com/fatonsopa/ai-dev-architecture/compare/48ee9cf...63dd66f
[0.15.1]: https://github.com/fatonsopa/ai-dev-architecture/compare/5cd4524...48ee9cf
[0.15.0]: https://github.com/fatonsopa/ai-dev-architecture/commit/5cd4524
