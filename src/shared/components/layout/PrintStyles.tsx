/**
 * Print rules for "Export PDF", mounted only while a printable page (reports, dashboard) is open. The app shell
 * (sidebar, top bar, toasts) is hidden and the scrolling layout is unrolled so the current
 * report flows across pages. Pages mark their own non-print parts with `print:hidden`.
 */
const css = (orientation: 'landscape' | 'portrait', margin: string) => `
@media print {
  @page { size: A4 ${orientation}; margin: ${margin}; }
  html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
  body aside, body header, body [aria-live="polite"] { display: none !important; }
  #root .h-full, #root main { height: auto !important; overflow: visible !important; }
  #root main { display: block !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .recharts-wrapper, table, tr, li { break-inside: avoid; }
}
`

/** `orientation` / `margin`: badge sheets and tickets print A4 portrait. */
export function PrintStyles({ orientation = 'landscape', margin = '12mm' }: { orientation?: 'landscape' | 'portrait'; margin?: string } = {}) {
  return <style data-reports-print>{css(orientation, margin)}</style>
}
