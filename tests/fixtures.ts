import type { CommandRunInput, On, SessionContextBreakdown, SessionMeasureInput, SessionStartInput, SessionUsage } from 'claude-code'
import { mock } from 'claude-code/testing'

export const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 4200, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 17000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 52000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Custom agents', tokens: 3400, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 8600, color: 'warning', isDeferred: false, kind: 'used' },
    { name: 'Skills', tokens: 5100, color: 'suggestion', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 0, color: 'text', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 897000, color: 'subtle', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 13000, color: 'subtle', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 90300,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'auto',
  percentage: 9,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: '/Users/someone/projects/app/CLAUDE.md', type: 'Project', tokens: 8000 },
    { path: '/Users/someone/.claude/rules/style.md', type: 'User', tokens: 600 },
  ],
  mcpTools: [
    { name: 'mcp__ahrefs__a', serverName: 'claude.ai Ahrefs', tokens: 30000, isLoaded: true },
    { name: 'mcp__ahrefs__b', serverName: 'claude.ai Ahrefs', tokens: 2000, isLoaded: true },
    { name: 'mcp__pencil__a', serverName: 'pencil', tokens: 20000, isLoaded: true },
  ],
  agents: [{ agentType: 'Explore', source: 'projectSettings', tokens: 3400 }],
  skills: {
    totalSkills: 2,
    includedSkills: 2,
    tokens: 5100,
    skillFrontmatter: [
      { name: 'push-pipeline', source: 'projectSettings', tokens: 3000 },
      { name: 'design-system', source: 'projectSettings', tokens: 2100 },
    ],
  },
  autoCompactThreshold: 987000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

export const USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 90300, window: 1_000_000, percent: 9, breakdown: BREAKDOWN },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 18.5 },
    { kind: 'seven_day_fable', percentUsed: 7 },
  ],
  cost: { usd: 1.234 },
}

export const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 29 },
    view: {},
  },
} as const

export const MEASURE: SessionMeasureInput = {
  context: { tokens: 90300, window: 1_000_000, percent: 9 },
  rateLimits: [],
  changed: ['context'],
}

export const START: SessionStartInput = { cwd: '/tmp', surface: 'terminal', isInteractive: true }

export const run = (args: string): CommandRunInput => ({
  command: 'context-bar',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 110 },
})

/**
 * What the engine answers beneath the plugin when a session starts: the start itself, the clock (held, so the bar's
 * timer moves only when a test advances it) and command registration. Call it before the test's first `$` call.
 */
export function engine(on: On) {
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  return clock
}
