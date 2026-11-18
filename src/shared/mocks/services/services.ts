import type { User } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import {
  DELIVERY_ROLES,
  PRICING_TYPES,
  type PackageInput,
  type PackageRow,
  type PackageUpdateInput,
  type ProjectTemplate,
  type ProjectTemplateInput,
  type Service,
  type ServiceDetail,
  type ServiceInput,
  type ServicePackage,
  type ServiceRow,
  type ServiceUpdateInput,
  type ServiceUsage,
} from '@/modules/services/types'
import { templateTotals } from '@/modules/services/types'
import { packageListPrice, packages, projectTemplateFor, projectTemplates, services } from '@/shared/mocks/data/services'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { customers, leads, users } from '@/shared/mocks/db'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'

/* ---------------- Permissions ---------------- */

async function guardView(user: User): Promise<void> {
  if (!can(user.role, 'services', 'view')) await fail('Your role has no access to the service catalog.', 403)
}
async function guardEdit(user: User): Promise<void> {
  if (!can(user.role, 'services', 'edit')) await fail('Your role can view the catalog but not change it.', 403)
}

/* ---------------- Helpers ---------------- */

const activeKey = (list: { key: string; active: boolean }[], key: string) => list.some((i) => i.key === key && i.active)
const knownKey = (list: { key: string }[], key: string) => list.some((i) => i.key === key)

/** The company's currency, used when a service or package is created without one. */
const currencyOf = (user: User) => companyById(tenantOf(user))?.regional.currency ?? 'AED'

/** Fields a client may set on update. Everything else (companyId, id, tenant fields, unknown keys) is dropped. */
const SERVICE_FIELDS = ['name', 'category', 'description', 'industries', 'pricingType', 'price', 'currency', 'deliveryDays', 'active'] as const
const PACKAGE_FIELDS = ['name', 'description', 'items', 'packagePrice', 'currency', 'active'] as const

/** Only the whitelisted fields of an update body (tenant and identity come from the server; unknown keys are never stored). */
function writable<T extends object>(input: T, fields: readonly string[]): Partial<T> {
  const out = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && fields.includes(k)))
  return out as Partial<T>
}

function usageOf(id: string): ServiceUsage {
  const leadsRecommending = leads.filter((l) => l.recommendedServiceId === id).length
  const leadsInterested = leads.filter((l) => l.serviceIds.includes(id)).length
  const quotationCount = quotations.filter((q) => q.items.some((it) => it.serviceId === id)).length
  const customerIds = new Set(contracts.filter((c) => c.status !== 'Cancelled' && c.serviceIds.includes(id)).map((c) => c.customerId))
  return { leadsRecommending, leadsInterested, quotations: quotationCount, customers: customerIds.size }
}

function toRow(s: Service): ServiceRow {
  const t = projectTemplateFor(s.id)
  return {
    ...s,
    usage: usageOf(s.id),
    templateTasks: t.tasks.length,
    templateHours: templateTotals(t.tasks).hours,
    packageCount: packages.filter((p) => p.items.some((i) => i.serviceId === s.id)).length,
  }
}

/** A service of the user's company; another company's service answers the same 404. */
async function serviceOr404(user: User, id: string): Promise<Tenant<Service>> {
  const s = findInTenant(services, user, (x) => x.id === id)
  if (!s) return fail('That service doesn’t exist.', 404)
  return s
}

/** Validates a full or partial service input against the company's lists; returns an error message or null. */
function validateService(user: User, input: ServiceUpdateInput, partial: boolean): string | null {
  const lookups = lookupsFor(tenantOf(user))
  const has = (k: keyof ServiceInput) => !partial || input[k] !== undefined
  if (has('name') && !String(input.name ?? '').trim()) return 'Name is required.'
  if (input.name && input.name.trim().length > 120) return 'Keep the name under 120 characters.'
  if (has('category') && !activeKey(lookups.serviceCategories, String(input.category ?? ''))) return 'Pick a category from the list.'
  if (input.industries) {
    const bad = input.industries.filter((k) => !knownKey(lookups.industries, k))
    if (bad.length) return `Unknown industries: ${bad.join(', ')}.`
  }
  if (has('pricingType') && !PRICING_TYPES.includes(input.pricingType as Service['pricingType'])) return 'Pricing type must be Fixed, Monthly or Hourly.'
  if (has('price')) {
    const p = Number(input.price)
    if (!Number.isFinite(p) || p < 0) return 'Price must be 0 or more.'
  }
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) return 'Currency must be a 3-letter code (e.g. AED).'
  if (has('deliveryDays')) {
    const d = Number(input.deliveryDays)
    if (!Number.isInteger(d) || d < 0 || d > 730) return 'Delivery time must be 0–730 working days.'
  }
  if (input.description !== undefined && input.description.length > 2000) return 'Keep the description under 2000 characters.'
  return null
}

/* ---------------- Services ---------------- */

/** Every service (active and inactive), newest first by name order of the catalog. */
export async function listServices(user: User): Promise<ServiceRow[]> {
  await guardView(user)
  return delay(scoped(services, user).map(toRow))
}

export async function getService(user: User, id: string): Promise<ServiceDetail> {
  await guardView(user)
  const s = await serviceOr404(user, id)
  const owner = (uid: string) => users.find((u) => u.id === uid)?.name ?? 'Unassigned'
  const recommending = leads
    .filter((l) => l.recommendedServiceId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((l) => ({ id: l.id, company: l.company, status: l.status, ownerName: owner(l.ownerId) }))
  const recentQuotations = quotations
    .filter((q) => q.items.some((it) => it.serviceId === id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((q) => {
      const subtotal = q.items.reduce((t, it) => t + it.quantity * it.unitPrice * (1 - it.discountPct / 100), 0)
      return {
        id: q.id,
        number: q.number,
        company: q.company,
        status: q.status,
        total: Math.round(subtotal * (1 + q.vatPct / 100)),
        createdAt: q.createdAt,
      }
    })
  const customerIds = [...new Set(contracts.filter((c) => c.status !== 'Cancelled' && c.serviceIds.includes(id)).map((c) => c.customerId))]
  return delay({
    ...toRow(s),
    template: projectTemplateFor(id),
    packages: packages.filter((p) => p.items.some((i) => i.serviceId === id)).map((p) => ({ id: p.id, name: p.name, active: p.active })),
    recommendingLeads: recommending,
    recentQuotations,
    customers: customerIds.map((cid) => ({ id: cid, name: customers.find((c) => c.id === cid)?.name ?? cid })),
  })
}

export async function createService(user: User, input: ServiceInput): Promise<ServiceRow> {
  await guardEdit(user)
  const error = validateService(user, input, false)
  if (error) return fail(error, 422)
  // Names are unique within the company; another company may sell a service with the same name.
  if (scoped(services, user).some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) {
    return fail('A service with that name already exists.', 409)
  }
  const now = new Date().toISOString()
  const next = Math.max(...services.map((s) => Number(s.id.slice(2)) || 0)) + 1
  const s = stamp<Service>({
    id: `S-${next}`,
    name: input.name.trim(),
    category: input.category,
    description: (input.description ?? '').trim(),
    industries: [...new Set(input.industries ?? [])],
    pricingType: input.pricingType,
    price: Math.round(Number(input.price) * 100) / 100,
    currency: input.currency || currencyOf(user),
    deliveryDays: Number(input.deliveryDays),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  }, user)
  services.push(s)
  recordAudit(user, { action: 'create', entity: 'service', entityId: s.id, summary: `Created service “${s.name}” (${s.currency} ${s.price} ${s.pricingType.toLowerCase()})` })
  return delay(toRow(s))
}

export async function updateService(user: User, id: string, input: ServiceUpdateInput): Promise<ServiceRow> {
  await guardEdit(user)
  const s = await serviceOr404(user, id)
  const error = validateService(user, input, true)
  if (error) return fail(error, 422)
  if (input.name && scoped(services, user).some((x) => x.id !== id && x.name.toLowerCase() === input.name!.trim().toLowerCase())) {
    return fail('A service with that name already exists.', 409)
  }
  const before = { ...s }
  const clean = writable(input, SERVICE_FIELDS) as ServiceUpdateInput
  Object.assign(s, clean, { updatedAt: new Date().toISOString() })
  if (clean.name) s.name = clean.name.trim()
  if (clean.industries) s.industries = [...new Set(clean.industries)]
  const changes = diff(before, s).filter((c) => c.field !== 'updatedAt')
  if (changes.length) {
    const priceChanged = changes.some((c) => c.field === 'price' || c.field === 'pricingType' || c.field === 'currency')
    recordAudit(user, {
      action: 'update',
      entity: 'service',
      entityId: s.id,
      summary: priceChanged
        ? `Price change on “${s.name}”: ${before.currency} ${before.price} ${before.pricingType.toLowerCase()} → ${s.currency} ${s.price} ${s.pricingType.toLowerCase()}`
        : `Edited service “${s.name}”`,
      changes,
    })
  }
  return delay(toRow(s))
}

export async function setServiceActive(user: User, id: string, active: boolean): Promise<ServiceRow> {
  await guardEdit(user)
  const s = await serviceOr404(user, id)
  if (s.active === active) return delay(toRow(s))
  s.active = active
  s.updatedAt = new Date().toISOString()
  recordAudit(user, {
    action: active ? 'reactivate' : 'deactivate',
    entity: 'service',
    entityId: s.id,
    summary: `${active ? 'Reactivated' : 'Deactivated'} service “${s.name}”`,
  })
  return delay(toRow(s))
}

/* ---------------- Project templates ---------------- */

/** The delivery template for a service (empty when none). Used now by the editor and next by Won → project. */
export async function getProjectTemplate(user: User, serviceId: string): Promise<ProjectTemplate> {
  await guardView(user)
  await serviceOr404(user, serviceId)
  return delay(projectTemplateFor(serviceId))
}

export async function saveProjectTemplate(user: User, serviceId: string, input: ProjectTemplateInput): Promise<ProjectTemplate> {
  await guardEdit(user)
  const s = await serviceOr404(user, serviceId)
  if (!Array.isArray(input.tasks)) return fail('Send the full task list.', 422)
  if (input.tasks.length > 60) return fail('Keep templates to 60 tasks or fewer.', 422)
  const tasks = []
  for (const [i, t] of input.tasks.entries()) {
    const title = String(t.title ?? '').trim()
    if (!title) return fail(`Task ${i + 1} needs a title.`, 422)
    if (title.length > 120) return fail(`Task ${i + 1}: keep the title under 120 characters.`, 422)
    if (!DELIVERY_ROLES.includes(t.role)) return fail(`Task ${i + 1}: pick a role from the list.`, 422)
    const dayOffset = Number(t.dayOffset)
    const hours = Number(t.hours)
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 365) return fail(`Task ${i + 1}: day offset must be 0–365.`, 422)
    if (!Number.isFinite(hours) || hours < 0 || hours > 1000) return fail(`Task ${i + 1}: hours must be 0–1000.`, 422)
    tasks.push({ id: t.id && t.id.startsWith(`${serviceId}-`) ? t.id : `${serviceId}-T${Date.now().toString(36)}${i}`, title, role: t.role, dayOffset, hours: Math.round(hours * 10) / 10 })
  }
  const before = projectTemplateFor(serviceId)
  const next = stamp<ProjectTemplate>({ serviceId, tasks, updatedAt: new Date().toISOString(), updatedBy: user.name }, user)
  const idx = projectTemplates.findIndex((t) => t.serviceId === serviceId)
  if (idx >= 0) projectTemplates[idx] = next
  else projectTemplates.push(next)
  const b = templateTotals(before.tasks)
  const a = templateTotals(tasks)
  recordAudit(user, {
    action: 'update',
    entity: 'service-template',
    entityId: serviceId,
    summary: `Project template for “${s.name}”: ${before.tasks.length} → ${tasks.length} tasks, ${b.hours} → ${a.hours} h`,
    changes: [
      { field: 'tasks', from: String(before.tasks.length), to: String(tasks.length) },
      { field: 'hours', from: String(b.hours), to: String(a.hours) },
      { field: 'durationDays', from: String(b.days), to: String(a.days) },
    ],
  })
  return delay(next)
}

/* ---------------- Packages ---------------- */

function packageRow(p: ServicePackage): PackageRow {
  const listPrice = packageListPrice(p.items)
  const saving = listPrice - p.packagePrice
  return {
    ...p,
    listPrice,
    saving,
    savingPct: listPrice > 0 ? Math.round((saving / listPrice) * 1000) / 10 : 0,
    lines: p.items.map((it) => {
      const s = services.find((x) => x.id === it.serviceId)
      return {
        serviceId: it.serviceId,
        name: s?.name ?? it.serviceId,
        category: s?.category ?? '',
        pricingType: s?.pricingType ?? 'Fixed',
        price: s?.price ?? 0,
        quantity: it.quantity,
        active: s?.active ?? false,
      }
    }),
  }
}

function validatePackage(user: User, input: PackageUpdateInput, partial: boolean): string | null {
  const has = (k: keyof PackageInput) => !partial || input[k] !== undefined
  if (has('name') && !String(input.name ?? '').trim()) return 'Name is required.'
  if (has('items')) {
    const items = input.items ?? []
    if (items.length < 2) return 'A package needs at least two services.'
    const ids = new Set<string>()
    for (const it of items) {
      // Only the company's own services; another company's id is "unknown".
      const s = findInTenant(services, user, (x) => x.id === it.serviceId)
      if (!s) return `Unknown service ${it.serviceId}.`
      if (!s.active) return `“${s.name}” is inactive; remove it or reactivate the service.`
      if (ids.has(it.serviceId)) return `“${s.name}” is listed twice.`
      ids.add(it.serviceId)
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 999) return `Quantity for “${s.name}” must be 1–999.`
    }
  }
  if (has('packagePrice')) {
    const p = Number(input.packagePrice)
    if (!Number.isFinite(p) || p < 0) return 'Package price must be 0 or more.'
  }
  if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) return 'Currency must be a 3-letter code.'
  return null
}

export async function listPackages(user: User): Promise<PackageRow[]> {
  await guardView(user)
  return delay(scoped(packages, user).map(packageRow))
}

export async function getPackage(user: User, id: string): Promise<PackageRow> {
  await guardView(user)
  const p = findInTenant(packages, user, (x) => x.id === id)
  if (!p) return fail('That package doesn’t exist.', 404)
  return delay(packageRow(p))
}

export async function createPackage(user: User, input: PackageInput): Promise<PackageRow> {
  await guardEdit(user)
  const error = validatePackage(user, input, false)
  if (error) return fail(error, 422)
  if (scoped(packages, user).some((p) => p.name.toLowerCase() === input.name.trim().toLowerCase())) return fail('A package with that name already exists.', 409)
  const now = new Date().toISOString()
  const p = stamp<ServicePackage>({
    id: `PK-${Math.max(0, ...packages.map((x) => Number(x.id.slice(3)) || 0)) + 1}`,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    items: input.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity })),
    packagePrice: Number(input.packagePrice),
    currency: input.currency || currencyOf(user),
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  }, user)
  packages.push(p)
  recordAudit(user, { action: 'create', entity: 'service-package', entityId: p.id, summary: `Created package “${p.name}” at ${p.currency} ${p.packagePrice}` })
  return delay(packageRow(p))
}

export async function updatePackage(user: User, id: string, input: PackageUpdateInput): Promise<PackageRow> {
  await guardEdit(user)
  const p = findInTenant(packages, user, (x) => x.id === id)
  if (!p) return fail('That package doesn’t exist.', 404)
  const error = validatePackage(user, input, true)
  if (error) return fail(error, 422)
  if (input.name && scoped(packages, user).some((x) => x.id !== id && x.name.toLowerCase() === input.name!.trim().toLowerCase())) {
    return fail('A package with that name already exists.', 409)
  }
  const before = { ...p, items: p.items.map((i) => ({ ...i })) }
  const clean = writable(input, PACKAGE_FIELDS) as PackageUpdateInput
  Object.assign(p, clean, { updatedAt: new Date().toISOString() })
  if (clean.name) p.name = clean.name.trim()
  if (clean.items) p.items = clean.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity }))
  const changes = diff(before, p).filter((c) => c.field !== 'updatedAt')
  if (changes.length) {
    const priceChanged = changes.some((c) => c.field === 'packagePrice' || c.field === 'currency')
    recordAudit(user, {
      action: 'update',
      entity: 'service-package',
      entityId: p.id,
      summary: priceChanged
        ? `Price change on package “${p.name}”: ${before.currency} ${before.packagePrice} → ${p.currency} ${p.packagePrice}`
        : `Edited package “${p.name}”`,
      changes,
    })
  }
  return delay(packageRow(p))
}

export async function setPackageActive(user: User, id: string, active: boolean): Promise<PackageRow> {
  await guardEdit(user)
  const p = findInTenant(packages, user, (x) => x.id === id)
  if (!p) return fail('That package doesn’t exist.', 404)
  if (active) {
    const inactive = p.items.map((i) => services.find((s) => s.id === i.serviceId)).filter((s) => s && !s.active)
    if (inactive.length) return fail(`Reactivate or remove ${inactive.map((s) => `“${s!.name}”`).join(', ')} first.`, 422)
  }
  if (p.active !== active) {
    p.active = active
    p.updatedAt = new Date().toISOString()
    recordAudit(user, { action: active ? 'reactivate' : 'deactivate', entity: 'service-package', entityId: p.id, summary: `${active ? 'Reactivated' : 'Deactivated'} package “${p.name}”` })
  }
  return delay(packageRow(p))
}
