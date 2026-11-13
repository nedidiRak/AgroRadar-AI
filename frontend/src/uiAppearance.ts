/** Presentation-only visual preferences, scoped to the browser and account. */
export type UiTheme = 'forest' | 'ocean' | 'graphite'
export type UiFontSize = 'standard' | 'comfortable' | 'large'
export type UiAppearance = { theme: UiTheme; fontSize: UiFontSize }

export const DEFAULT_APPEARANCE: UiAppearance = { theme: 'forest', fontSize: 'comfortable' }
export const UI_THEMES: readonly UiTheme[] = ['forest', 'ocean', 'graphite']
export const UI_FONT_SIZES: readonly UiFontSize[] = ['standard', 'comfortable', 'large']

export function appearanceStorageKey(username: string | null | undefined): string {
  return 'agroradar.ui.appearance.v1.' + encodeURIComponent(username || 'guest')
}

export function loadAppearance(storage: Pick<Storage, 'getItem'> | null, username: string | null | undefined): UiAppearance {
  if (!storage) return { ...DEFAULT_APPEARANCE }
  try {
    const raw = storage.getItem(appearanceStorageKey(username))
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_APPEARANCE }
    const fields = value as Record<string, unknown>
    return {
      theme: UI_THEMES.includes(fields.theme as UiTheme) ? fields.theme as UiTheme : DEFAULT_APPEARANCE.theme,
      fontSize: UI_FONT_SIZES.includes(fields.fontSize as UiFontSize) ? fields.fontSize as UiFontSize : DEFAULT_APPEARANCE.fontSize,
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearance(storage: Pick<Storage, 'setItem'> | null, username: string | null | undefined, appearance: UiAppearance): void {
  if (!storage) return
  try {
    storage.setItem(appearanceStorageKey(username), JSON.stringify(appearance))
  } catch {
    // Storage may be disabled or full; visual settings are never critical.
  }
}
