/** Semicircle gauge (target vs actual). The arc is capped at 100%; the label shows the real %. */
export function Gauge({ percent, label, color = '#10b981' }: { percent: number; label: string; color?: string }) {
  const r = 80
  const circumference = Math.PI * r
  const shown = Math.max(0, Math.min(100, percent))
  return (
    <div className="relative mx-auto w-full max-w-[15rem]">
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={`${Math.round(percent)}% ${label}`}>
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--color-sunken)" strokeWidth="18" strokeLinecap="round" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${(shown / 100) * circumference} ${circumference}`}
          style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.23,1,0.32,1)' }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="num text-[2.125rem] leading-none font-bold tracking-[-0.02em]">{Math.round(percent)}%</p>
        <p className="mt-1 text-[0.8125rem] text-muted">{label}</p>
      </div>
    </div>
  )
}
