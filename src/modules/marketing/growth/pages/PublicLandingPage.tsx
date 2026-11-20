import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileQuestion } from 'lucide-react'
import { getPublicLandingPage } from '@/modules/marketing/growth/api'
import { PublicFormRenderer } from '@/modules/marketing/growth/components/PublicFormRenderer'
import { ApiError } from '@/shared/lib/apiError'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * `/p/:slug`: a published landing page (no sign-in). The company is the workspace the page is opened
 * on (its address; `?workspace=` in dev), so slugs only need to be unique per company. Shows the
 * hero image, headline, body and the attached lead capture form.
 */
export default function PublicLandingPage() {
  const { slug = '' } = useParams()
  const page = useQuery({ queryKey: ['public-landing', slug], queryFn: () => getPublicLandingPage(slug), retry: false, staleTime: Infinity })
  useEffect(() => {
    if (page.data) document.title = page.data.title
  }, [page.data])

  if (page.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-16">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (page.error) {
    return (
      <div className="grid min-h-full place-items-center bg-canvas px-4 py-16">
        <div role="alert" className="max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-sunken text-muted [&_svg]:size-6">
            <FileQuestion />
          </div>
          <h1 className="text-[1.25rem] font-semibold tracking-tight">Page not found</h1>
          <p className="mt-2 text-[0.875rem] text-muted">
            {page.error instanceof ApiError && page.error.status === 404 ? 'This page doesn’t exist or isn’t published.' : page.error.message}
          </p>
        </div>
      </div>
    )
  }
  const p = page.data
  return (
    <div className="min-h-full bg-canvas">
      <main className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1fr_24rem]">
        <section>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{p.organizerName}</p>
          <h1 className="mt-2 text-[2rem] leading-tight font-semibold tracking-[-0.03em] text-ink sm:text-[2.5rem]">{p.headline || p.title}</h1>
          {p.heroImageUrl && <img src={p.heroImageUrl} alt="" className="mt-6 aspect-[16/9] w-full rounded-card border border-line object-cover" />}
          {p.body && <div className="mt-6 space-y-4 text-[1rem] leading-relaxed whitespace-pre-line text-ink-2">{p.body}</div>}
        </section>
        {p.form && (
          <aside className="h-fit rounded-card border border-line bg-surface p-6 shadow-soft">
            <h2 className="mb-4 text-base font-semibold text-ink">{p.form.name}</h2>
            <PublicFormRenderer form={p.form} channel="landing" landingPage={slug} />
          </aside>
        )}
      </main>
      <p className="pb-8 text-center text-[0.75rem] text-subtle">{PRODUCT_NAME}</p>
    </div>
  )
}
