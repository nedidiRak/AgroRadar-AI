/** Local, per-user presentation preferences. No server data or secrets stored here. */
export const UI_SETTINGS_VERSION = 1
export const UI_FLAGS = [
  'viewerNotice', 'weatherBadge', 'overviewStats', 'overviewFieldList',
  'overviewForecast', 'overviewRiskDetails', 'overviewHelp',
  'aiFieldPicker', 'aiMapShortcut', 'aiContext', 'aiSuggestions',
  'aiActions', 'aiTechnicalInfo', 'aiStatus', 'navLabels', 'footer',
] as const
export type UiFlag = typeof UI_FLAGS[number]
export type UiPreferences = Record<UiFlag, boolean>
export type UiPreset = 'compact' | 'balanced' | 'expert'

const compact: UiPreferences = {
  viewerNotice:false, weatherBadge:false, overviewStats:false,
  overviewFieldList:true, overviewForecast:true, overviewRiskDetails:false,
  overviewHelp:false, aiFieldPicker:true, aiMapShortcut:false,
  aiContext:false, aiSuggestions:false, aiActions:false,
  aiTechnicalInfo:false, aiStatus:true, navLabels:true, footer:false,
}
const balanced: UiPreferences = {
  ...compact, viewerNotice:false, weatherBadge:true, overviewStats:true,
  overviewRiskDetails:true, aiMapShortcut:true,
  aiContext:true, aiSuggestions:true, aiActions:false, footer:true,
}
const expert: UiPreferences = Object.fromEntries(
  UI_FLAGS.map(key => [key, true]),
) as UiPreferences

export function presetPreferences(preset: UiPreset): UiPreferences {
  return { ...(preset === 'compact' ? compact : preset === 'expert' ? expert : balanced) }
}

export function initialPreferences(isMobile: boolean): UiPreferences {
  return presetPreferences(isMobile ? 'compact' : 'balanced')
}

export function preferencesStorageKey(username: string | null | undefined): string {
  // Usernames are validated on the server, but never use raw text as a path.
  return 'agroradar.ui.preferences.v1.' + encodeURIComponent(username || 'guest')
}

export function loadPreferences(
  storage: Pick<Storage, 'getItem'> | null,
  username: string | null | undefined,
  isMobile: boolean,
): UiPreferences {
  const defaults = initialPreferences(isMobile)
  if (!storage) return defaults
  try {
    const stored = storage.getItem(preferencesStorageKey(username))
    if (!stored) return defaults
    const data: unknown = JSON.parse(stored)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaults
    const obj = data as Record<string, unknown>
    if (obj.version !== UI_SETTINGS_VERSION || !obj.flags
      || typeof obj.flags !== 'object' || Array.isArray(obj.flags)) return defaults
    const flags = obj.flags as Record<string, unknown>
    const result = { ...defaults }
    for (const key of UI_FLAGS) if (typeof flags[key] === 'boolean') result[key] = flags[key]
    return result
  } catch {
    // Corrupted storage, browser privacy mode, Safari security restrictions.
    return defaults
  }
}

export function savePreferences(
  storage: Pick<Storage, 'setItem'> | null,
  username: string | null | undefined,
  preferences: UiPreferences,
): void {
  if (!storage) return
  try {
    storage.setItem(
      preferencesStorageKey(username),
      JSON.stringify({version:UI_SETTINGS_VERSION,flags:preferences}),
    )
  } catch {
    // Settings are optional; private browsing/storage quota cannot break the UI.
  }
}

export function presetOf(flags: UiPreferences): UiPreset | 'custom' {
  for (const name of ['compact','balanced','expert'] as const) {
    const reference = presetPreferences(name)
    if (UI_FLAGS.every(key => flags[key] === reference[key])) return name
  }
  return 'custom'
}
