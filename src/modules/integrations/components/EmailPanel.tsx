import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, Mail, RefreshCw, Send, Unplug, XCircle } from 'lucide-react'
import type { EmailIntegration, OAuthConsent, OAuthProvider, Sender, SenderPurpose, SmtpSecurity } from '@/modules/integrations/types'
import { EMAIL_PROVIDER_LABEL, SENDER_PURPOSES } from '@/modules/integrations/types'
import { integrationsApi, useEmail, useIntegrationMutation } from '@/modules/integrations/api'
import { CopyButton } from '@/modules/marketing/growth/components/bits'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { ErrorNote, Facts, OAuthConsentModal, Section, when } from './shared'

type Mode = 'oauth' | 'smtp'

/** Email sending: SMTP or Google Workspace / Microsoft 365 (mock OAuth), test, domain authentication, senders. */
export function EmailPanel({ canEdit }: { canEdit: boolean }) {
  const q = useEmail()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  return <EmailBody email={q.data} canEdit={canEdit} />
}

function EmailBody({ email, canEdit }: { email: EmailIntegration; canEdit: boolean }) {
  const toast = useToast()
  const user = useCurrentUser()
  const [mode, setMode] = useState<Mode>(email.provider === 'smtp' ? 'smtp' : 'oauth')
  const [consent, setConsent] = useState<OAuthConsent | null>(null)
  const [testTo, setTestTo] = useState(user?.email ?? '')
  const start = useIntegrationMutation((p: OAuthProvider) => integrationsApi.oauthStart('email', p))
  const finish = useIntegrationMutation(integrationsApi.connectEmail)
  const test = useIntegrationMutation(integrationsApi.testEmail)
  const verify = useIntegrationMutation(integrationsApi.verifyDomain)
  const disconnect = useIntegrationMutation(integrationsApi.disconnectEmail)
  const err = (title: string) => (e: Error) => toast.error(title, e.message)

  return (
    <div className="space-y-5">
      <Section title="Connection" hint="Emails to leads, invoices and statements go out from your own domain.">
        {email.provider ? (
          <div className="space-y-3">
            <Facts
              rows={[
                ['Provider', EMAIL_PROVIDER_LABEL[email.provider]],
                ['Connected as', <span data-testid="email-connected-as">{email.connectedAs}</span>],
                ...(email.smtp ? ([['Server', `${email.smtp.host}:${email.smtp.port} (${email.smtp.security})`], ['Password', email.passwordHint ?? '—']] as [string, string][]) : ([['Token', email.tokenHint ?? '—']] as [string, string][])),
                ['From', `${email.fromName} <${email.fromAddress}>`],
                ['Connected', `${when(email.connectedAt)}${email.connectedBy ? ` by ${email.connectedBy}` : ''}`],
                ['Last test', email.lastTestAt ? <span>{when(email.lastTestAt)} · {email.lastTestStatus === 'success' ? <Badge tone="green">Sent</Badge> : <Badge tone="red">Failed</Badge>}</span> : 'Never'],
              ]}
            />
            {email.lastError && <ErrorNote>{email.lastError}</ErrorNote>}
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <Field id="test-to" label="Send a test email to" className="min-w-56 flex-1">
                  <TextInput id="test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                </Field>
                <Button write variant="secondary" loading={test.isPending} onClick={() => test.mutate(testTo, { onSuccess: (r) => (r.lastTestStatus === 'success' ? toast.success('Test email sent', `To ${testTo}. It’s in the email log.`) : toast.error('Test failed', r.lastError ?? '')), onError: err('Test failed') })}>
                  <Send />
                  Send test
                </Button>
                <Button write variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.success('Email sending disconnected'), onError: err('Couldn’t disconnect') })}>
                  <Unplug />
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[0.8125rem] text-muted">Not connected. Emails can’t be sent from your domain yet.</p>
        )}
        {canEdit && (
          <div className="space-y-3 rounded-lg border border-line p-4">
            <Segmented<Mode>
              label="Connection type"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'oauth', label: 'Google / Microsoft' },
                { value: 'smtp', label: 'SMTP server' },
              ]}
            />
            {mode === 'oauth' ? (
              <div className="flex flex-wrap gap-2">
                {(['google', 'microsoft'] as OAuthProvider[]).map((p) => (
                  <Button key={p} write variant="secondary" loading={start.isPending && start.variables === p} onClick={() => start.mutate(p, { onSuccess: setConsent, onError: err('Couldn’t start sign-in') })}>
                    <Mail />
                    {email.provider === p ? 'Reconnect' : 'Connect'} {EMAIL_PROVIDER_LABEL[p]}
                  </Button>
                ))}
              </div>
            ) : (
              <SmtpForm email={email} />
            )}
          </div>
        )}
      </Section>

      <Section
        title="Domain authentication"
        hint={`Add these DNS records at your domain host so mail from ${email.domain} isn’t marked as spam.`}
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" loading={verify.isPending} onClick={() => verify.mutate(undefined, { onSuccess: (r) => toast.info('DNS checked', r.dns.every((d) => d.status === 'verified') ? 'All records verified.' : 'Some records aren’t found yet.'), onError: err('Check failed') })}>
              <RefreshCw />
              Verify
            </Button>
          )
        }
      >
        <ul className="divide-y divide-line rounded-lg border border-line">
          {email.dns.map((d) => (
            <li key={d.kind} className="space-y-1.5 px-3 py-2.5" data-testid={`dns-${d.kind}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.8125rem] font-semibold uppercase">{d.kind}</span>
                <Badge tone="neutral">{d.type}</Badge>
                {d.status === 'verified' ? (
                  <Badge tone="green" icon={<CheckCircle2 />}>Verified</Badge>
                ) : d.status === 'pending' ? (
                  <Badge tone="amber" icon={<Clock />}>Pending</Badge>
                ) : (
                  <Badge tone="red" icon={<XCircle />}>Doesn’t match</Badge>
                )}
                {d.checkedAt && <span className="text-xs text-muted">checked {when(d.checkedAt)}</span>}
              </div>
              <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                <span className="text-muted">Host</span>
                <code className="truncate font-mono">{d.host}</code>
                <CopyButton text={d.host} size="xs" />
                <span className="text-muted">Value</span>
                <code className="font-mono break-all">{d.value}</code>
                <CopyButton text={d.value} size="xs" />
              </div>
              {d.message && <p className="text-xs text-muted">{d.message}</p>}
            </li>
          ))}
        </ul>
      </Section>

      <Senders email={email} canEdit={canEdit} />
      <OAuthConsentModal
        consent={consent}
        busy={finish.isPending}
        onClose={() => setConsent(null)}
        onDecide={(approve) => {
          if (!consent) return
          finish.mutate(
            { state: consent.state, approve },
            {
              onSuccess: (r) => toast.success('Email connected', `Sending as ${r.connectedAs}.`),
              onError: err(approve ? 'Couldn’t connect' : 'Not connected'),
              onSettled: () => setConsent(null),
            },
          )
        }}
      />
    </div>
  )
}

function SmtpForm({ email }: { email: EmailIntegration }) {
  const toast = useToast()
  const save = useIntegrationMutation(integrationsApi.saveSmtp)
  const [f, setF] = useState({
    host: email.smtp?.host ?? '',
    port: String(email.smtp?.port ?? 587),
    security: (email.smtp?.security ?? 'starttls') as SmtpSecurity,
    username: email.smtp?.username ?? '',
    password: '',
    fromName: email.fromName,
    fromAddress: email.fromAddress,
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { ...f, port: Number(f.port), password: f.password || undefined },
          {
            onSuccess: () => {
              setF((x) => ({ ...x, password: '' }))
              toast.success('SMTP saved', 'Send a test email to check the connection.')
            },
            onError: (e) => toast.error('Couldn’t save', e.message),
          },
        )
      }}
    >
      <Field id="smtp-host" label="Host" required>
        <TextInput id="smtp-host" value={f.host} onChange={set('host')} placeholder="smtp.yourdomain.com" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="smtp-port" label="Port" required>
          <TextInput id="smtp-port" inputMode="numeric" value={f.port} onChange={set('port')} />
        </Field>
        <Field id="smtp-security" label="Security">
          <SelectInput id="smtp-security" value={f.security} onChange={set('security')}>
            <option value="starttls">STARTTLS</option>
            <option value="ssl">SSL/TLS</option>
            <option value="none">None</option>
          </SelectInput>
        </Field>
      </div>
      <Field id="smtp-user" label="Username" required>
        <TextInput id="smtp-user" value={f.username} onChange={set('username')} autoComplete="off" />
      </Field>
      <Field id="smtp-password" label="Password" hint={email.passwordHint ? `Stored (${email.passwordHint}). Leave empty to keep it.` : 'Write-only: it’s never shown again.'}>
        <TextInput id="smtp-password" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
      </Field>
      <Field id="smtp-from-name" label="From name">
        <TextInput id="smtp-from-name" value={f.fromName} onChange={set('fromName')} />
      </Field>
      <Field id="smtp-from" label="From address" required>
        <TextInput id="smtp-from" type="email" value={f.fromAddress} onChange={set('fromAddress')} />
      </Field>
      <div className="sm:col-span-2">
        <Button write type="submit" loading={save.isPending}>
          Save SMTP
        </Button>
      </div>
    </form>
  )
}

function Senders({ email, canEdit }: { email: EmailIntegration; canEdit: boolean }) {
  const toast = useToast()
  const save = useIntegrationMutation(integrationsApi.updateSenders)
  const [s, setS] = useState<Record<SenderPurpose, Sender>>(email.senders)
  useEffect(() => setS(email.senders), [email.senders])
  return (
    <Section title="Default senders" hint={`Who emails come from, per purpose. Addresses must be on ${email.domain}.`}>
      <div className="space-y-2">
        {SENDER_PURPOSES.map((p) => (
          <div key={p.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[9rem_1fr_1fr] sm:items-center">
            <span className="text-[0.8125rem] text-ink-2">{p.label}</span>
            <TextInput aria-label={`${p.label} name`} disabled={!canEdit} value={s[p.key].name} placeholder="Name" onChange={(e) => setS((x) => ({ ...x, [p.key]: { ...x[p.key], name: e.target.value } }))} />
            <TextInput aria-label={`${p.label} address`} disabled={!canEdit} value={s[p.key].address} placeholder={`team@${email.domain}`} onChange={(e) => setS((x) => ({ ...x, [p.key]: { ...x[p.key], address: e.target.value } }))} />
          </div>
        ))}
      </div>
      {canEdit && (
        <Button write size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate(s, { onSuccess: () => toast.success('Senders saved'), onError: (e) => toast.error('Couldn’t save', e.message) })}>
          Save senders
        </Button>
      )}
    </Section>
  )
}
