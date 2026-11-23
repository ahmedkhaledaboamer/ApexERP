import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import type { EmailLogSource, IntegrationKey, SyncDirection, SyncLogFilters, SyncStatus } from '@/modules/integrations/types'
import { EMAIL_LOG_SOURCE_LABEL, INTEGRATION_LABEL } from '@/modules/integrations/types'
import { useEmailLog, useSyncLog } from '@/modules/integrations/api'
import { buildCsv, csvFileName, downloadCsv } from '@/modules/platform/csv'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput } from '@/shared/components/form/Field'
import { when } from './shared'

const STATUS_TONE: Record<string, Tone> = { success: 'green', warning: 'amber', error: 'red', sent: 'green', queued: 'blue', skipped: 'neutral', failed: 'red' }

/** One table across integrations: time, integration, direction, status, message; filters and CSV export. */
export function SyncLogTab() {
  const [f, setF] = useState<SyncLogFilters>({})
  const q = useSyncLog(f)
  const rows = q.data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SelectInput aria-label="Integration" className="w-44" value={f.integration ?? ''} onChange={(e) => setF((x) => ({ ...x, integration: e.target.value as IntegrationKey | '' }))}>
          <option value="">All integrations</option>
          {(Object.keys(INTEGRATION_LABEL) as IntegrationKey[]).map((k) => (
            <option key={k} value={k}>
              {INTEGRATION_LABEL[k]}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Status" className="w-36" value={f.status ?? ''} onChange={(e) => setF((x) => ({ ...x, status: e.target.value as SyncStatus | '' }))}>
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </SelectInput>
        <SelectInput aria-label="Direction" className="w-36" value={f.direction ?? ''} onChange={(e) => setF((x) => ({ ...x, direction: e.target.value as SyncDirection | '' }))}>
          <option value="">Any direction</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </SelectInput>
        <Button
          size="sm"
          variant="secondary"
          className="ms-auto"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              csvFileName('integrations-sync-log'),
              buildCsv(rows, [
                { header: 'Time', value: (r) => r.at },
                { header: 'Integration', value: (r) => INTEGRATION_LABEL[r.integration] },
                { header: 'Direction', value: (r) => r.direction },
                { header: 'Status', value: (r) => r.status },
                { header: 'Message', value: (r) => r.message },
              ]),
            )
          }
        >
          <Download />
          Export CSV
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="m-4 h-40" />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing logged" body="Connections, tests, syncs and failures of every integration show up here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Sync log">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Time</th>
                <th className="px-4 py-2 text-start font-medium">Integration</th>
                <th className="px-4 py-2 text-start font-medium">Direction</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
                <th className="px-4 py-2 text-start font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{when(r.at)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{INTEGRATION_LABEL[r.integration]}</td>
                  <td className="px-4 py-2 text-muted capitalize">{r.direction}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-ink-2">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** Every email the workspace sent: invoices, statements, reminders, bulk emails and tests, with status. */
export function EmailLogTab() {
  const [source, setSource] = useState<EmailLogSource | ''>('')
  const [status, setStatus] = useState('')
  const q = useEmailLog(source || undefined, status || undefined)
  const rows = q.data ?? []
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SelectInput aria-label="Source" className="w-44" value={source} onChange={(e) => setSource(e.target.value as EmailLogSource | '')}>
          <option value="">All emails</option>
          {(Object.keys(EMAIL_LOG_SOURCE_LABEL) as EmailLogSource[]).map((k) => (
            <option key={k} value={k}>
              {EMAIL_LOG_SOURCE_LABEL[k]}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Email status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="queued">Queued</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
        </SelectInput>
      </div>
      {q.isPending ? (
        <Skeleton className="m-4 h-40" />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No emails yet" body="Invoice and statement emails, payment reminders, bulk emails and test emails show up here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[0.8125rem]" aria-label="Email log">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Time</th>
                <th className="px-4 py-2 text-start font-medium">Type</th>
                <th className="px-4 py-2 text-start font-medium">To</th>
                <th className="px-4 py-2 text-start font-medium">Subject</th>
                <th className="px-4 py-2 text-start font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-muted">{when(r.at)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{EMAIL_LOG_SOURCE_LABEL[r.source]}</td>
                  <td className="px-4 py-2">{r.to}</td>
                  <td className="px-4 py-2 text-ink-2">
                    {r.link ? (
                      <Link to={r.link} className="hover:underline">
                        {r.subject}
                      </Link>
                    ) : (
                      r.subject
                    )}
                    {r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
