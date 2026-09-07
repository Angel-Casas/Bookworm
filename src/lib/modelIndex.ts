/**
 * Making a list of six hundred models navigable.
 *
 * NanoGPT returns every model it can reach, flat, with ids like
 * "anthropic/claude-opus-5" or "deepseek-chat". A single <select> of that is
 * unusable — so this file turns the flat list into something a reader can
 * search, scan and compare: a house, a name, an id, and what it costs.
 *
 * Pure and deterministic; the picker component only renders what it returns.
 */

export interface PickerModel {
  id: string
  name: string
  contextLength: number | null
  /** USD per million tokens. */
  promptPrice: number | null
  completionPrice: number | null
}

export interface ModelGroup {
  /** Display name of the house — "Anthropic", "Favourites", "Elsewhere". */
  house: string
  models: PickerModel[]
}

/**
 * Houses recognised by id prefix or, failing that, by a word in the name.
 * Order here is the order they are listed in, so the well-known houses come
 * first and everything else falls through to one bucket at the end.
 */
const HOUSES: readonly { house: string; prefixes: readonly string[]; words?: readonly string[] }[] =
  [
    { house: 'OpenAI', prefixes: ['openai/', 'gpt-', 'o1', 'o3', 'o4', 'azure-'], words: ['gpt'] },
    { house: 'Anthropic', prefixes: ['anthropic/', 'claude-'], words: ['claude'] },
    { house: 'Google', prefixes: ['google/', 'gemini-', 'gemma-'], words: ['gemini', 'gemma'] },
    { house: 'DeepSeek', prefixes: ['deepseek/', 'deepseek-ai/', 'deepseek-'], words: ['deepseek'] },
    { house: 'Meta', prefixes: ['meta/', 'meta-llama/', 'llama'], words: ['llama'] },
    { house: 'Mistral', prefixes: ['mistral/', 'mistralai/', 'ministral'], words: ['mistral'] },
    { house: 'Alibaba', prefixes: ['alibaba/', 'qwen/', 'qwen'], words: ['qwen'] },
    { house: 'xAI', prefixes: ['x-ai/', 'grok'], words: ['grok'] },
  ] as const

/** Everything with no recognised house. */
export const OTHER_HOUSE = 'Elsewhere'
/** The reader's own shortlist, always listed first. */
export const FAVOURITES_HOUSE = 'Favourites'

/**
 * Entries NanoGPT returns that are not models to read a book with — support
 * assistants and the like. They are dropped at the source rather than hidden
 * in the picker, so they cannot be chosen, pinned or restored from a saved
 * setting either.
 */
const NOT_A_READING_MODEL: readonly string[] = ['nano-gpt-help'] as const

export function isSelectableModel(model: { id: string }): boolean {
  return !NOT_A_READING_MODEL.includes(model.id.toLowerCase())
}

/**
 * Models that quote no price of their own because they do not have one: the
 * auto model forwards each request to whichever model suits it, so what a
 * message costs is only known after it is answered. The API reports zeroes for
 * these, which would otherwise read — wrongly — as "free".
 */
const PRICE_VARIES: readonly string[] = ['auto-model'] as const

export function hasVariablePrice(id: string): boolean {
  return PRICE_VARIES.includes(id.toLowerCase())
}

/** Which house a model belongs to. */
export function houseOf(model: PickerModel): string {
  const id = model.id.toLowerCase()
  const name = model.name.toLowerCase()
  for (const entry of HOUSES) {
    if (entry.prefixes.some((prefix) => id.startsWith(prefix))) return entry.house
  }
  for (const entry of HOUSES) {
    if (entry.words?.some((word) => name.includes(word) || id.includes(word))) return entry.house
  }
  return OTHER_HOUSE
}

/**
 * Match a model against a typed query. Every word must appear somewhere in the
 * name, the id or the house — so "claude opus" and "anthropic opus" both find
 * the same thing, and word order never matters.
 */
export function matchesQuery(model: PickerModel, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return true
  const haystack = `${model.name} ${model.id} ${houseOf(model)}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

export type ModelSort = 'house' | 'name' | 'cheapest' | 'priciest'

export const MODEL_SORTS: readonly { id: ModelSort; label: string }[] = [
  { id: 'house', label: 'By house' },
  { id: 'name', label: 'By name' },
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'priciest', label: 'Priciest' },
] as const

/** What a model costs to run, for ordering: prompt + completion per million. */
function priceOf(model: PickerModel): number | null {
  // A price that varies is not a cheap price — it sorts with the unknowns.
  if (hasVariablePrice(model.id)) return null
  if (model.promptPrice === null || model.completionPrice === null) return null
  return model.promptPrice + model.completionPrice
}

function byPrice(a: PickerModel, b: PickerModel, cheapestFirst: boolean): number {
  const left = priceOf(a)
  const right = priceOf(b)
  // Unpriced models sort last either way: an unknown price is not a bargain.
  if (left === null && right === null) return a.name.localeCompare(b.name)
  if (left === null) return 1
  if (right === null) return -1
  if (left === right) return a.name.localeCompare(b.name)
  return cheapestFirst ? left - right : right - left
}

export interface BuildOptions {
  models: readonly PickerModel[]
  query: string
  sort: ModelSort
  favouriteIds: readonly string[]
  /** Show only these houses; empty means all of them. */
  houses?: readonly string[]
}

/**
 * The list as the picker shows it: favourites first, then either grouped by
 * house or in one flat run under a heading that says how it is ordered.
 */
export function buildModelGroups(options: BuildOptions): ModelGroup[] {
  const favourites = new Set(options.favouriteIds)
  const houseFilter = new Set(options.houses ?? [])
  const matching = options.models.filter(
    (model) =>
      matchesQuery(model, options.query) &&
      (houseFilter.size === 0 || houseFilter.has(houseOf(model))),
  )

  const order = (list: PickerModel[]): PickerModel[] => {
    const sorted = [...list]
    if (options.sort === 'cheapest') sorted.sort((a, b) => byPrice(a, b, true))
    else if (options.sort === 'priciest') sorted.sort((a, b) => byPrice(a, b, false))
    else sorted.sort((a, b) => a.name.localeCompare(b.name))
    return sorted
  }

  const groups: ModelGroup[] = []
  const starred = matching.filter((model) => favourites.has(model.id))
  if (starred.length > 0) groups.push({ house: FAVOURITES_HOUSE, models: order(starred) })

  const rest = matching.filter((model) => !favourites.has(model.id))
  if (options.sort !== 'house') {
    if (rest.length > 0) {
      groups.push({
        house: MODEL_SORTS.find((entry) => entry.id === options.sort)?.label ?? 'All models',
        models: order(rest),
      })
    }
    return groups
  }

  const byHouse = new Map<string, PickerModel[]>()
  for (const model of rest) {
    const house = houseOf(model)
    byHouse.set(house, [...(byHouse.get(house) ?? []), model])
  }
  // Known houses in their declared order, then the catch-all last.
  for (const entry of HOUSES) {
    const list = byHouse.get(entry.house)
    if (list && list.length > 0) groups.push({ house: entry.house, models: order(list) })
  }
  const others = byHouse.get(OTHER_HOUSE)
  if (others && others.length > 0) groups.push({ house: OTHER_HOUSE, models: order(others) })
  return groups
}

/** Every house present in a list, with how many models each holds. */
export function houseCounts(models: readonly PickerModel[]): { house: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const model of models) {
    const house = houseOf(model)
    counts.set(house, (counts.get(house) ?? 0) + 1)
  }
  const ordered = HOUSES.map((entry) => entry.house).filter((house) => counts.has(house))
  if (counts.has(OTHER_HOUSE)) ordered.push(OTHER_HOUSE)
  return ordered.map((house) => ({ house, count: counts.get(house) ?? 0 }))
}

/**
 * One price, compactly: 0.5 → "$0.50", 15 → "$15", 1.1 → "$1.10", 1312.5 → "$1313".
 * Whole dollars lose their cents because a column of "$15.00" is noise; anything
 * with a fraction keeps both digits so the prices line up as money, not numbers.
 */
function priceLabel(price: number): string {
  if (price === 0) return 'free'
  if (price >= 100) return `$${Math.round(price)}`
  return `$${price % 1 === 0 ? price : price.toFixed(2)}`
}

/** "in $3 · out $15", per million tokens — the shape a reader compares on. */
export function formatModelPrice(model: PickerModel): string {
  if (hasVariablePrice(model.id)) return 'price varies by model'
  if (model.promptPrice === null || model.completionPrice === null) return 'price unknown'
  if (model.promptPrice === 0 && model.completionPrice === 0) return 'free'
  return `in ${priceLabel(model.promptPrice)} · out ${priceLabel(model.completionPrice)}`
}

/** "128k context", or nothing when the model doesn't say. */
export function formatContext(model: PickerModel): string {
  const length = model.contextLength
  if (length === null || !Number.isFinite(length) || length <= 0) return ''
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1).replace('.0', '')}M context`
  if (length >= 1000) return `${Math.round(length / 1000)}k context`
  return `${length} context`
}
