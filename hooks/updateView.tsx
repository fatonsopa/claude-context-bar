// A new version of the bar, announced in the bar: installed and waiting for a reload, in the words Claude Code uses
// for its own updates, or out but not installed (automatic updates off, or the install failed), with the command.

import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { UpdateNotice } from '../types'
import { GOOD, WARN } from './categories'

type Els = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }

export type UpdateArgs = {
  els: Els
  notice: UpdateNotice | null
  on: {
    dismiss: () => void
    copy: (text: string, surface: RenderSurface) => void
  }
}

export function installedText(version: string): string {
  return `✓ context-bar ${version} installed · Run /reload-plugins or start a new session to apply`
}

export function updateCommand(id: string): string {
  return `claude plugin update ${id}`
}

export function updateLine(a: UpdateArgs): RenderElement | null {
  const n = a.notice
  if (!n) return null
  const { Box, Text, Button } = a.els
  if (n.state === 'installed') {
    return (
      <Box key="update" flexDirection="row" columnGap={1}>
        <Text color={GOOD} wrap="truncate">
          {installedText(n.version)}
        </Text>
        <Button key="update-dismiss" plain dimColor label="✕" onPress={() => a.on.dismiss()} />
      </Box>
    )
  }
  const command = updateCommand(n.id)
  return (
    <Box key="update" flexDirection="row" columnGap={1}>
      <Text wrap="truncate">
        <Text color={WARN}>{`context-bar ${n.version} is out`}</Text>
        <Text dimColor>{` · ${command}`}</Text>
      </Text>
      <Button key="update-copy" plain dimColor label="[copy]" onPress={p => a.on.copy(command, p.surface)} />
      <Button key="update-dismiss" plain dimColor label="✕" onPress={() => a.on.dismiss()} />
    </Box>
  )
}
