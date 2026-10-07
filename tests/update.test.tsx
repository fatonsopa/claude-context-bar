import { expect, test } from 'claude-code/testing'
import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { UpdateNotice } from '../types'
import {
  CHECK_EVERY_MS,
  MANIFEST_URL,
  UPDATE_KEY,
  asUpdateState,
  checkForUpdate,
  installedId,
  isNewer,
  parseUpdate,
  updateStatus,
  versionOf,
} from '../hooks/update'
import type { UpdateOps } from '../hooks/update'
import { installedText, updateLine } from '../hooks/updateView'
import { GOOD } from '../hooks/categories'
import { MEASURE, START, USAGE, engine, run } from './fixtures'

const INSTALLED = '/Users/someone/.claude/plugins/cache/claude-context-bar/context-bar/0.18.0'
const CHECKOUT = '/Users/someone/.claude/mods/context-bar'
const ID = 'context-bar@claude-context-bar'
const NOW = Date.parse('2026-10-07T12:00:00Z')

// ------------------------------------------------------------------ pure helpers

test('installedId names an installed copy and leaves a --plugin-dir checkout alone', () => {
  expect(installedId(INSTALLED)).toBe(ID)
  expect(installedId(`${INSTALLED}/`)).toBe(ID)
  expect(installedId('/home/me/.config/claude/plugins/cache/my-fork/context-bar/1a2b3c4d5e6f')).toBe('context-bar@my-fork')
  expect(installedId(CHECKOUT)).toBeNull()
  expect(installedId('/Users/someone/.claude/plugins/cache/claude-context-bar/other-plugin/1.0.0')).toBeNull()
})

test('isNewer compares major, minor and patch as numbers', () => {
  expect(isNewer('0.18.0', '0.17.8')).toBe(true)
  expect(isNewer('0.17.10', '0.17.9')).toBe(true)
  expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  expect(isNewer('0.17.8', '0.17.8')).toBe(false)
  expect(isNewer('0.17.7', '0.17.8')).toBe(false)
  expect(isNewer('main', '0.17.8')).toBe(false)
})

test('versionOf reads a plugin.json; parseUpdate reads the --json result line', () => {
  expect(versionOf('{ "name": "context-bar", "version": "0.18.0" }')).toBe('0.18.0')
  expect(versionOf('404: Not Found')).toBeNull()
  expect(versionOf('{ "name": "context-bar" }')).toBeNull()
  const out = 'Checking for updates…\n{"outcome":"updated","pluginId":"context-bar@claude-context-bar","oldVersion":"0.17.8","newVersion":"0.18.0","message":"Updated"}\n'
  expect(parseUpdate(out)).toEqual({ outcome: 'updated', newVersion: '0.18.0', message: 'Updated' })
  expect(parseUpdate('no json here')).toBeNull()
})

test('asUpdateState keeps only a well-formed record', () => {
  expect(asUpdateState(null)).toEqual({ checkedAt: 0, latest: null, installed: null, error: null })
  expect(asUpdateState({ checkedAt: 5, latest: '0.18.0', installed: 7, error: '' })).toEqual({ checkedAt: 5, latest: '0.18.0', installed: null, error: null })
})

// ------------------------------------------------------------------ checkForUpdate

type Fake = {
  ops: UpdateOps
  fetched: string[]
  ran: string[][]
  store: Record<string, unknown>
  shown: (UpdateNotice | null)[]
  clock: { now: number }
}

function fake(opts: { root?: string; version?: string; isAutomatic?: boolean; github?: string | null; update?: { stdout: string; exitCode?: number; stderr?: string } }): Fake {
  const f: Omit<Fake, 'ops'> = { fetched: [], ran: [], store: {}, shown: [], clock: { now: NOW } }
  const ops: UpdateOps = {
    root: opts.root ?? INSTALLED,
    version: opts.version ?? '0.17.8',
    isAutomatic: opts.isAutomatic ?? true,
    now: async () => f.clock.now,
    fetch: async url => {
      f.fetched.push(url)
      if (opts.github === null) throw new Error('network down')
      return { ok: true, text: JSON.stringify({ name: 'context-bar', version: opts.github ?? '0.18.0' }) }
    },
    run: async argv => {
      f.ran.push([...argv])
      const u = opts.update ?? { stdout: '{"outcome":"updated","newVersion":"0.18.0","message":"Updated"}' }
      return { exitCode: u.exitCode ?? 0, stdout: u.stdout, stderr: u.stderr ?? '' }
    },
    storeGet: async key => f.store[key],
    storeSet: async (key, value) => {
      f.store[key] = value
    },
    show: async n => {
      f.shown.push(n)
    },
  }
  return { ...f, ops }
}

test('a newer version on GitHub is installed in the background and announced', async () => {
  const f = fake({})
  await checkForUpdate(f.ops)
  expect(f.fetched).toEqual([MANIFEST_URL])
  expect(f.ran).toEqual([['claude', 'plugin', 'update', ID, '--json']])
  expect(f.shown).toEqual([{ state: 'installed', version: '0.18.0', id: ID }])
  expect(asUpdateState(f.store[UPDATE_KEY])).toEqual({ checkedAt: NOW, latest: '0.18.0', installed: '0.18.0', error: null })

  // the next check (another session, or an hour later) shows it again without fetching or installing
  f.clock.now += 2 * CHECK_EVERY_MS
  await checkForUpdate(f.ops)
  expect(f.fetched).toHaveLength(1)
  expect(f.ran).toHaveLength(1)
  expect(f.shown[1]).toEqual({ state: 'installed', version: '0.18.0', id: ID })
})

test('once the new version runs, nothing is shown and GitHub is read at most once an hour', async () => {
  const f = fake({ version: '0.18.0' })
  await checkForUpdate(f.ops)
  expect(f.ran).toEqual([])
  expect(f.shown).toEqual([])
  f.clock.now += CHECK_EVERY_MS - 1
  await checkForUpdate(f.ops)
  expect(f.fetched).toHaveLength(1)
  f.clock.now += 1
  await checkForUpdate(f.ops)
  expect(f.fetched).toHaveLength(2)
  // asked for (/context-bar update), it reads GitHub at once
  await checkForUpdate(f.ops, true)
  expect(f.fetched).toHaveLength(3)
})

test('a --plugin-dir checkout is never checked or updated', async () => {
  const f = fake({ root: CHECKOUT })
  await checkForUpdate(f.ops, true)
  expect(f.fetched).toEqual([])
  expect(f.ran).toEqual([])
  expect(f.shown).toEqual([])
})

test('with automatic updates off, the bar only says a new version is out', async () => {
  const f = fake({ isAutomatic: false })
  await checkForUpdate(f.ops)
  expect(f.ran).toEqual([])
  expect(f.shown).toEqual([{ state: 'available', version: '0.18.0', id: ID }])
})

test('a failed install says the version is out and keeps the reason', async () => {
  const f = fake({ update: { stdout: '{"outcome":"failed","message":"git-auth-failed"}', exitCode: 1 } })
  await checkForUpdate(f.ops)
  expect(f.shown).toEqual([{ state: 'available', version: '0.18.0', id: ID }])
  expect(asUpdateState(f.store[UPDATE_KEY]).error).toBe('git-auth-failed')
})

test('GitHub out of reach shows nothing and keeps the reason for /context-bar status', async () => {
  const f = fake({ github: null })
  await checkForUpdate(f.ops)
  expect(f.shown).toEqual([])
  const state = asUpdateState(f.store[UPDATE_KEY])
  expect(state.error).toBe('network down')
  expect(updateStatus({ root: INSTALLED, version: '0.17.8', isAutomatic: true, state, now: NOW + 12 * 60_000 })).toBe(
    'Updates: automatic · checked 12 min ago · last error: network down',
  )
})

// ------------------------------------------------------------------ the line in the bar

type Drawn = { type: string; props: Record<string, unknown>; children: unknown[] }

function el(type: string) {
  return (props: object): RenderElement => {
    const { children, ...rest } = props as { children?: unknown }
    const list = children === undefined ? [] : Array.isArray(children) ? children : [children]
    return { type, props: rest, children: list } as unknown as RenderElement
  }
}

const ELS = {
  Box: el('Box') as ElementConstructor<BoxProps>,
  Text: el('Text') as ElementConstructor<TextProps>,
  Button: el('Button') as ElementConstructor<ButtonProps>,
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'children' in node) return textOf((node as Drawn).children)
  return ''
}

const ON = { dismiss: () => {}, copy: () => {} }

test('the bar says the update is installed and how to apply it, in the theme success colour', () => {
  const line = updateLine({ els: ELS, notice: { state: 'installed', version: '0.18.0', id: ID }, on: ON }) as unknown as Drawn
  const text = line.children[0] as Drawn
  expect(textOf(text)).toBe('✓ context-bar 0.18.0 installed · Run /reload-plugins or start a new session to apply')
  expect(text.props.color).toBe(GOOD)
  expect(installedText('0.18.0')).toBe(textOf(text))
  expect(updateLine({ els: ELS, notice: null, on: ON })).toBeNull()
})

test('a version that is out but not installed comes with the command to install it', () => {
  const line = updateLine({ els: ELS, notice: { state: 'available', version: '0.18.0', id: ID }, on: ON }) as unknown as Drawn
  expect(textOf(line.children[0])).toBe(`context-bar 0.18.0 is out · claude plugin update ${ID}`)
  expect((line.children[1] as Drawn).props.label).toBe('[copy]')
})

// ------------------------------------------------------------------ the commands

test('/context-bar update on a --plugin-dir checkout says to git pull it', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/tmp' }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  const updated = await $.command.run(run('update'))
  expect(updated.text).toMatch(/a --plugin-dir checkout: git pull it to update\.$/)
})

test('/context-bar typed through Remote Control says the claude.ai browser view draws no plugin UI', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }))
  on('session.cwd', () => ({ value: '/tmp' }))
  engine(on)
  await $.session.start(START)
  await $.session.measure(MEASURE)
  expect((await $.command.run(run(''))).text).toBe('Context bar shown above the prompt.')
  const fromBridge = await $.command.run({ ...run(''), origin: { kind: 'bridge' } })
  expect(fromBridge.text).toBe('Context bar shown above the prompt in the terminal or Claude Code Desktop. The claude.ai browser view draws no plugin UI.')
})
