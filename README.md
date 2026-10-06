# ai-dev-architecture

Claude Code mods for long, careful work with AI: see what fills the context window, and carry work across
compactions and new sessions without losing decisions, approvals or open tasks.

![The context bar above the Claude Code prompt](context-bar/docs/images/bar.png)

## Mods

| Mod | What it does | Docs |
|---|---|---|
| **context-bar** | A live context-window bar above the prompt; **handoff & compact** and **handoff & clear** buttons that write a checked handoff (open tasks included) and suggest themselves at natural stopping points; and `/context-doctor`, an audit of what fills the context with AI recommendations you can act on. | [context-bar/README.md](context-bar/README.md) |

## Install

In Claude Code:

```
/plugin install context-bar --marketplace fatonsopa/ai-dev-architecture
```

Answer `y` to add the marketplace, then pick a scope. `.claude-plugin/marketplace.json` lists every mod in this
repository.

## Requirements

- Claude Code with mods (function-hook plugins). Built and tested on Claude Code 2.1.292.
- git, for the commit and push signals and for committing handoffs.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: one entry per mod
context-bar/                       the context-bar mod (manifest, hooks, tests, docs)
CHANGELOG.md                       every release, newest first
```

## Develop

Run a mod from this checkout by naming its folder in `CLAUDE_CODE_PLUGIN_DIRS` (in `~/.claude/settings.json`, under
`env`), or with `claude --plugin-dir <this repo>/context-bar`. Edits reload when the turn that made them ends.

```bash
claude plugin validate context-bar
claude plugin test context-bar
```

Each change bumps the mod's version (`.claude-plugin/plugin.json` and `hooks/version.ts`), passes the tests, gets a
[changelog](CHANGELOG.md) entry, and is committed and pushed.
