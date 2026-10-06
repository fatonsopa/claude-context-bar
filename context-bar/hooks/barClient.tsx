// The context bar's coloured track, drawn by the surface itself so the bar can be clicked: a click anywhere on it
// tells the hooks module to show or hide the categories. Runs on the surface (terminal, desktop): no `$` here.

import type { ClientModule } from 'claude-code'

import { TOGGLE } from './categories'

export type BarClientProps = { runs: { ch: string; color: string }[] }

const Bar: ClientModule<BarClientProps> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'down' && (e.button === undefined || e.button === 'left')) surface.post(TOGGLE)
  })
  return (
    <Text wrap="truncate">
      {props.runs.map(r => (
        <Text color={r.color}>{r.ch}</Text>
      ))}
    </Text>
  )
}

export default Bar
