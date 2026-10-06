# ai-dev-architecture

Claude Code mods. Each folder is one mod; `.claude-plugin/marketplace.json` lists them.

| Mod | What it does |
| --- | --- |
| [context-bar](context-bar/README.md) | A live context-window bar above the prompt, `/context-doctor`, and compact and handoff suggestions at natural stopping points. Works in any project. |

## Install

```
/plugin install context-bar --marketplace fatonsopa/ai-dev-architecture
```

Answer `y` to add the marketplace, then pick a scope.

## Develop

Run a mod from its folder: `CLAUDE_CODE_PLUGIN_DIRS=<this repo>/context-bar` (in `~/.claude/settings.json` under `env`),
or `claude --plugin-dir <this repo>/context-bar`.

```
claude plugin validate context-bar
claude plugin test context-bar
```

`context-bar/.claude-plugin/types/` is written by Claude Code when it loads the mod, so `tsc -p context-bar` works
after the first load.
