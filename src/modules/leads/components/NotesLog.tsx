import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAddNote, useLeadNotesQuery } from '@/modules/leads/hooks/useLeads'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { TextArea } from '@/shared/components/form/Field'

const noteSchema = z.object({
  body: z.string().trim().min(1, 'Write something before adding the note.').max(2000, 'Keep notes under 2000 characters.'),
})

type NoteValues = z.infer<typeof noteSchema>

export function NotesLog({ leadId, canAdd }: { leadId: string; canAdd: boolean }) {
  const query = useLeadNotesQuery(leadId)
  const add = useAddNote(leadId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NoteValues>({ resolver: zodResolver(noteSchema), defaultValues: { body: '' } })

  const onSubmit = handleSubmit(({ body }) => {
    add.mutate(body, { onSuccess: () => reset({ body: '' }) })
  })

  return (
    <div className="space-y-6">
      {canAdd && (
        <form noValidate onSubmit={onSubmit}>
          <label htmlFor="note-body" className="sr-only">
            New note
          </label>
          <TextArea
            id="note-body"
            placeholder="Add a note — what you learned, what they asked for…"
            invalid={!!errors.body}
            aria-describedby={errors.body ? 'note-body-error' : undefined}
            {...register('body')}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p id="note-body-error" className="text-xs text-danger-600 dark:text-danger-500">
              {errors.body?.message ?? (add.isError ? add.error.message : '')}
            </p>
            <Button type="submit" size="sm" loading={add.isPending}>
              Add note
            </Button>
          </div>
        </form>
      )}

      {query.isPending ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState title="No notes yet" body="Notes keep context the whole team can see, each with its author and date." />
      ) : (
        <ul className="divide-y divide-line">
          {query.data.map((n) => (
            <li key={n.id} className="flex gap-3 py-4 first:pt-0">
              <Avatar name={n.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  <span className="font-medium text-ink">{n.authorName}</span> · {fmtDate(n.createdAt, 'd MMM yyyy, HH:mm')}
                </p>
                <p className="mt-1 text-[0.8125rem] whitespace-pre-line text-ink-2">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
