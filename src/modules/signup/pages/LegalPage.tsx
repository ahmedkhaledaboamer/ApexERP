import { Link } from 'react-router-dom'
import { PATHS } from '@/app/paths'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { ProductShell } from '@/modules/signup/components/SignupParts'

interface Section {
  title: string
  body: string
}

const TERMS: Section[] = [
  {
    title: 'Your workspace',
    body: `${PRODUCT_NAME} gives your company a private workspace at its own address. The person who creates it becomes its Company Admin and is responsible for who is invited and what they can see.`,
  },
  {
    title: 'Acceptable use',
    body: 'Use the service for lawful business purposes only. Don’t send unsolicited bulk messages, upload malware, or try to reach another workspace’s data.',
  },
  {
    title: 'Plans and billing',
    body: 'Trials are free for their stated length. Paid plans are billed monthly per workspace in advance and can be cancelled at any time; the plan stays active until the end of the paid period.',
  },
  {
    title: 'Your data',
    body: 'You own the data you put in your workspace. You can export it at any time, and we delete it after the workspace is closed and the retention period has passed.',
  },
  {
    title: 'Availability',
    body: 'We aim to keep the service available around the clock and announce planned maintenance in advance. The service is provided as is, within the limits allowed by law.',
  },
]

const PRIVACY: Section[] = [
  {
    title: 'What we collect',
    body: 'Account details (name, work email, mobile), the company details you enter, and the records you create in your workspace. We also keep sign-in and security logs.',
  },
  {
    title: 'How we use it',
    body: 'To run your workspace, secure your account, send the emails you ask the system to send, and support you. We never sell your data or use your records for advertising.',
  },
  {
    title: 'Where it lives',
    body: 'Each company’s data is kept separate from every other company’s. Backups are encrypted and kept for a limited time.',
  },
  {
    title: 'Your choices',
    body: 'You can correct your details in My account, and your Company Admin can export or delete company data. Contact us to exercise any other privacy right.',
  },
]

/** Plain Terms of Service and Privacy Policy pages (product level, no workspace). */
export default function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const terms = kind === 'terms'
  const sections = terms ? TERMS : PRIVACY
  return (
    <ProductShell>
      <article>
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Legal</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">{terms ? 'Terms of Service' : 'Privacy Policy'}</h1>
        <p className="mt-1.5 text-[0.8125rem] text-muted">Last updated 1 November 2026. A summary for the {PRODUCT_NAME} demo.</p>
        <div className="mt-8 space-y-6">
          {sections.map((s, i) => (
            <section key={s.title}>
              <h2 className="text-sm font-semibold text-ink">
                {i + 1}. {s.title}
              </h2>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">{s.body}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 text-[0.8125rem] text-muted">
          See also the{' '}
          <Link to={terms ? PATHS.legalPrivacy : PATHS.legalTerms} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
            {terms ? 'Privacy Policy' : 'Terms of Service'}
          </Link>
          , or{' '}
          <Link to={PATHS.signup} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
            create a workspace
          </Link>
          .
        </p>
      </article>
    </ProductShell>
  )
}
