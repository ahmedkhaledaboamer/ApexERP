import { defineMapper } from './mapping'
import type {
  AssetInput,
  AttachmentInput,
  BrandAsset,
  ContentInput,
  ContentItem,
  ContentStatusInput,
  DesignInput,
  DesignOptions,
  DesignRequest,
  SaveToAssetsInput,
} from '@/modules/marketing/creative/types'

/**
 * Marketing creative resources on the wire: content_items, design_requests (+ their attachments /
 * comments), brand_assets — not in the database design yet (docs/DB-ALIGNMENT.md › Design gaps ›
 * Marketing (creative)). Same rules as shared/api/mapping.ts; every level is converted mechanically
 * (publishAt → publish_at, mimeType → mime_type, sizeBytes → size_bytes, dataUrl → data_url,
 * usageRightsExpiresAt → usage_rights_expires_at).
 */

export const contentItemMapper = defineMapper<ContentItem>({ deep: true })
export const contentInputMapper = defineMapper<ContentInput>({ deep: true })
export const contentStatusMapper = defineMapper<ContentStatusInput>({ deep: true })

export const designRequestMapper = defineMapper<DesignRequest>({ deep: true })
export const designInputMapper = defineMapper<DesignInput>({ deep: true })
export const designOptionsMapper = defineMapper<DesignOptions>({ deep: true })
export const attachmentInputMapper = defineMapper<AttachmentInput>()

export const brandAssetMapper = defineMapper<BrandAsset>({ deep: true })
export const assetInputMapper = defineMapper<AssetInput>({ deep: true })
export const saveToAssetsMapper = defineMapper<SaveToAssetsInput>()

/** Query parameter names. */
export const CREATIVE_QUERY = {
  status: 'status',
  type: 'type',
  channel: 'channel',
  campaignId: 'campaign_id',
  ownerId: 'owner_id',
  assigneeId: 'assignee_id',
  from: 'from',
  to: 'to',
  mine: 'mine',
  kind: 'kind',
  tag: 'tag',
  expiring: 'expiring',
} as const
