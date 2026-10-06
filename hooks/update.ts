// Keeps an installed copy of the bar current. At most once an hour (across sessions) it reads the version on GitHub;
// when that is newer than the one running, `claude plugin update` installs it in the background and the bar says so,
// as Claude Code does for its own updates: "✓ context-bar 0.18.0 installed · Run /reload-plugins ...". The running
// session keeps the version it loaded until /reload-plugins or a new session.
// A checkout loaded with --plugin-dir (or CLAUDE_CODE_PLUGIN_DIRS) is never updated: its git history is the person's.

import type { UpdateNotice } from '../types'
import { ago } from './compact'

/** The manifest of the branch installs come from: its `version` is the newest release. */
export const MANIFEST_URL = 'https://raw.githubusercontent.com/fatonsopa/claude-context-bar/main/.claude-plugin/plugin.json'
/** Where the last check is kept in `$.store`, shared by every session. */
export const UPDATE_KEY = 'update:last'
export const CHECK_EVERY_MS = 60 * 60_000

/** The last check, in `$.store`. */
export type UpdateState = {
  checkedAt: number
  /** The newest version GitHub had at that check; null when it could not be read. */
  latest: string | null
  /** The version `claude plugin update` installed, which a reload or a new session applies. */
  installed: string | null
  /** Why the last check or install failed; null when it did not. */
  error: string | null
}

const NONE: UpdateState = { checkedAt: 0, latest: null, installed: null, error: null }

export function asUpdateState(v: unknown): UpdateState {
  if (!v || typeof v !== 'object') return NONE
  const o = v as Record<string, unknown>
  const text = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null)
  return {
    checkedAt: typeof o.checkedAt === 'number' && Number.isFinite(o.checkedAt) ? o.checkedAt : 0,
    latest: text(o.latest),
    installed: text(o.installed),
    error: text(o.error),
  }
}

/**
 * `context-bar@<marketplace>` when this copy was installed from a marketplace (it runs from the plugin cache,
 * `…/plugins/cache/<marketplace>/context-bar/<version>`); null for a checkout loaded with --plugin-dir.
 */
export function installedId(root: string): string | null {
  const m = /\/plugins\/cache\/([^/]+)\/context-bar\/[^/]+\/?$/.exec(root)
  return m ? `context-bar@${m[1]}` : null
}

function parts(version: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Whether `a` is a later release than `b` (major.minor.patch); false when either is not a version. */
export function isNewer(a: string, b: string): boolean {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** The `version` of a plugin.json; null when the text is not one. */
export function versionOf(manifest: string): string | null {
  try {
    const v = (JSON.parse(manifest) as { version?: unknown }).version
    return typeof v === 'string' && parts(v) ? v : null
  } catch {
    return null
  }
}

/** The result line `claude plugin update --json` prints: `{ outcome, newVersion, message, ... }`. */
export type UpdateResult = { outcome: string; newVersion: string | null; message: string | null }

export function parseUpdate(stdout: string): UpdateResult | null {
  const lines = stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('{'))
  for (const line of lines.reverse()) {
    try {
      const o = JSON.parse(line) as Record<string, unknown>
      if (typeof o.outcome !== 'string') continue
      return {
        outcome: o.outcome,
        newVersion: typeof o.newVersion === 'string' ? o.newVersion : null,
        message: typeof o.message === 'string' ? o.message : null,
      }
    } catch {
      // not the result line
    }
  }
  return null
}

/** What a check needs from the engine; built in `session.start`, as closures over its `$`. */
export type UpdateOps = {
  /** The plugin's directory (`$.plugin.root`). */
  root: string
  /** The version running now. */
  version: string
  /** The `auto_update` option: false only says a new version is out. */
  isAutomatic: boolean
  now: () => Promise<number>
  fetch: (url: string) => Promise<{ ok: boolean; text: string }>
  run: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  show: (notice: UpdateNotice | null) => Promise<unknown>
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * One check: shows a version an earlier check installed, reads GitHub when the last read is an hour old (or
 * `force`), and installs a newer version when updates are automatic. Never throws; a failure is kept for
 * `/context-bar status`.
 */
export async function checkForUpdate(o: UpdateOps, force = false): Promise<void> {
  const id = installedId(o.root)
  if (!id) return
  const stored = asUpdateState(await o.storeGet(UPDATE_KEY).catch(() => null))
  if (stored.installed && isNewer(stored.installed, o.version)) {
    await o.show({ state: 'installed', version: stored.installed, id })
    return
  }
  const now = await o.now()
  if (!force && now - stored.checkedAt < CHECK_EVERY_MS) {
    if (stored.latest && isNewer(stored.latest, o.version)) await o.show({ state: 'available', version: stored.latest, id })
    return
  }
  let latest: string | null = null
  try {
    const r = await o.fetch(MANIFEST_URL)
    latest = r.ok ? versionOf(r.text) : null
    if (!latest) throw new Error(r.ok ? 'GitHub returned no version' : 'GitHub could not be reached')
  } catch (err) {
    await o.storeSet(UPDATE_KEY, { ...stored, checkedAt: now, error: errorOf(err) })
    return
  }
  if (!isNewer(latest, o.version)) {
    await o.storeSet(UPDATE_KEY, { ...stored, checkedAt: now, latest, error: null })
    return
  }
  if (!o.isAutomatic) {
    await o.storeSet(UPDATE_KEY, { ...stored, checkedAt: now, latest, error: null })
    await o.show({ state: 'available', version: latest, id })
    return
  }
  // `claude plugin update` fetches the marketplace and installs the new version beside the running one
  let error: string | null = null
  let installed: string | null = null
  try {
    const r = await o.run(['claude', 'plugin', 'update', id, '--json'])
    const result = parseUpdate(r.stdout) ?? parseUpdate(r.stderr)
    const done = result && (result.outcome === 'updated' || result.outcome === 'up_to_date')
    installed = done ? (result.newVersion ?? latest) : null
    if (!installed || !isNewer(installed, o.version)) {
      installed = null
      error = result?.message ?? (r.stderr.trim() || `claude plugin update exited with ${r.exitCode}`)
    }
  } catch (err) {
    error = errorOf(err)
  }
  await o.storeSet(UPDATE_KEY, { checkedAt: now, latest, installed, error })
  await o.show(installed ? { state: 'installed', version: installed, id } : { state: 'available', version: latest, id })
}

/** The `/context-bar status` line. */
export function updateStatus(a: { root: string; version: string; isAutomatic: boolean; state: UpdateState; now: number }): string {
  if (!installedId(a.root)) return 'Updates: none for a --plugin-dir checkout (git pull it)'
  const mode = a.isAutomatic ? 'automatic' : 'off (the bar says when one is out)'
  const s = a.state
  const checked = s.checkedAt > 0 ? `checked ${ago(a.now - s.checkedAt)}` : 'not checked yet'
  const latest = s.latest ? ` · newest ${s.latest}` : ''
  const pending = s.installed && isNewer(s.installed, a.version) ? ` · ${s.installed} installed, /reload-plugins applies it` : ''
  const error = s.error ? ` · last error: ${s.error}` : ''
  return `Updates: ${mode} · ${checked}${latest}${pending}${error}`
}
