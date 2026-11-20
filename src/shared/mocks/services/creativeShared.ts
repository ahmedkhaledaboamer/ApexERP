import type { User } from '@/shared/types'
import type { AssetRef, CreativeComment, CreativeEvent } from '@/modules/marketing/creative/types'
import { can } from '@/shared/lib/permissions'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { users } from '@/shared/mocks/db'
import { campaigns } from '@/shared/mocks/data/marketing'
import { brandAssets, nextChildId, type CommentRecord, type EventRecord } from '@/shared/mocks/data/marketingCreative'
import { companyById } from '@/shared/mocks/data/tenancy'
import { nowMs } from '@/shared/mocks/clock'
import { fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'

/**
 * Helpers shared by the creative services (content calendar, design requests, brand assets).
 * Rights: the Marketing column of PERMISSION_MATRIX (view → reads, full → writes); design requests
 * add requester / assignee rights (services/designRequests.ts).
 */

export const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
export const nowStamp = () => new Date(nowMs()).toISOString()

export const canViewMarketing = (user: User) => can(user.role, 'marketing', 'view')
export const canEditMarketing = (user: User) => can(user.role, 'marketing', 'edit')

export async function requireView(user: User, what = 'Marketing'): Promise<string> {
  if (!canViewMarketing(user)) return fail(`Your role has no access to ${what}.`, 403)
  return tenantOf(user)
}

export async function requireEdit(user: User, what = 'marketing'): Promise<string> {
  const co = await requireView(user)
  if (!canEditMarketing(user)) return fail(`Your role can view ${what} but not change it.`, 403)
  return co
}

export function timezoneOf(co: string): string {
  return companyById(co)?.regional?.timezone ?? DEFAULT_REGION.timezone
}

/** An active user of the company (another company's id answers like a missing one). */
export function companyUser(co: string, id: string | null | undefined): User | undefined {
  return id ? users.find((u) => u.id === id && u.companyId === co && u.active !== false) : undefined
}

export const nameOf = (co: string, id: string | null | undefined) => (id ? (users.find((u) => u.id === id && u.companyId === co)?.name ?? 'Former user') : '')

export const campaignOf = (co: string, id: string | null | undefined) => (id ? campaigns.find((c) => c.id === id && c.companyId === co) : undefined)

export function commentView(co: string, c: CommentRecord): CreativeComment {
  return { ...c, authorName: nameOf(co, c.authorId) }
}

export function eventView(co: string, e: EventRecord): CreativeEvent {
  return { ...e, userName: e.userId ? nameOf(co, e.userId) : 'System' }
}

export function addEvent(row: { id: string; history: EventRecord[] }, user: User | null, summary: string, at = nowStamp()): void {
  row.history.push({ id: nextChildId(row.id, 'e'), userId: user?.id ?? null, summary, at })
}

/** Linked brand assets (stored ones of the company) as small refs. */
export function assetRefs(co: string, ids: string[]): AssetRef[] {
  return ids
    .map((id) => brandAssets.find((a) => a.id === id && a.companyId === co))
    .filter((a) => !!a)
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url }))
}

/** Validates a list of asset ids of the company (body field); null = ok. */
export function assetIdsProblem(co: string, raw: unknown): string[] | string {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return 'Assets must be a list of asset ids.'
  const ids = [...new Set(raw as string[])]
  if (ids.length > 20) return 'Link at most 20 assets.'
  if (ids.some((id) => !brandAssets.some((a) => a.id === id && a.companyId === co))) return 'That asset doesn’t exist.'
  return ids
}

/** A company-local date (YYYY-MM-DD), '' / null → null; undefined → undefined; else an error string. */
export function dateField(v: unknown, label: string): string | null | undefined | { error: string } {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (!isRealIsoDate(v)) return { error: `${label} uses the format YYYY-MM-DD.` }
  return v
}

export const COMMENT_MAX = 4000
