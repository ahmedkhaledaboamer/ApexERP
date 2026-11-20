import { useCallback, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { getPublicForm } from '@/modules/marketing/growth/api'
import { PublicFormRenderer } from '@/modules/marketing/growth/components/PublicFormRenderer'
import { ApiError } from '@/shared/lib/apiError'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * `/f/:key`: a lead capture form's hosted page (no sign-in, no workspace screen). `?embed=1` is the
 * iframe of the embed snippet: no page chrome, and the page tells the parent its height
 * (postMessage `{ apexFormHeight, key }`). Each load counts one view of the form.
 */
export default function PublicFormPage() {
  const { key = '' } = useParams()
  const [params] = useSearchParams()
  const embed = params.get('embed') === '1'
  const info = useQuery({ queryKey: ['public-form', key], queryFn: () => getPublicForm(key), retry: false, staleTime: Infinity })
  const ref = useRef<HTMLDivElement>(null)

  const postHeight = useCallback(() => {
    if (!embed || window.parent === window) return
    requestAnimationFrame(() => {
      const h = ref.current?.scrollHeight
      if (h) window.parent.postMessage({ apexFormHeight: h + 16, key }, '*')
    })
  }, [embed, key])
  useEffect(postHeight, [postHeight, info.status])

  const body = info.isPending ? (
    <div className="space-y-3">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-40" />
    </div>
  ) : info.error ? (
    <div role="alert" className="py-6 text-center">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-sunken text-muted [&_svg]:size-6">
        <FileQuestion />
      </div>
      <h1 className="text-[1.25rem] font-semibold tracking-tight">Form not found</h1>
      <p className="mt-2 text-[0.875rem] text-muted">
        {info.error instanceof ApiError && info.error.status === 404 ? 'Check the link you were given, or contact the company directly.' : info.error.message}
      </p>
    </div>
  ) : (
    <>
      {!embed && (
        <header className="mb-5">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{info.data.organizerName}</p>
          <h1 className="mt-1 text-[1.375rem] leading-tight font-semibold tracking-[-0.02em]">{info.data.name}</h1>
        </header>
      )}
      <PublicFormRenderer form={info.data} channel={embed ? 'embed' : 'hosted'} onHeightChange={postHeight} />
    </>
  )

  if (embed) {
    return (
      <div ref={ref} className="bg-surface p-4">
        {body}
      </div>
    )
  }
  return (
    <div className="min-h-full bg-canvas px-4 py-10 sm:py-16">
      <main className="mx-auto w-full max-w-lg">
        <div ref={ref} className="rounded-card border border-line bg-surface p-6 shadow-soft sm:p-8">
          {body}
        </div>
        <p className="mt-6 text-center text-[0.75rem] text-subtle">{PRODUCT_NAME}</p>
      </main>
    </div>
  )
}
