const STATUS = {
  match: { label: 'OK', className: 'bg-ok-soft text-ok' },
  mismatch: { label: 'Incongruencia', className: 'bg-bad-soft text-bad' },
  warning: { label: 'Aviso', className: 'bg-warn-soft text-warn' },
  relocated: { label: 'Ajuste', className: 'bg-info-soft text-info' },
  extra: { label: 'Solo HBL', className: 'bg-paper-2 text-muted' },
}

export default function FieldCard({ item }) {
  const meta = STATUS[item.status] || STATUS.extra
  const bar =
    item.status === 'mismatch'
      ? 'bg-bad'
      : item.status === 'warning'
        ? 'bg-warn'
        : item.status === 'match'
          ? 'bg-ok'
          : item.status === 'relocated'
            ? 'bg-info'
            : 'bg-muted/40'

  return (
    <article className="relative overflow-hidden border border-paper-2 bg-white p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <div className="flex flex-wrap items-start justify-between gap-2 pl-2">
        <h4 className="text-sm font-semibold text-ink">{item.label}</h4>
        <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.className}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-3 grid gap-3 pl-2 sm:grid-cols-2">
        <ValueBlock caption="Proforma" value={item.proforma} />
        <ValueBlock caption="HBL" value={item.hbl} />
      </div>
      {item.detail ? <p className="mt-3 pl-2 text-xs text-muted">{item.detail}</p> : null}
    </article>
  )
}

function ValueBlock({ caption, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted">{caption}</p>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-5 text-ink">
        {value || '—'}
      </pre>
    </div>
  )
}
