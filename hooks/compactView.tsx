// The compact suggestion, drawn in the bar under the limits line: what just finished, how full the context is, and
// which of the top line's buttons (now lit) fits. The actions live only in the top line, never repeated here. The one
// button here is Continue after /clear, which exists nowhere else. A suggestion stays until it is acted on, a
// compaction shrinks the context, or a newer moment replaces it; it shows its age once a minute has passed.
import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { CompactTip } from '../types'
import { WARN } from './categories'
import { tipText } from './compact'

type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export type CompactArgs = {
  els: Els
  tip: CompactTip | null
  /** What the bar is doing right now, in words, or null. */
  running: string | null
  /** The last result (a handoff, a compaction, a clear), until the person's next message. */
  result: string | null
  /** The handoff file the message names: wherever its path appears, pressing it opens the file. */
  link: string | null
  /** A turn is running: buttons that act on the conversation wait until it ends. */
  isWorking: boolean
  now: number
  on: {
    resume: () => void
    /** Opens a file in the computer's default app for it. */
    open: (path: string) => void
  }
}

/** Everything on this line (a suggestion, what the bar is doing, what it did): the theme's warning colour, no background. */
export const MESSAGE_FG = WARN

/**
 * One line of a message, its handoff path (if it names it) drawn once and pressable: a press opens the file. A
 * Button, not a Link: a terminal without hyperlinks (macOS Terminal) draws a Link's text and then its URL again, and
 * neither can be clicked; a Button is pressed by a click on every terminal.
 *
 * The row wraps: when the words and the path do not fit side by side, the path moves under the words, whole. Without
 * it the row squeezes the words into a narrow column beside the path ("Handoff / completed on / October 6, / ...").
 */
function messageLine(a: CompactArgs, line: string, i: number): RenderElement {
  const { Box, Text, Button } = a.els
  const link = a.link
  const at = link ? line.indexOf(link) : -1
  if (!link || at < 0) {
    return (
      <Box key={`compact-line-${i}`}>
        <Text color={MESSAGE_FG} wrap="wrap">
          {line}
        </Text>
      </Box>
    )
  }
  const before = line.slice(0, at)
  const after = line.slice(at + link.length)
  return (
    <Box key={`compact-line-${i}`} flexDirection="row" flexWrap="wrap">
      {before ? <Text color={MESSAGE_FG}>{before}</Text> : null}
      <Button key={`compact-open-${i}`} plain label={link} hover={{ color: MESSAGE_FG, underline: true }} onPress={() => a.on.open(link)} />
      {after ? <Text color={MESSAGE_FG}>{after}</Text> : null}
    </Box>
  )
}

export function compactLine(a: CompactArgs): RenderElement | null {
  const { Box, Text, Button } = a.els
  // what is happening now, else the last result; a message may hold several lines
  const message = a.running ?? a.result
  // the suggestion (or the offer to continue) under the result, never hidden by it: after "handoff & clear" the new
  // conversation shows both "Clear completed" and Continue. Not while the bar is working, nor while Claude is.
  const tip = a.tip && !a.running && !a.isWorking ? a.tip : null
  if (!message && !tip) return null
  return (
    <Box key="compact" marginTop={1} flexDirection="column">
      {message?.split('\n').map((line, i) => messageLine(a, line, i))}
      {tip && (
        <Box key="compact-tip" flexDirection="row" columnGap={2}>
          <Box key="compact-text">
            <Text color={MESSAGE_FG} wrap="wrap">
              {tipText(tip, a.now)}
            </Text>
          </Box>
          {tip.reason === 'resume' && <Button key="compact-resume" variant="primary" label="Continue" onPress={() => a.on.resume()} />}
        </Box>
      )}
    </Box>
  )
}
