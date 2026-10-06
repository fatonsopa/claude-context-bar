# Claude Code Plugin Documentation & Tone Style Guide

## 1. Core Directives

* **Eliminate Narrative Preambles:** Do not write introductory or transition phrases (e.g., "Sure, let's look into that", "Based on the context above", "As an AI, I can"). Start directly with the data, command, or action.
* **Remove Artificial Intensity / Buzzwords:** Ban words like "crucial," "paramount," "revolutionize," "delve," "testament," "vibrant," and "seamless." Replace them with explicit technical descriptors or omit them entirely.
* **Stop Creating Non-Words:** Do not invent pseudo-technical shorthand or brief nonsense fragments that lack grammatical meaning in a terminal console context.
* **Enforce Active Imperative Voice:** Write instructions as direct commands to the operator or system (e.g., "Run `/reload` to apply updates," not "You can run `/reload` if you want the updates to be applied").
* **Anchor with Monospace Syntax:** Every actionable component, command, directory path, or variable must be explicitly enclosed within markdown backticks (`code`) to preserve technical accuracy and eliminate ambiguity.

## 2. AI Slop Transformation Reference

| Fluffy / Conversational Pattern (Before) | Strict Technical Reference (After) |
| :--- | :--- |
| "Running `/clear` or starting a new session avoids that summary, but the new conversation knows nothing about the previous one, so you have to explain the goal..." | "`/clear` flushes the active context window. New sessions require explicit context re-initialization (e.g., goals, status, next steps)." |
| "Part of the context is taken before the conversation even starts: memory files such as `CLAUDE.md`... cost tokens on every turn and bring auto-compact closer." | "Pre-turn overhead: `CLAUDE.md`, active MCP server tool definitions, and baseline skills consume static tokens on every request cycle, accelerating auto-compaction." |
| "Once the conversation itself passes 80,000 tokens (you can change this), the bar suggests compacting after a commit..." | "Threshold Alert: At 80,000 tokens (configurable), the system prompts for proactive compaction following a commit, push, or extended skill execution." |
| "While the doctor's AI works, a line shows its progress. Press it for the summary..." | "Analysis Progress: A status indicator monitors active diagnostics. Select the indicator to view the summary pane." |

## 3. Configuration Rule Block (Copy-Paste)

Add this directly to your project `CLAUDE.md` or system prompt configurations to enforce this style automatically:

```markdown
[STYLE & TONE INSTRUCTIONS]
- Adopt a strict Technical Reference persona. 
- Eliminate all conversational filler, preambles, and conversational wrap-ups.
- Ban marketing buzzwords, hyperbolic adjectives, and speculative phrasing.
- Use short sentences with active, imperative verbs.
- Format all terminal commands, file paths, variables, and states in markdown backticks (`).
- Present multi-step procedures as direct, sequential, non-narrative instructions.
```
