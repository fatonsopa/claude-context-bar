// One way to turn anything thrown into a line of text, shared by every module.

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
