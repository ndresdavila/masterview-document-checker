export default function DropPanel({
  side,
  title,
  hint,
  accept,
  file,
  doc,
  error,
  busy,
  onFile,
}) {
  const chips = []
  if (doc?.kind === 'proforma') {
    if (doc.marks?.lote) chips.push(`Lote ${doc.marks.lote}`)
    if (doc.bookingNo) chips.push(`BKG ${doc.bookingNo}`)
    if (doc.containers?.length) chips.push(`${doc.containers.length} contenedores`)
  }
  if (doc?.kind === 'hbl') {
    if (doc.blNo) chips.push(doc.blNo)
    if (doc.bookingNo) chips.push(`BKG ${doc.bookingNo}`)
    if (doc.voyage) chips.push(doc.voyage)
  }

  return (
    <section className="paper-card flex min-h-[240px] flex-col p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-navy">{title}</h2>
        <span className="text-xs text-muted">{side === 'proforma' ? 'Excel' : 'PDF / Word'}</span>
      </div>

      <label
        className={`relative flex flex-1 cursor-pointer flex-col items-center justify-center border border-dashed px-6 py-8 text-center ${
          file ? 'border-navy/30 bg-paper' : 'border-navy/20 bg-white hover:border-navy/40'
        }`}
      >
        <input
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const next = e.target.files?.[0]
            if (next) onFile(next)
            e.target.value = ''
          }}
        />
        {busy ? (
          <p className="text-sm text-muted">Leyendo archivo…</p>
        ) : file ? (
          <>
            <p className="text-xs text-muted">Cargado</p>
            <p className="mt-2 max-w-full truncate text-sm font-semibold text-ink">{file.name}</p>
            {chips.length ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {chips.map((c) => (
                  <span key={c} className="border border-paper-2 bg-paper px-2 py-1 text-[11px] text-ink">
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted">Seleccione otro archivo para reemplazar</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-ink">{hint}</p>
            <p className="mt-1 text-xs text-muted">Arrastre el archivo o haga clic para seleccionarlo</p>
          </>
        )}
      </label>

      {error ? (
        <p className="mt-3 border border-bad/20 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>
      ) : null}
    </section>
  )
}
