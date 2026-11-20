import { sameSpeaker } from '@/modules/events/lib/library'
import type { SpeakerRecord } from '@/shared/mocks/data/eventLibrary'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Migration of the per-event speakers (the old `event_speakers` rows: one copy of a person per event) into
 * the company's speaker directory (docs/API.md › Events › Speakers; DB-ALIGNMENT E22 → L1/L2).
 *  - Per company only: a Crest row never merges into an Apex entry.
 *  - Dedupe (sameSpeaker): same email, or — without an email on either side — same name + company
 *    (case- and whitespace-insensitive). An existing directory entry is reused; empty fields of it are filled
 *    from the old row (bio, title, photo, email), never overwritten.
 *  - Each old row becomes an event link (event_speakers: event_id, speaker_id) and every session's
 *    speaker id is rewritten through `idMap` (old row id → directory id).
 * Pure: the caller pushes `added` and `links` into the stores.
 */

export interface LegacySpeakerRow {
  companyId: string
  id: string
  eventId: string
  name: string
  title: string
  company: string
  bio: string
  photoUrl: string
  email?: string
  createdAt: string
}

export interface SpeakerMigration {
  /** New directory entries (already-known people are reused, not added). */
  added: Tenant<SpeakerRecord>[]
  /** Old per-event speaker id → directory speaker id. */
  idMap: Map<string, string>
  /** One link per (event, directory speaker), duplicates collapsed. */
  links: { companyId: string; eventId: string; speakerId: string; createdAt: string }[]
}

export function migrateLegacySpeakers(
  legacy: readonly LegacySpeakerRow[],
  directory: readonly Tenant<SpeakerRecord>[],
  newId: (companyId: string) => string,
): SpeakerMigration {
  const added: Tenant<SpeakerRecord>[] = []
  const idMap = new Map<string, string>()
  const links: SpeakerMigration['links'] = []
  const pool = [...directory]
  for (const row of legacy) {
    const probe = { name: row.name, company: row.company, email: row.email ?? '' }
    let target = pool.find((s) => s.companyId === row.companyId && sameSpeaker(s, probe))
    if (target) {
      // Fill gaps only (the directory entry wins where it has a value).
      if (!target.title && row.title) target.title = row.title
      if (!target.bio && row.bio) target.bio = row.bio
      if (!target.photoUrl && row.photoUrl) target.photoUrl = row.photoUrl
      if (!target.email && row.email) target.email = row.email.trim().toLowerCase()
    } else {
      target = {
        companyId: row.companyId,
        id: newId(row.companyId),
        name: row.name.trim(),
        title: row.title,
        company: row.company,
        bio: row.bio,
        photoUrl: row.photoUrl,
        email: (row.email ?? '').trim().toLowerCase(),
        mobile: '',
        topics: [],
        linkedinUrl: '',
        kind: 'external',
        userId: null,
        fee: null,
        feeCurrency: '',
        notes: '',
        ratings: [],
        createdBy: null,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }
      pool.push(target)
      added.push(target)
    }
    idMap.set(row.id, target.id)
    const speakerId = target.id
    if (!links.some((l) => l.companyId === row.companyId && l.eventId === row.eventId && l.speakerId === speakerId)) {
      links.push({ companyId: row.companyId, eventId: row.eventId, speakerId, createdAt: row.createdAt })
    }
  }
  return { added, idMap, links }
}
