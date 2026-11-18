import type { AuditAction } from '@/modules/settings/types'
import type { Tone } from '@/shared/components/ui/Badge'

export const ACTIONS: AuditAction[] = ['create', 'update', 'delete', 'deactivate', 'reactivate', 'security']

export const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  deactivate: 'Deactivated',
  reactivate: 'Reactivated',
  security: 'Security',
}

export const ACTION_TONE: Record<AuditAction, Tone> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  deactivate: 'amber',
  reactivate: 'teal',
  security: 'brand',
}

const ENTITY_LABEL: Record<string, string> = {
  user: 'User',
  security: 'Security',
  lookup: 'Fixed list',
  automation: 'Automation',
  template: 'Template',
  targets: 'Targets',
  target: 'Targets',
  lead: 'Lead',
  customer: 'Customer',
  contract: 'Contract',
  quotation: 'Quotation',
  'company-profile': 'Company profile',
  branding: 'Branding',
  company: 'Company',
}

const LIST_LABEL: Record<string, string> = {
  statuses: 'Lead statuses',
  sources: 'Source types',
  industries: 'Industries',
  lossReasons: 'Loss reasons',
  tags: 'Tags',
}

/** "lookup:statuses" → "lookup"; used for the entity-type filter. */
export function entityType(entity: string): string {
  return entity.split(':')[0]
}

export function entityTypeLabel(type: string): string {
  return ENTITY_LABEL[type] ?? humanize(type)
}

/** "lookup:statuses" → "Fixed list · Lead statuses". */
export function entityLabel(entity: string): string {
  const [type, sub] = entity.split(':')
  const base = entityTypeLabel(type)
  return sub ? `${base} · ${LIST_LABEL[sub] ?? humanize(sub)}` : base
}

const FIELD_LABEL: Record<string, string> = {
  managerId: 'Direct manager',
  departmentId: 'Department',
  ownerId: 'Owner',
  title: 'Job title',
  active: 'Status',
  twoFactorEnabled: 'Two-factor',
  requireTwoFactorForAdmins: 'Require 2FA for admins',
  sessionTimeoutMinutes: 'Session timeout (min)',
  passwordMinLength: 'Min. password length',
  logoLight: 'Light logo',
  logoDark: 'Dark logo',
  primaryColor: 'Primary colour',
  displayName: 'Workspace name',
}

/** camelCase field → "Sentence case" label. */
export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? humanize(field)
}

function humanize(s: string): string {
  const words = s
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
