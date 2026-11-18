/**
 * API boundary layer: the API (the MSW mock today, the Laravel backend later) speaks the database's
 * snake_case column names (docs/DB-ALIGNMENT.md, "Apex Aora ERP Database Design"); the screens keep
 * their own camelCase types. One mapper per resource converts both ways:
 *
 *   const leadMapper = defineMapper<LeadRow>({ fields: { company: 'company_name', status: 'status_id' }, nested: { contacts: contactMapper } })
 *   leadMapper.toApi(row)   // { id, company_name, status_id, contacts: [{ is_decision_maker, … }], … }
 *   leadMapper.fromApi(json) // back to LeadRow
 *
 * Rules
 *  - `fields`: UI key → API key, written where the name differs from plain snake_case (design column
 *    names such as company → company_name). Every other key is converted mechanically
 *    (ownerId ↔ owner_id), so a mapper never drops a field.
 *  - `nested`: a field whose value is another resource (object or array of objects) → its mapper.
 *  - `opaque`: fields whose VALUE is left untouched (maps keyed by data, e.g. import decisions keyed
 *    by row number, or error-envelope details). Their key is still renamed.
 *  - Arrays map element-wise; null / undefined / primitives pass through.
 *  - Error envelopes (`{ message, code, …details }`) are never mapped: they are the same everywhere.
 * The mock's handlers serialize responses with `toApi` and parse request bodies with `fromApi`; the
 * client api functions do the reverse. Services and screens only ever see the UI shape.
 */

type Plain = Record<string, unknown>

export interface Mapper<UI> {
  /** UI shape → API (snake_case) shape. Accepts one record or an array of records. */
  toApi(value: UI): Plain
  toApi(value: UI[]): Plain[]
  toApi(value: Partial<UI>): Plain
  /** API (snake_case) shape → UI shape. Accepts one record or an array of records. */
  fromApi(value: unknown): UI
  fromApiList(value: unknown): UI[]
  /** UI key → API key for every explicitly mapped field (docs and tests). */
  readonly fields: Readonly<Record<string, string>>
  /** The API key for a UI key (explicit or mechanical). */
  apiKey(uiKey: string): string
  /** The spec it was defined with (extendMapper). */
  readonly spec: MapperSpec
}

export interface MapperSpec {
  fields?: Record<string, string>
  nested?: Record<string, Mapper<unknown>>
  opaque?: readonly string[]
  /**
   * Aggregates (report / dashboard payloads, consoles): every nested plain object or array without
   * its own `nested` mapper is converted mechanically too, at any depth. `opaque` then applies to
   * that key name at every level (map-valued series keyed by data: statuses, months, module keys…).
   */
  deep?: boolean
}

/** ownerId → owner_id, recommendedServiceId → recommended_service_id, value2 → value2. */
export function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase()
}

/** owner_id → ownerId. Keys without underscores pass through unchanged. */
export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

const isPlainObject = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

export function defineMapper<UI>(spec: MapperSpec = {}): Mapper<UI> {
  const fields = { ...(spec.fields ?? {}) }
  const nested = spec.nested ?? {}
  const opaque = new Set(spec.opaque ?? [])
  const deep = spec.deep === true
  const reverse = new Map<string, string>()
  for (const [ui, api] of Object.entries(fields)) {
    if (reverse.has(api)) throw new Error(`Mapper: "${api}" is mapped from both "${reverse.get(api)}" and "${ui}".`)
    reverse.set(api, ui)
  }
  const apiKey = (ui: string) => fields[ui] ?? toSnake(ui)
  const uiKey = (api: string) => reverse.get(api) ?? toCamel(api)

  function convert(value: unknown, dir: 'toApi' | 'fromApi'): unknown {
    if (Array.isArray(value)) return value.map((v) => convert(v, dir))
    if (!isPlainObject(value)) return value
    const out: Plain = {}
    for (const [k, v] of Object.entries(value)) {
      const ui = dir === 'toApi' ? k : uiKey(k)
      const key = dir === 'toApi' ? apiKey(k) : ui
      const child = nested[ui]
      out[key] =
        opaque.has(ui) || v === null || v === undefined
          ? v
          : child
            ? dir === 'toApi'
              ? child.toApi(v as never)
              : convertNested(child, v)
            : deep && (Array.isArray(v) || isPlainObject(v))
              ? deepConvert(v, dir)
              : v
    }
    return out
  }

  /** Mechanical conversion at any depth (deep mappers), honouring `opaque` key names. */
  function deepConvert(value: unknown, dir: 'toApi' | 'fromApi'): unknown {
    if (Array.isArray(value)) return value.map((v) => deepConvert(v, dir))
    if (!isPlainObject(value)) return value
    const out: Plain = {}
    for (const [k, v] of Object.entries(value)) {
      const ui = dir === 'toApi' ? k : toCamel(k)
      out[dir === 'toApi' ? toSnake(k) : ui] = opaque.has(ui) ? v : deepConvert(v, dir)
    }
    return out
  }

  function convertNested(child: Mapper<unknown>, v: unknown): unknown {
    return Array.isArray(v) ? child.fromApiList(v) : child.fromApi(v)
  }

  return {
    toApi: ((value: unknown) => convert(value, 'toApi')) as Mapper<UI>['toApi'],
    fromApi: (value: unknown) => convert(value, 'fromApi') as UI,
    fromApiList: (value: unknown) => (Array.isArray(value) ? value.map((v) => convert(v, 'fromApi')) : []) as UI[],
    fields,
    apiKey,
    spec: { fields, nested, opaque: [...opaque], deep },
  }
}

/** A mapper with every field of `base` plus more (e.g. a detail view of a row). */
export function extendMapper<UI>(base: Mapper<unknown>, spec: MapperSpec): Mapper<UI> {
  return defineMapper<UI>({
    fields: { ...base.spec.fields, ...(spec.fields ?? {}) },
    nested: { ...(base.spec.nested ?? {}), ...(spec.nested ?? {}) },
    opaque: [...(base.spec.opaque ?? []), ...(spec.opaque ?? [])],
    deep: spec.deep ?? base.spec.deep,
  })
}
