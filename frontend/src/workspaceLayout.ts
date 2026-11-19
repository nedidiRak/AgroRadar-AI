import type { UiPreferences } from './uiPreferences'

export type Device = 'desktop' | 'mobile'
type Definition = { title: string; width: number; minW: number; minH: number; repeat?: boolean }
export const widgets = {
  stats: { title: 'Ключевые показатели', width: 12, minW: 3, minH: 3 },
  fields: { title: 'Поля и риски', width: 6, minW: 3, minH: 4 },
  forecast: { title: 'Сводка прогноза', width: 6, minW: 3, minH: 5 },
  map: { title: 'Карта полей', width: 7, minW: 4, minH: 10 },
  weather: { title: 'Погода сейчас', width: 5, minW: 3, minH: 3, repeat: true },
  temperature: { title: 'График температуры', width: 6, minW: 3, minH: 5, repeat: true },
  hourly: { title: 'Почасовой прогноз', width: 6, minW: 3, minH: 4, repeat: true },
  fiveDay: { title: 'Прогноз на пять дней', width: 12, minW: 4, minH: 5, repeat: true },
  risk: { title: 'Погодные риски', width: 12, minW: 4, minH: 5 },
  cropRisk: { title: 'Риск для культуры', width: 12, minW: 3, minH: 3 },
  analytics: { title: 'Агрономическая аналитика', width: 12, minW: 3, minH: 3 },
  field: { title: 'Сведения о поле', width: 5, minW: 3, minH: 3 },
  passport: { title: 'Агрономический паспорт', width: 6, minW: 3, minH: 3 },
  observations: { title: 'Журнал наблюдений', width: 6, minW: 3, minH: 4 },
  recommendations: { title: 'Рекомендации', width: 6, minW: 3, minH: 4 },
  tasks: { title: 'Полевые задания', width: 6, minW: 4, minH: 4 },
  alerts: { title: 'Предупреждения', width: 6, minW: 4, minH: 4 },
  help: { title: 'Как читать показатели', width: 12, minW: 3, minH: 2 },
} satisfies Record<string, Definition>

export type Kind = keyof typeof widgets
export type Tile = { id: string; type: Kind; x: number; y: number; w: number; h: number | null; fieldId?: number | null; hidden?: boolean }
export type Profile = { id: string; name: string; desktop: Tile[] | null; mobile: Tile[] | null }
export type Workspace = { version: 1; active: string; layouts: Profile[] }
export const limits = { profiles: 24, widgets: 64, name: 64, height: 200 } as const
export const columns = (device: Device) => device === 'mobile' ? 1 : 12
export const repeatable = (type: Kind) => 'repeat' in widgets[type]
export const templateNames = {
  classic: 'Классический', agronomist: 'Агроном', monitoring: 'Мониторинг рисков',
  analytics: 'Аналитика', minimal: 'Минималистичный',
}
export type Template = keyof typeof templateNames
export function freshWorkspace(): Workspace {
  return { version: 1, active: 'classic', layouts: [{ id: 'classic', name: templateNames.classic, desktop: null, mobile: null }] }
}

export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(3)), n => n.toString(36)).join('-')
}
export function makeTile(type: Kind, device: Device, id: string): Tile {
  return { id, type, x: 0, y: 0, w: Math.min(widgets[type].width, columns(device)),
    h: type === 'map' ? 16 : null }
}
const recipes: Record<Template, Kind[][]> = {
  classic: [['stats'], ['fields', 'forecast'], ['fiveDay'], ['risk'], ['cropRisk'], ['analytics'], ['help']],
  agronomist: [['map', 'weather'], ['passport', 'observations'], ['tasks', 'recommendations'], ['fiveDay']],
  monitoring: [['stats'], ['map', 'alerts'], ['risk'], ['tasks', 'recommendations']],
  analytics: [['fields', 'temperature'], ['fiveDay'], ['analytics'], ['cropRisk'], ['risk']],
  minimal: [['fields', 'weather']],
}
const classicFlags: Partial<Record<Kind, keyof UiPreferences>> = {
  stats: 'overviewStats', fields: 'overviewFieldList', forecast: 'overviewForecast', fiveDay: 'overviewForecast',
  risk: 'overviewRiskDetails', cropRisk: 'overviewRiskDetails', analytics: 'overviewRiskDetails', help: 'overviewHelp',
}
export function templateTiles(template: Template, device: Device, preferences?: UiPreferences): Tile[] {
  const tiles: Tile[] = []
  for (const [row, recipe] of recipes[template].entries()) {
    const types = recipe.filter(type => {
      const flag = classicFlags[type]
      return template !== 'classic' || !flag || !preferences || preferences[flag]
    })
    let x = 0
    for (const type of types) {
      const tile = makeTile(type, device, 'base-' + type)
      if (device === 'desktop') {
        tile.w = types.length === 1 || type === types[types.length - 1] ? 12 - x : tile.w
        tile.x = x
        x += tile.w
      }
      // The compactor closes unused rows after measuring the real contents.
      tile.y = (device === 'mobile' ? tiles.length : row) * 20
      tiles.push(tile)
    }
  }
  return tiles
}

export function reorder(tiles: Tile[], id: string, delta: number): Tile[] {
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x)
  const index = sorted.findIndex(tile => tile.id === id)
  const other = index + delta
  if (!sorted[other] || index < 0) return tiles
  const [moved] = sorted.splice(index, 1)
  sorted.splice(other, 0, moved)
  return sorted.map((tile, i) => ({ ...tile, y: i * 20 }))
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,80}$/.test(id)
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

function decodeTiles(value: unknown, device: Device): Tile[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > limits.widgets) throw new Error('Повреждён список виджетов')
  const seen = new Set<string>()
  const singletons = new Set<string>()
  return value.flatMap(raw => {
    if (!object(raw) || !validId(raw.id) || seen.has(raw.id) || !validId(raw.type)) throw new Error('Повреждён виджет')
    seen.add(raw.id)
    // Retired widgets may be absent after an upgrade; keep the rest of the profile.
    if (!Object.prototype.hasOwnProperty.call(widgets, raw.type)) return []
    const type = raw.type as Kind
    if (!repeatable(type) && singletons.has(type)) return []
    singletons.add(type)
    if (!integer(raw.x, 0, 11) || !integer(raw.y, 0, 100000) || !integer(raw.w, 1, 12) ||
        (raw.h !== null && !integer(raw.h, 1, limits.height))) throw new Error('Повреждена геометрия макета')
    const w = Math.min(columns(device), Math.max(widgets[type].minW, raw.w))
    return [{ id: raw.id, type, x: Math.min(raw.x, columns(device) - w), y: raw.y, w,
      h: raw.h === null ? null : Math.max(widgets[type].minH, raw.h),
      ...(raw.hidden === true ? {hidden:true} : {}),
      fieldId: integer(raw.fieldId, 1, Number.MAX_SAFE_INTEGER) ? raw.fieldId : null }]
  })
}

export function decodeWorkspace(value: unknown): Workspace {
  if (!object(value) || value.version !== 1) throw new Error('Эта версия макета не поддерживается')
  if (!Array.isArray(value.layouts) || !value.layouts.length || value.layouts.length > limits.profiles) throw new Error('Повреждён список макетов')
  const seen = new Set<string>()
  const layouts = value.layouts.map(raw => {
    if (!object(raw) || !validId(raw.id) || seen.has(raw.id) || typeof raw.name !== 'string' ||
        !raw.name.trim() || raw.name.length > limits.name) throw new Error('Повреждены настройки макета')
    seen.add(raw.id)
    return {id: raw.id, name: raw.name, desktop: decodeTiles(raw.desktop, 'desktop'), mobile: decodeTiles(raw.mobile, 'mobile')}
  })
  if (!validId(value.active) || !seen.has(value.active)) throw new Error('Не найден активный макет')
  return { version: 1, active: value.active, layouts }
}
