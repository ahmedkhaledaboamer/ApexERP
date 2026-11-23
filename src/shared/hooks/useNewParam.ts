import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * `?new=1` (or `?new=<kind>`) on a page opens its create form once: the header "+ New" menu and the command
 * palette link here (shared/components/layout/createActions.ts). The param is removed right after opening
 * (history replace), so back / refresh don't open the form again.
 * `when`: wait, keeping the param, until the page can open the form (the role may, its data has loaded).
 */
export function useNewParam(open: () => void, { kind = '1', when = true }: { kind?: string; when?: boolean } = {}): void {
  const [params, setParams] = useSearchParams()
  const hit = params.get('new') === kind
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  useEffect(() => {
    if (!hit || !when) return
    openRef.current()
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('new')
        return next
      },
      { replace: true },
    )
  }, [hit, when, setParams])
}
