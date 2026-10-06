// The compact suggestion, drawn in the bar under the limits line: what just finished, how full the context is, and
// which of the top line's buttons (now lit) fits. The actions live only in the top line, never repeated here. The one
// button here is Continue after /clear, which exists nowhere else. A suggestion stays until it is acted on, a
// compaction shrinks the context, or a newer moment replaces it; it shows its age once a minute has passed.
import type { BoxProps, ButtonProps, ElementConstructor, LinkProps, RenderElement, TextProps } from 'claude-code'

import type { Snapshot, CompactTip } from '../types'
import { fileUrl, tipText } from './compact'

type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Link: ElementConstructor<LinkProps>
}

export type CompactArgs = {
  els: Els
  tip: CompactTip | null
  /** What the bar is doing right now, in words, or null. */
  running: string | null
  /** The last result (a handoff, a compaction, a clear), until the person's next message. */
  result: string | null
  /** The handoff file the message names: wherever its path appears, it is a link that opens the file. */
  link: string | null
  /** A turn is running: buttons that act on the conversation wait until it ends. */
  isWorking: boolean
  snap: Snapshot | null
  now: number
  on: {
    resume: () => void
  }
}

/** Everything on this line (a suggestion, what the bar is doing, what it did): yellow text, no background. */
export const MESSAGE_FG = '#F2C76E'

/** One line of a message, its handoff path (if it names it) a link to the file. */
function messageLine(els: Els, line: string, link: string | null): RenderElement {
  const { Text, Link } = els
  const at = link ? line.indexOf(link) : -1
  if (!link || at < 0) return <Text color={MESSAGE_FG} wrap="wrap">{line}</Text>
  const before = line.slice(0, at)
  const after = line.slice(at + link.length)
  return (
    <Text color={MESSAGE_FG} wrap="wrap">
      {before || null}
      <Link href={fileUrl(link)}>{link}</Link>
      {after || null}
    </Text>
  )
}

export function compactLine(a: CompactArgs): RenderElement | null {
  const { Box, Text, Button } = a.els
  // what is happening now, else the last result, each on the band; a message may hold several lines
  const message = a.running ?? a.result
  if (message) {
    return (
      <Box key="compact" marginTop={1} flexDirection="column">
        {message.split('\n').map((line, i) => (
          <Box key={`compact-line-${i}`}>{messageLine(a.els, line, a.link)}</Box>
        ))}
      </Box>
    )
  }
  const tip = a.tip
  if (!tip || a.isWorking) return null
  return (
    <Box key="compact" marginTop={1} flexDirection="row" columnGap={2}>
      <Box key="compact-text">
        <Text color={MESSAGE_FG} wrap="wrap">
          {tipText(tip, a.snap, a.now)}
        </Text>
      </Box>
      {tip.reason === 'resume' && <Button key="compact-resume" variant="primary" label="Continue" onPress={() => a.on.resume()} />}
    </Box>
  )
}
