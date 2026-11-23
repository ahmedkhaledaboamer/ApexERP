import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Download, FileCheck2, Pencil, Send } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { TextInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import { errorMessage, F, Metric, Table, td } from '@/modules/hr/time/components/shared'
import { toCsv } from '@/modules/hr/reports/calc'
import { downloadText } from '@/modules/hr/payroll/components/bits'
import { complianceApi, useComplianceMutation, usePolicy, usePolicyStatus } from '../api'
import { POLICY_CATEGORY_LABEL } from '../types'
import { AckBar, FileLink, POLICIES_PATH, PolicyBody } from '../components/bits'
import { PolicyEditor } from './PoliciesPage'

type Tab = 'acknowledgements' | 'text' | 'versions'

/** `/hr/policies/:id`: the acknowledgement dashboard (% by department, who is pending, CSV), the text and the versions. */
export default function PolicyDetailPage() {
  const { id = '' } = useParams()
  const q = usePolicy(id)
  const st = usePolicyStatus(id)
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('acknowledgements')
  const [editing, setEditing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const archive = useComplianceMutation(complianceApi.archivePolicy)
  const p = q.data
  async function exportCsv() {
    try {
      const rows = await complianceApi.policyExport(id)
      const csv = toCsv(
        ['Employee no', 'Employee', 'Department', 'Policy', 'Version', 'Acknowledged', 'Acknowledged at'],
        rows.map((r) => [r.employeeNo, r.employeeName, r.department, r.policy, r.version, r.acknowledged, r.acknowledgedAt]),
      )
      downloadText(`policy-${id}-acknowledgements.csv`, csv, 'text/csv')
    } catch (e) {
      toast.error('Export failed', errorMessage(e))
    }
  }
  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <FileCheck2 />
          </IconTile>
        }
        title={p?.title ?? 'Policy'}
        description={p ? `${POLICY_CATEGORY_LABEL[p.category]} · ${p.audienceLabel}${p.version ? ` · version ${p.version}${p.effectiveDate ? `, effective ${fmtDate(p.effectiveDate)}` : ''}` : ''}` : undefined}
        actions={
          p?.canManage ? (
            <>
              {p.status !== 'archived' && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
              )}
              {p.hasDraft && p.status !== 'archived' && (
                <Button onClick={() => setPublishing(true)}>
                  <Send />
                  {p.version ? `Publish version ${p.version + 1}` : 'Publish'}
                </Button>
              )}
              {p.status === 'published' && (
                <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate(p.id, { onSuccess: () => toast.success('Policy archived') })}>
                  <Archive />
                  Archive
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <Tabs
          label="Policy views"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'acknowledgements', label: 'Acknowledgements' },
            { id: 'text', label: 'Text' },
            { id: 'versions', label: 'Versions' },
          ]}
        />
      </PageHeader>
      <PageBody className="space-y-4">
        <Link to={POLICIES_PATH} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          Policies
        </Link>
        {q.error ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !p ? (
          <Skeleton className="h-64" />
        ) : tab === 'acknowledgements' ? (
          p.status !== 'published' ? (
            <EmptyState title={p.status === 'draft' ? 'Not published yet' : 'Archived'} body={p.status === 'draft' ? 'Publish the policy to send it to the employees it applies to.' : 'Archived policies are no longer offered or reminded.'} />
          ) : st.isPending ? (
            <Skeleton className="h-64" />
          ) : st.error ? (
            <ErrorState message={errorMessage(st.error)} onRetry={() => st.refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Acknowledged" value={`${st.data.stats.pct}%`} tone={st.data.stats.pct >= 100 ? 'success' : undefined} />
                  <Metric label="Employees" value={st.data.stats.audience} />
                  <Metric label="Done" value={st.data.stats.acknowledged} />
                  <Metric label="Pending" value={st.data.stats.pending} tone={st.data.stats.pending ? 'warning' : undefined} />
                </div>
                {p.canManage && (
                  <Button variant="secondary" onClick={exportCsv}>
                    <Download />
                    Export CSV
                  </Button>
                )}
              </div>
              <Table label="Acknowledged by department" head={['Department', 'Employees', 'Acknowledged', '']} minWidth={560}>
                {st.data.byDepartment.map((d) => (
                  <tr key={d.departmentId ?? 'none'} data-testid={`dept-${d.departmentName}`}>
                    <td className={`${td} text-ink`}>{d.departmentName}</td>
                    <td className={`${td} num`}>{d.audience}</td>
                    <td className={`${td} num`}>{d.acknowledged}</td>
                    <td className={td}>
                      <AckBar pct={d.pct} label={d.departmentName} />
                    </td>
                  </tr>
                ))}
              </Table>
              <Table label="Employees" head={['Employee', 'Department', 'Status', 'When']} minWidth={640}>
                {st.data.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <td className={`${td} text-ink`}>
                      {e.employeeName}
                      <span className="block text-xs text-muted">{e.employeeNo}</span>
                    </td>
                    <td className={td}>{e.departmentName ?? '—'}</td>
                    <td className={td}>
                      {e.acknowledged ? 'Acknowledged' : e.acknowledgedVersion ? `Pending (acknowledged v${e.acknowledgedVersion})` : 'Pending'}
                    </td>
                    <td className={td}>{e.acknowledgedAt ? fmtDate(e.acknowledgedAt) : '—'}</td>
                  </tr>
                ))}
              </Table>
            </>
          )
        ) : tab === 'text' ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <section aria-label="Current version" className="space-y-2 rounded-xl border border-line bg-surface p-4">
              <p className="text-xs font-medium text-muted">{p.current ? `Version ${p.current.version} (published ${fmtDate(p.current.publishedAt)})` : 'Not published'}</p>
              {p.current ? (
                <>
                  <PolicyBody body={p.current.body} />
                  <FileLink file={p.current.file} />
                </>
              ) : (
                <p className="text-[0.8125rem] text-muted">—</p>
              )}
            </section>
            {p.draft && (
              <section aria-label="Draft" className="space-y-2 rounded-xl border border-dashed border-line bg-surface p-4">
                <p className="text-xs font-medium text-muted">Draft of the next version · effective {fmtDate(p.draft.effectiveDate)}</p>
                <PolicyBody body={p.draft.body} />
                <FileLink file={p.draft.file} />
              </section>
            )}
          </div>
        ) : (
          <Table label="Versions" head={['Version', 'Published', 'Effective', 'By', 'Change']} minWidth={640}>
            {[...p.versions].reverse().map((v) => (
              <tr key={v.version}>
                <td className={`${td} num`}>v{v.version}</td>
                <td className={td}>{fmtDate(v.publishedAt)}</td>
                <td className={td}>{fmtDate(v.effectiveDate)}</td>
                <td className={td}>{v.publishedByName}</td>
                <td className={td}>{v.changeNote || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </PageBody>
      {editing && p && <PolicyEditor policy={p} onClose={() => setEditing(false)} />}
      {publishing && p && <PublishModal id={p.id} next={p.version + 1} onClose={() => setPublishing(false)} />}
    </>
  )
}

function PublishModal({ id, next, onClose }: { id: string; next: number; onClose: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const m = useComplianceMutation(complianceApi.publishPolicy)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Publish version ${next}`}
      description={next > 1 ? 'Everyone in the audience must acknowledge the new version (earlier acknowledgements stay as history). They are reminded now, after 3 and after 7 days.' : 'Everyone in the audience is asked to acknowledge it now, and reminded after 3 and after 7 days.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate({ id, changeNote: note }, { onSuccess: () => (toast.success(`Version ${next} published`), onClose()) })}>
            Publish
          </Button>
        </>
      }
    >
      {next > 1 && (
        <F label="What changed (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </F>
      )}
      {m.error && <p className="mt-3 text-[0.8125rem] text-danger-700 dark:text-danger-300" role="alert">{errorMessage(m.error)}</p>}
    </Modal>
  )
}
