import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useAiMe, useAiOn } from '../api'
import { recordPrompts } from '../prompts'
import type { AiRecordRef } from '../types'
import { AiChat } from './AiChat'

/**
 * "Ask AI" on a record page (lead, customer): a side panel whose questions carry the record as context
 * (`context` of POST /ai/conversations/:id/messages), with quick prompts (Summarize, Draft follow-up, Suggest services).
 * Hidden when the plan has no `ai`; disabled with the reason when the assistant is off for the role.
 */
export function AskAiButton({ record, label }: { record: AiRecordRef; label: string }) {
  const on = useAiOn()
  const me = useAiMe()
  const [open, setOpen] = useState(false)
  const [conversation, setConversation] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  if (!on) return null
  const off = me.data && !me.data.enabled ? me.data.disabledReason : null
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={!!off} title={off ?? undefined} data-testid="ask-ai">
        <Sparkles className="text-brand-600" />
        Ask AI
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-600" aria-hidden />
            Ask AI about {label}
          </span>
        }
        description="Answers use only what your role can see. Changes wait for your confirmation."
        width="lg"
        footer={
          <>
            {conversation && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConversation(null)
                  setSession((n) => n + 1)
                }}
              >
                New chat
              </Button>
            )}
            <Link to={conversation ? `/ai?c=${encodeURIComponent(conversation)}` : '/ai'} className="inline-flex h-8 items-center rounded-md px-2.5 text-[0.8125rem] font-medium text-brand-700 hover:bg-hover dark:text-brand-300">
              Open in AI assistant
            </Link>
          </>
        }
      >
        <div className="-mx-5 -my-5 flex h-[calc(100dvh-10rem)] flex-col px-4 py-2" data-testid="ask-ai-panel">
          <AiChat key={session} conversationId={conversation} onConversationChange={setConversation} context={record} suggestions={recordPrompts(record).map((p) => ({ label: p.label, prompt: p.prompt }))} compact disabledReason={off} />
        </div>
      </Drawer>
    </>
  )
}
