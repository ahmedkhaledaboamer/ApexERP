import { useEffect, useState } from 'react'
import type { CsvMapping, DateFormat, StatementPreview } from '@/modules/finance/banking/types'
import { DATE_FORMATS } from '@/modules/finance/banking/types'
import { bankingApi, useBankingMutation } from '@/modules/finance/banking/api'
import { Amount, SimpleTable, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { Modal } from '@/shared/components/ui/Modal'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Checkbox, Field, SelectInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * Import a CSV bank statement: choose the file, check the column mapping (date, description, reference, signed amount
 * or debit + credit, balance; date format; header row), preview with duplicate / error flags, import.
 */
export function ImportStatementModal({ bankAccountId, onClose }: { bankAccountId: string; onClose: () => void }) {
  const toast = useToast()
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [preview, setPreview] = useState<StatementPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includeDuplicates, setIncludeDuplicates] = useState(false)
  const doPreview = useBankingMutation((m: CsvMapping | null) => bankingApi.preview(bankAccountId, { csv, mapping: m ?? undefined }))
  const doImport = useBankingMutation(() => bankingApi.importStatement(bankAccountId, { csv, fileName, mapping: mapping ?? undefined, includeDuplicates }))

  useEffect(() => {
    if (!csv) return
    doPreview.mutate(mapping, {
      onSuccess: (p) => {
        setPreview(p)
        setError(null)
        if (!mapping) setMapping(p.suggestedMapping)
      },
      onError: (e) => setError(e.message),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csv, mapping])

  const cols = preview?.columns ?? []
  const colSelect = (key: keyof CsvMapping, label: string, optional = true) => (
    <Field id={`map-${key}`} label={label}>
      <SelectInput
        id={`map-${key}`}
        value={mapping?.[key] === null || mapping?.[key] === undefined ? '' : String(mapping[key])}
        onChange={(e) => setMapping((m) => (m ? { ...m, [key]: e.target.value === '' ? null : Number(e.target.value) } : m))}
      >
        {optional && <option value="">—</option>}
        {cols.map((c, i) => <option key={i} value={i}>{c || `Column ${i + 1}`}</option>)}
      </SelectInput>
    </Field>
  )
  const signed = mapping ? mapping.amount !== null : true

  return (
    <Modal
      open
      onClose={onClose}
      title="Import bank statement"
      description="CSV from your bank. Lines already imported for this account are flagged as duplicates and skipped."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            disabled={!preview || preview.errors > 0}
            loading={doImport.isPending}
            onClick={() => doImport.mutate(undefined, { onSuccess: (s) => { toast.success('Statement imported', `${s.lineCount} lines${s.skippedDuplicates ? ` · ${s.skippedDuplicates} duplicates skipped` : ''}`); onClose() }, onError: (e) => toast.error('Not imported', e.message) })}
          >
            Import {preview ? preview.lines.filter((l) => !l.error && (includeDuplicates || !l.duplicate)).length : ''} lines
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.8125rem]">
        <Field id="stmt-file" label="Statement file (.csv)">
          <input
            id="stmt-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            className="block w-full text-[0.8125rem]"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setFileName(f.name)
              setMapping(null)
              setCsv(await f.text())
            }}
          />
        </Field>
        {error && <p role="alert" className="text-danger-600">{error}</p>}
        {mapping && preview && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {colSelect('date', 'Date', false)}
              {colSelect('description', 'Description', false)}
              {colSelect('reference', 'Reference')}
              <Field id="map-mode" label="Amounts">
                <SelectInput id="map-mode" value={signed ? 'signed' : 'split'} onChange={(e) => setMapping((m) => (m ? (e.target.value === 'signed' ? { ...m, amount: m.debit ?? 0, debit: null, credit: null } : { ...m, amount: null, debit: m.amount ?? 0, credit: (m.amount ?? 0) + 1 }) : m))}>
                  <option value="signed">One signed column</option>
                  <option value="split">Debit and credit columns</option>
                </SelectInput>
              </Field>
              {signed ? colSelect('amount', 'Amount', false) : (
                <>
                  {colSelect('debit', 'Debit (money out)', false)}
                  {colSelect('credit', 'Credit (money in)', false)}
                </>
              )}
              {colSelect('balance', 'Balance')}
              <Field id="map-fmt" label="Date format">
                <SelectInput id="map-fmt" value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}>
                  {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </SelectInput>
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><Checkbox checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} />First row is a header</label>
              {signed && <label className="flex items-center gap-2"><Checkbox checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} />Positive amounts are money out</label>}
              <label className="flex items-center gap-2"><Checkbox checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />Import duplicates too</label>
            </div>
            <p className="text-muted">
              {preview.lines.length} lines · in <Amount value={preview.totalIn} /> · out <Amount value={preview.totalOut} />
              {preview.closingBalance !== null && <> · closing balance <Amount value={preview.closingBalance} /></>}
              {preview.duplicates ? ` · ${preview.duplicates} duplicates` : ''}
              {preview.errors ? ` · ${preview.errors} errors` : ''}
            </p>
            <SimpleTable label="Statement preview" className="max-h-72 overflow-y-auto" head={<tr><th className={th}>Row</th><th className={th}>Date</th><th className={th}>Description</th><th className={thEnd}>Amount</th><th className={th} /></tr>}>
              {preview.lines.slice(0, 50).map((l) => (
                <tr key={l.row}>
                  <td className={td}>{l.row}</td>
                  <td className={td}>{l.date ? fmtDate(l.date) : '—'}</td>
                  <td className={td}>{l.description}</td>
                  <td className={tdEnd}><Amount value={l.amount} /></td>
                  <td className={td}>{l.error ? <Badge tone="red">{l.error}</Badge> : l.duplicate ? <Badge tone="amber">Duplicate</Badge> : null}</td>
                </tr>
              ))}
            </SimpleTable>
          </>
        )}
      </div>
    </Modal>
  )
}
