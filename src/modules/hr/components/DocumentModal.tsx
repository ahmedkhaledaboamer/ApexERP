import { useState } from 'react'
import type { DocumentInput, DocumentType, EmployeeDocument, HrFile } from '@/modules/hr/peopleTypes'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { useSaveDocument } from '@/modules/hr/hooks/useHrPeople'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { COUNTRIES, FileInput, FormError } from './PeopleBits'

/** Add / edit an employee document (HR full). The number is write-only: blank on edit keeps the stored one. */
export function DocumentModal({ employeeId, doc, onClose }: { employeeId: string; doc: EmployeeDocument | null; onClose: () => void }) {
  const save = useSaveDocument()
  const toast = useToast()
  const [type, setType] = useState<DocumentType>(doc?.type ?? 'passport')
  const [number, setNumber] = useState('')
  const [issueDate, setIssueDate] = useState(doc?.issueDate ?? '')
  const [expiryDate, setExpiryDate] = useState(doc?.expiryDate ?? '')
  const [country, setCountry] = useState(doc?.issuingCountry ?? 'AE')
  const [file, setFile] = useState<HrFile | null>(doc?.file ?? null)
  const [notes, setNotes] = useState(doc?.notes ?? '')
  const [touched, setTouched] = useState(false)
  const numberErr = touched && !doc && number.trim().length < 4 ? 'Enter the document number.' : undefined

  function submit() {
    setTouched(true)
    if (!doc && number.trim().length < 4) return
    const input: Partial<DocumentInput> = { type, issueDate: issueDate || null, expiryDate: expiryDate || null, issuingCountry: country, notes, file, ...(number.trim() ? { number } : {}) }
    save.mutate(
      { input, employeeId, id: doc?.id },
      {
        onSuccess: (d) => {
          toast.success(doc ? 'Document saved' : 'Document added', `${DOCUMENT_TYPE_LABEL[d.type]} ${d.numberMasked}`)
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={doc ? `Edit ${DOCUMENT_TYPE_LABEL[doc.type]}` : 'Add document'}
      description="Alerts go to HR and the manager 60 days before the expiry date and on expiry."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{doc ? 'Save document' : 'Add document'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="doc-type" label="Document type">
            <SelectInput id="doc-type" value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABEL[t]}</option>
              ))}
            </SelectInput>
          </Field>
          <Field id="doc-number" label="Document number" required={!doc} error={numberErr} hint={doc ? `Stored: ${doc.numberMasked}. Leave blank to keep it.` : 'Shown masked (last 4) everywhere.'}>
            <TextInput id="doc-number" autoComplete="off" value={number} invalid={!!numberErr} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field id="doc-issue" label="Issue date">
            <TextInput id="doc-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field id="doc-expiry" label="Expiry date">
            <TextInput id="doc-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </Field>
          <Field id="doc-country" label="Issuing country">
            <SelectInput id="doc-country" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field id="doc-file" label="Scan / file" hint="Counts against the plan’s storage.">
          <FileInput id="doc-file" value={file} onChange={setFile} />
        </Field>
        <Field id="doc-notes" label="Notes">
          <TextArea id="doc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <FormError error={save.error} />
      </div>
    </Modal>
  )
}
