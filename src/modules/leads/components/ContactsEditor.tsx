import { Mail, Phone, Star } from 'lucide-react'
import type { Contact } from '@/shared/types'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Card, CardHeader } from '@/shared/components/ui/Card'

/** Contacts card for the record sidebar. Editing arrives with the full lead form. */
export function ContactsEditor({ contacts }: { contacts: Contact[] }) {
  return (
    <Card>
      <CardHeader title={`Contacts · ${contacts.length}`} />
      {contacts.length === 0 ? (
        <p className="px-5 pb-5 text-[0.8125rem] text-muted">No contacts recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {contacts.map((c) => (
            <li key={c.id} className="px-5 py-3">
              <div className="flex items-start gap-2.5">
                <Avatar name={c.name} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium">
                    {c.name}
                    {c.isDecisionMaker && (
                      <Badge tone="brand" icon={<Star />}>
                        Decision maker
                      </Badge>
                    )}
                  </p>
                  {c.title && <p className="text-xs text-muted">{c.title}</p>}
                  <div className="mt-1.5 space-y-1 text-[0.8125rem]">
                    {c.mobile && (
                      <a href={`tel:${c.mobile.replace(/\s/g, '')}`} className="flex items-center gap-2 text-ink-2 hover:text-brand-700 dark:hover:text-brand-300">
                        <Phone className="size-3.5 shrink-0 text-subtle" aria-hidden />
                        <span className="num">{c.mobile}</span>
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex min-w-0 items-center gap-2 text-ink-2 hover:text-brand-700 dark:hover:text-brand-300">
                        <Mail className="size-3.5 shrink-0 text-subtle" aria-hidden />
                        <span className="truncate">{c.email}</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
