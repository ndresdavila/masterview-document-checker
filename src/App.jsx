import { useEffect, useMemo, useState } from 'react'
import DropPanel from './components/DropPanel.jsx'
import ResultHero from './components/ResultHero.jsx'
import FieldCard from './components/FieldCard.jsx'
import { compareDocs, compareHblMbl, GROUPS } from './lib/compare.js'
import { parseDroppedFile, classifyFile } from './lib/files.js'

const FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'mismatch', label: 'Incongruencias' },
  { id: 'warning', label: 'Avisos' },
  { id: 'match', label: 'OK' },
  { id: 'expected', label: 'Ajustes' },
]

const MODES = [
  {
    id: 'proforma-hbl',
    label: 'Proforma → HBL',
    blurb: 'Comparación de proforma y HBL.',
  },
  {
    id: 'hbl-mbl',
    label: 'HBL → MBL',
    blurb: 'Comparación de HBL y MBL de la naviera (ZIM, COSCO u ONE).',
  },
]

export default function App() {
  const [mode, setMode] = useState('proforma-hbl')
  const [proformaFile, setProformaFile] = useState(null)
  const [hblFile, setHblFile] = useState(null)
  const [mblFile, setMblFile] = useState(null)
  const [proforma, setProforma] = useState(null)
  const [hbl, setHbl] = useState(null)
  const [mbl, setMbl] = useState(null)
  const [busy, setBusy] = useState({ proforma: false, hbl: false, mbl: false })
  const [errors, setErrors] = useState({ proforma: '', hbl: '', mbl: '' })
  const [filter, setFilter] = useState('all')

  async function loadSide(side, file) {
    setErrors((e) => ({ ...e, [side]: '' }))
    setBusy((b) => ({ ...b, [side]: true }))
    try {
      const doc = await parseDroppedFile(file, side)
      if (doc.kind === 'proforma') {
        setMode('proforma-hbl')
        setProformaFile(file)
        setProforma(doc)
        return
      }
      if (doc.kind === 'mbl') {
        setMode('hbl-mbl')
        setMblFile(file)
        setMbl(doc)
        return
      }
      setHblFile(file)
      setHbl(doc)
    } catch (err) {
      const message = err?.message || 'No se pudo leer el archivo'
      setErrors((e) => ({ ...e, [side]: message }))
    } finally {
      setBusy((b) => ({ ...b, [side]: false }))
    }
  }

  function onDropFile(side, file) {
    const kind = classifyFile(file, side)
    if (kind === 'proforma') loadSide('proforma', file)
    else if (kind === 'mbl') loadSide('mbl', file)
    else if (kind === 'hbl' || kind === 'old-word') loadSide('hbl', file)
    else loadSide(side, file)
  }

  function resetAll() {
    setProformaFile(null)
    setHblFile(null)
    setMblFile(null)
    setProforma(null)
    setHbl(null)
    setMbl(null)
    setErrors({ proforma: '', hbl: '', mbl: '' })
    setFilter('all')
  }

  const result = useMemo(() => {
    if (mode === 'hbl-mbl') {
      if (!hbl || !mbl) return null
      return compareHblMbl(hbl, mbl)
    }
    if (!proforma || !hbl) return null
    return compareDocs(proforma, hbl)
  }, [mode, proforma, hbl, mbl])

  const visible = useMemo(() => {
    if (!result) return []
    return result.items.filter((item) => {
      if (filter === 'all') return true
      if (filter === 'expected') return item.status === 'relocated' || item.status === 'extra'
      return item.status === filter
    })
  }, [result, filter])

  useEffect(() => {
    if (!result) return
    setFilter(result.counts.mismatch ? 'mismatch' : 'all')
  }, [proforma, hbl, mbl, mode])

  const captions = mode === 'hbl-mbl'
    ? { left: 'HBL', right: 'MBL', extra: 'Solo MBL' }
    : { left: 'Proforma', right: 'HBL', extra: 'Solo HBL' }

  const readyHint = mode === 'hbl-mbl'
    ? 'Cargue HBL y MBL para comparar.'
    : 'Cargue ambos archivos para comparar.'

  return (
    <div
      className="min-h-screen px-4 py-6 md:px-8"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files?.[0]
        if (!file) return
        const kind = classifyFile(file, mode === 'hbl-mbl' ? 'mbl' : 'proforma')
        if (kind === 'mbl') onDropFile('mbl', file)
        else if (kind === 'hbl') onDropFile('hbl', file)
        else onDropFile(kind === 'proforma' ? 'proforma' : mode === 'hbl-mbl' ? 'hbl' : 'proforma', file)
      }}
    >
      <header className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs text-muted">Masterview</p>
          <h1 className="text-2xl font-semibold text-navy">Revisiones</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {MODES.find((m) => m.id === mode)?.blurb}
          </p>
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

      <div className="mx-auto mt-6 flex max-w-6xl gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id)
              setFilter('all')
            }}
            className={`border px-3 py-1.5 text-sm ${
              mode === m.id
                ? 'border-navy bg-navy text-paper'
                : 'border-paper-2 bg-white text-muted hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <main className="mx-auto mt-6 max-w-6xl space-y-6">
        <div className="grid gap-5 lg:grid-cols-2">
          {mode === 'proforma-hbl' ? (
            <DropPanel
              side="proforma"
              title="Proforma"
              hint="Archivo de proforma (Excel o Word)"
              accept=".xls,.xlsx,.docx"
              file={proformaFile}
              doc={proforma}
              error={errors.proforma}
              busy={busy.proforma}
              onFile={(f) => onDropFile('proforma', f)}
            />
          ) : (
            <DropPanel
              side="hbl"
              title="HBL"
              hint="House BL (PDF o Word)"
              accept=".pdf,.docx,.doc"
              file={hblFile}
              doc={hbl}
              error={errors.hbl}
              busy={busy.hbl}
              onFile={(f) => onDropFile('hbl', f)}
            />
          )}
          {mode === 'proforma-hbl' ? (
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
          ) : (
            <DropPanel
              side="mbl"
              title="MBL"
              hint="PDF de la naviera (ZIM, COSCO u ONE)"
              accept=".pdf"
              file={mblFile}
              doc={mbl}
              error={errors.mbl}
              busy={busy.mbl}
              onFile={(f) => onDropFile('mbl', f)}
            />
          )}
        </div>

        {!result ? (
          <p className="text-center text-sm text-muted">{readyHint}</p>
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
                      <FieldCard key={item.id} item={item} captions={captions} />
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
