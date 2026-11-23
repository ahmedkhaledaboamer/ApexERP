import { defineMapper, toCamel, toSnake } from './mapping'
import type { Role } from '@/shared/types'
import type { AiSettings, AiSettingsInput } from '@/modules/ai-agent/types'
import type { AiToolName } from '@/modules/ai-agent/toolSchemas'

/**
 * Wire names of the AI assistant (docs/API.md › AI assistant): snake_case at any depth (conversation_id, tool_calls,
 * tool_results, tool_call_id, created_at…). Exceptions, kept as data:
 *  - table `rows` are keyed by their column `key` (opaque, so a row and its columns always agree);
 *  - an action's `editable` names and `choices` keys follow its `input` (snake_case on the wire);
 *  - settings `roles` are keyed by role name and `tools` by tool name (already snake_case).
 */

type Plain = Record<string, unknown>
const isObj = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v)

const deep = defineMapper<unknown>({ deep: true, opaque: ['rows', 'choices'] })

/** An action's editable field names and choice keys, converted like its input keys. */
function fixActions(v: unknown, key: (k: string) => string): unknown {
  if (Array.isArray(v)) return v.map((x) => fixActions(x, key))
  if (!isObj(v)) return v
  const out: Plain = {}
  for (const [k, x] of Object.entries(v)) out[k] = fixActions(x, key)
  if (Array.isArray(out.editable) && isObj(out.choices)) {
    out.editable = (out.editable as string[]).map(key)
    out.choices = Object.fromEntries(Object.entries(out.choices).map(([k, x]) => [key(k), x]))
  }
  return out
}

/** Conversations, messages, post / confirm results, me, usage. */
export const aiMapper = {
  toApi: (value: never): unknown => fixActions(deep.toApi(value as never), toSnake),
  fromApi: <T>(value: unknown): T => fixActions(deep.fromApi(value), toCamel) as T,
  fromApiList: <T>(value: unknown): T[] => (Array.isArray(value) ? value.map((v) => fixActions(deep.fromApi(v), toCamel) as T) : []),
}

/** Request bodies (content + context, confirm edits, rename). */
export const aiInputMapper = {
  toApi: (value: unknown): Plain => deep.toApi(value as never) as Plain,
  fromApi: (value: unknown): unknown => deep.fromApi(value),
}

const roleToApi = (roles: Partial<Record<Role, { enabled?: boolean; writeTools?: boolean }>>) =>
  Object.fromEntries(Object.entries(roles).map(([r, v]) => [r, { ...(v?.enabled !== undefined ? { enabled: v.enabled } : {}), ...(v?.writeTools !== undefined ? { write_tools: v.writeTools } : {}) }]))
const roleFromApi = (roles: unknown) =>
  isObj(roles) ? Object.fromEntries(Object.entries(roles).map(([r, v]) => [r, isObj(v) ? { ...(v.enabled !== undefined ? { enabled: v.enabled } : {}), ...(v.write_tools !== undefined ? { writeTools: v.write_tools } : {}) } : v])) : roles

export const aiSettingsMapper = {
  toApi: (s: never): Plain => {
    const v = s as AiSettings | AiSettingsInput
    const out: Plain = {}
    if ('enabled' in v && v.enabled !== undefined) out.enabled = v.enabled
    if (v.roles) out.roles = roleToApi(v.roles)
    if (v.tools) out.tools = { ...v.tools }
    if ('updatedAt' in v) out.updated_at = v.updatedAt
    if ('updatedByName' in v) out.updated_by_name = v.updatedByName
    return out
  },
  fromApi: <T = AiSettings>(value: unknown): T => {
    if (!isObj(value)) return value as T
    const out: Plain = {}
    if (value.enabled !== undefined) out.enabled = value.enabled
    if (value.roles !== undefined) out.roles = roleFromApi(value.roles)
    if (value.tools !== undefined) out.tools = isObj(value.tools) ? ({ ...value.tools } as Record<AiToolName, boolean>) : value.tools
    if ('updated_at' in value) out.updatedAt = value.updated_at
    if ('updated_by_name' in value) out.updatedByName = value.updated_by_name
    return out as T
  },
}
