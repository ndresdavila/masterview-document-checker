import { useEffect, useMemo, useState } from 'react'
import DropPanel from './components/DropPanel.jsx'
import ResultHero from './components/ResultHero.jsx'
import FieldCard from './components/FieldCard.jsx'
import { compareDocs, GROUPS } from './lib/compare.js'
import { parseDroppedFile, classifyFile } from './lib/files.js'

const FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'mismatch', label: 'Incongruencias' },
  { id: 'warning', label: 'Avisos' },
  { id: 'match', label: 'OK' },
  { id: 'expected', label: 'Ajustes' },
]

export default function App() {
  const [proformaFile, setProformaFile] = useState(null)
  const [hblFile, setHblFile] = useState(null)
  const [proforma, setProforma] = useState(null)
  const [hbl, setHbl] = useState(null)
  const [busy, setBusy] = useState({ proforma: false, hbl: false })
  const [errors, setErrors] = useState({ proforma: '', hbl: '' })
  const [filter, setFilter] = useState('all')

  async function loadSide(side, file) {
    setErrors((e) => ({ ...e, [side]: '' }))
    setBusy((b) => ({ ...b, [side]: true }))
    try {
      const doc = await parseDroppedFile(file, side)
      if (side === 'proforma') {
        setProformaFile(file)
        setProforma(doc)
      } else {
        setHblFile(file)
        setHbl(doc)
      }
    } catch (err) {
      const message = err?.message || 'No se pudo leer el archivo'
      setErrors((e) => ({ ...e, [side]: message }))
    } finally {
      setBusy((b) => ({ ...b, [side]: false }))
    }
  }

  function onDropFile(side, file) {
    const kind = classifyFile(file)
    if (kind === 'proforma') loadSide('proforma', file)
    else if (kind === 'hbl' || kind === 'hbl-old') loadSide('hbl', file)
    else loadSide(side, file)
  }

  function resetAll() {
    setProformaFile(null)
    setHblFile(null)
    setProforma(null)
    setHbl(null)
    setErrors({ proforma: '', hbl: '' })
    setFilter('all')
  }

  const result = useMemo(() => {
    if (!proforma || !hbl) return null
    return compareDocs(proforma, hbl)
  }, [proforma, hbl])

  const visible = useMemo(() => {
    if (!result) return []
    return result.items.filter((item) => {
      if (filter === 'all') return true
      if (filter === 'expected') return item.status === 'relocated' || item.status === 'extra'
      return item.status === filter
    })
  }, [result, filter])

  useEffect(() => {
    if (!proforma || !hbl) return
    setFilter(compareDocs(proforma, hbl).counts.mismatch ? 'mismatch' : 'all')
  }, [proforma, hbl])

  return (
    <div
      className="min-h-screen px-4 py-6 md:px-8"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files?.[0]
        if (file) onDropFile(classifyFile(file) === 'hbl' ? 'hbl' : 'proforma', file)
      }}
    >
      <header className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs text-muted">Masterview</p>
          <h1 className="text-2xl font-semibold text-navy">Revisiones</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Comparación de proforma y HBL.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetAll}
            className="border border-navy/20 bg-white px-3 py-1.5 text-sm text-navy hover:bg-paper"
          >
            Limpiar
          </button>
        </div>
      </header>

      <main className="mx-auto mt-8 max-w-6xl space-y-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <DropPanel
            side="proforma"
            title="Proforma"
            hint="Archivo Excel de proforma"
            accept=".xls,.xlsx"
            file={proformaFile}
            doc={proforma}
            error={errors.proforma}
            busy={busy.proforma}
            onFile={(f) => onDropFile('proforma', f)}
          />
          <DropPanel
            side="hbl"
            title="HBL"
            hint="Archivo HBL (PDF o Word)"
            accept=".pdf,.docx,.doc"
            file={hblFile}
            doc={hbl}
            error={errors.hbl}
            busy={busy.hbl}
            onFile={(f) => onDropFile('hbl', f)}
          />
        </div>

        {!result ? (
          <p className="text-center text-sm text-muted">Cargue ambos archivos para comparar.</p>
        ) : (
          <>
            <ResultHero result={result} />

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`border px-3 py-1.5 text-xs ${
                    filter === f.id
                      ? 'border-navy bg-navy text-paper'
                      : 'border-paper-2 bg-white text-muted hover:text-ink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {GROUPS.map((group) => {
              const rows = visible.filter((i) => i.group === group)
              if (!rows.length) return null
              return (
                <section key={group}>
                  <h3 className="mb-3 text-sm font-semibold uppercase text-muted">{group}</h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {rows.map((item) => (
                      <FieldCard key={item.id} item={item} />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
