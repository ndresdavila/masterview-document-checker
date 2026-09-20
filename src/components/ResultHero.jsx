function Donut({ counts, score }) {
  const parts = [
    { n: counts.match, color: '#1F6B3A' },
    { n: counts.mismatch, color: '#9B2C2C' },
    { n: counts.warning, color: '#8A6A12' },
    { n: counts.expected, color: '#2C4A7A' },
  ]
  const total = parts.reduce((s, p) => s + p.n, 0) || 1
  let acc = 0
  const segs = parts
    .filter((p) => p.n)
    .map((p) => {
      const start = acc / total
      acc += p.n
      const end = acc / total
      return { ...p, start, end }
    })

  const arc = (start, end) => {
    const a0 = start * Math.PI * 2 - Math.PI / 2
    const a1 = end * Math.PI * 2 - Math.PI / 2
    const r = 36
    const x0 = 50 + r * Math.cos(a0)
    const y0 = 50 + r * Math.sin(a0)
    const x1 = 50 + r * Math.cos(a1)
    const y1 = 50 + r * Math.sin(a1)
    const large = end - start > 0.5 ? 1 : 0
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
  }

  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24" role="img" aria-label={`${score}% coincidencia`}>
      <circle cx="50" cy="50" r="36" fill="none" stroke="#E8E8E8" strokeWidth="10" />
      {segs.map((s) => (
        <path
          key={s.color}
          d={arc(s.start, s.end)}
          fill="none"
          stroke={s.color}
          strokeWidth="10"
          strokeLinecap="butt"
        />
      ))}
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="18"
        fontWeight="700"
        fill="#1A1A1A"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        {score}%
      </text>
    </svg>
  )
}

export default function ResultHero({ result }) {
  const { score, counts } = result
  const parts = []
  if (counts.mismatch) {
    parts.push(`${counts.mismatch} incongruencia${counts.mismatch === 1 ? '' : 's'}`)
  }
  if (counts.warning) {
    parts.push(`${counts.warning} aviso${counts.warning === 1 ? '' : 's'}`)
  }
  if (counts.match) {
    parts.push(`${counts.match} coincidencia${counts.match === 1 ? '' : 's'}`)
  }
  if (counts.expected) {
    parts.push(`${counts.expected} ajuste${counts.expected === 1 ? '' : 's'}`)
  }

  return (
    <div className="paper-card p-5 md:p-6">
      <div className="flex items-center gap-4">
        <Donut counts={counts} score={score} />
        <div>
          <p className="text-xs text-muted">Resultado</p>
          <h3 className="mt-1 text-xl font-semibold text-navy">
            {counts.mismatch ? 'Incongruencias detectadas' : 'Sin incongruencias'}
          </h3>
          <p className="mt-1 text-sm text-muted">{parts.join('. ')}.</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Coinciden" value={counts.match} tone="ok" />
        <Stat label="Incongruencias" value={counts.mismatch} tone="bad" />
        <Stat label="Avisos" value={counts.warning} tone="warn" />
        <Stat label="Ajustes" value={counts.expected} tone="info" />
      </dl>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const color = {
    ok: 'text-ok',
    bad: 'text-bad',
    warn: 'text-warn',
    info: 'text-info',
  }[tone]
  return (
    <div className="border border-paper-2 bg-paper px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    </div>
  )
}
