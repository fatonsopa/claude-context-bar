# Changelog

All notable changes to context-bar. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## context-bar

### [0.17.8] — 2026-10-07

#### Changed
- The repository is `fatonsopa/claude-context-bar` (was `fatonsopa/ai-dev-architecture`) and holds only this plugin,
  at its root. The marketplace is `claude-context-bar`: install with
  `/plugin install context-bar --marketplace fatonsopa/claude-context-bar`. If you installed from the
  `ai-dev-architecture` marketplace, remove it (`/plugin marketplace remove ai-dev-architecture`) and install again.

### [0.17.7] — 2026-10-07

#### Changed
- README follows the standard layout: what it is for and how it helps first, then contents, requirements, install
  (the `--marketplace` one-step form, the two-step form, the shell form, private-repository access), update and
  uninstall, usage, settings (`/plugin` → Configure options), privacy, contributing and license.

### [0.17.6] — 2026-10-07

#### Changed
- The documentation is one short README at the repository root, mostly tables; `context-bar/README.md` links to it.

### [0.17.5] — 2026-10-07

#### Changed
- README documents every button and every feature: the bar's header, badge colours, limits line, clickable strip,
  categories and their three levels, the doctor's line in the bar and its panel, when suggestions appear (the
  80,000-token minimum, the 10-minute pause after a compaction), every message the bar shows, everything the context
  doctor checks with its thresholds, every doctor button, and a table of every button.

### [0.17.4] — 2026-10-06

#### Added
- README: a screenshot of the **handoff & clear** result.

### [0.17.3] — 2026-10-06

#### Fixed
- The words before a handoff path ("Handoff completed on October 6, 11:50:41pm:") were squeezed into a narrow column
  beside the path when the two did not fit on one line. The words now stay on one line; when the path does not fit
  beside them, it starts on the next line, whole.

#### Added
- README: a screenshot of the **handoff & compact** result.

### [0.17.2] — 2026-10-06

#### Fixed
- The handoff path showed twice in terminals without clickable links (macOS Terminal): once, then again as a dimmed
  `file://` address, and neither could be clicked. The bar now shows the path once, and clicking it opens the file.

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
