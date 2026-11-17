import { CheckCheck } from 'lucide-react'
import type { User } from '@/shared/types'
import type { TemplateContext } from '@/modules/settings/templates/render'
import { RichText } from '@/modules/settings/templates/components/RichText'
import { Avatar } from '@/shared/components/ui/Avatar'
import type { Recipient } from './compose'

/** What the contact will see. Variables still in the text show as "not set" / unknown chips. */

function Empty({ children }: { children: string }) {
  return <span className="text-subtle italic">{children}</span>
}

export function EmailPreview({
  subject,
  body,
  ctx,
  user,
  recipient,
}: {
  subject: string
  body: string
  ctx: TemplateContext
  user: User
  recipient: Recipient | null
}) {
  return (
    <article aria-label="Email preview" className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <header className="space-y-3 border-b border-line bg-sunken/50 px-4 py-3.5">
        <h3 className="text-[0.9375rem] leading-snug font-semibold break-words text-ink">
          {subject.trim() ? <RichText text={subject} ctx={ctx} /> : <Empty>No subject</Empty>}
        </h3>
        <div className="flex items-start gap-2.5">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="truncate text-ink">
              <span className="font-semibold">{user.name}</span> <span className="text-muted">&lt;{user.email}&gt;</span>
            </p>
            <p className="truncate text-muted">
              to {recipient ? `${recipient.name} <${recipient.address}>` : 'no recipient'}
            </p>
          </div>
          <span className="shrink-0 text-xs text-subtle">Now</span>
        </div>
      </header>
      <div className="px-4 py-4 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap text-ink">
        {body.trim() ? <RichText text={body} ctx={ctx} /> : <Empty>Nothing written yet.</Empty>}
      </div>
    </article>
  )
}

export function WhatsAppPreview({
  body,
  ctx,
  recipient,
  company,
}: {
  body: string
  ctx: TemplateContext
  recipient: Recipient | null
  company: string
}) {
  const name = recipient?.name || company
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
  return (
    <article aria-label="WhatsApp preview" className="overflow-hidden rounded-xl border border-line shadow-xs">
      <header className="flex items-center gap-2.5 bg-[#008069] px-3 py-2.5 text-white">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-semibold">{name}</p>
          <p className="truncate text-[0.6875rem] text-white/75">{recipient?.address ?? company}</p>
        </div>
      </header>
      <div className="min-h-56 bg-[#efeae2] bg-[radial-gradient(rgb(0_0_0/0.05)_0.0625rem,transparent_0.0625rem)] [background-size:1.125rem_1.125rem] px-3 py-4">
        <p className="mx-auto mb-3 w-fit rounded-md bg-white/90 px-2 py-0.5 text-[0.6875rem] font-medium text-[#54656f] shadow-xs">
          Today
        </p>
        <div className="ms-auto w-fit max-w-[88%] rounded-lg rounded-se-none bg-[#d9fdd3] px-2.5 pt-1.5 pb-1 text-[0.875rem] leading-snug text-[#111b21] shadow-xs">
          <div className="break-words whitespace-pre-wrap">
            {body.trim() ? (
              <RichText text={body} ctx={ctx} whatsapp />
            ) : (
              <span className="text-[#667781] italic">Nothing written yet.</span>
            )}
          </div>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem] text-[#667781]">
            {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            <CheckCheck className="size-3.5 text-[#53bdeb]" aria-hidden />
          </p>
        </div>
      </div>
    </article>
  )
}
