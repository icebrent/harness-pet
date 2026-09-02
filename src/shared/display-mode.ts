export const DISPLAY_MODES = ['chibi', 'kanban'] as const

export type DisplayMode = typeof DISPLAY_MODES[number]

export const DEFAULT_DISPLAY_MODE: DisplayMode = 'chibi'
export const KANBAN_CHARACTER_ID = 'qwen-purple' as const

export function parseDisplayMode(
  argv: readonly string[],
  warn: (message: string) => void = console.warn,
): DisplayMode {
  const inlineArgument = argv.find(argument => argument.startsWith('--mode='))
  const separateIndex = argv.indexOf('--mode')
  const value = inlineArgument?.slice('--mode='.length)
    ?? (separateIndex >= 0 ? argv[separateIndex + 1] : undefined)

  if (value === undefined) return DEFAULT_DISPLAY_MODE
  if (DISPLAY_MODES.includes(value as DisplayMode)) return value as DisplayMode

  warn(`Unknown display mode '${value || '(empty)'}'; falling back to chibi.`)
  return DEFAULT_DISPLAY_MODE
}

export function randomMovementEnabled(mode: DisplayMode): boolean {
  return mode === 'chibi'
}
