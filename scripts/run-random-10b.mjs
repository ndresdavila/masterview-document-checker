import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import { parseProformaArrayBuffer } from '../src/lib/parseProforma.js'
import { parseHblFromPdfWords } from '../src/lib/parseHbl.js'
import { compareDocs } from '../src/lib/compare.js'

pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../random-10b')
const ids = fs.readdirSync(root).filter((name) => fs.statSync(path.join(root, name)).isDirectory()).sort()

async function parsePdf(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath))
  const pdf = await pdfjs.getDocument({ data }).promise
  let page1Words = null
  const extra = []
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const words = content.items
      .filter((it) => it.str != null)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: viewport.height - it.transform[5],
      }))
    if (n === 1) page1Words = words
    else extra.push(words.map((w) => w.str).join(' '))
  }
  return parseHblFromPdfWords(page1Words, path.basename(filePath), extra.join('\n'))
}

const summary = []
for (const id of ids) {
  const dir = path.join(root, id)
  const files = fs.readdirSync(dir)
  const profName = files.find((f) => /\.xlsx?$/i.test(f))
  const source = fs.existsSync(path.join(dir, 'source.txt'))
    ? fs.readFileSync(path.join(dir, 'source.txt'), 'utf8').replace(/\s+/g, ' ').trim()
    : ''
  const pBuf = fs.readFileSync(path.join(dir, profName))
  const proforma = parseProformaArrayBuffer(
    pBuf.buffer.slice(pBuf.byteOffset, pBuf.byteOffset + pBuf.byteLength),
    profName,
  )
  const hbl = await parsePdf(path.join(dir, 'hbl-draft.pdf'))
  const result = compareDocs(proforma, hbl)
  const mismatches = result.items.filter((i) => i.status === 'mismatch')
  const warnings = result.items.filter((i) => i.status === 'warning')
  summary.push({ id, score: result.score, mismatch: mismatches.length, warn: warnings.length })
  console.log(`\n======== ${id}  score=${result.score}%  mismatch=${mismatches.length}  warn=${warnings.length} ========`)
  console.log(source)
  console.log(`vessel P:${proforma.vessel}/${proforma.voyage}  H:${hbl.vessel}/${hbl.voyage}`)
  console.log(`booking P:${proforma.bookingNo} H:${hbl.bookingNo}  ctr P:${proforma.containers.length} H:${hbl.containers.length}`)
  console.log(`consignee P:${(proforma.consignee?.name || '').slice(0, 40)}  pod P:${proforma.portDischarge}`)
  for (const item of mismatches) {
    const p = String(item.proforma).replace(/\s+/g, ' ').slice(0, 90)
    const h = String(item.hbl).replace(/\s+/g, ' ').slice(0, 90)
    console.log(`  [mismatch] ${item.label}: ${p} || ${h} — ${item.detail}`)
  }
  for (const item of warnings.slice(0, 5)) {
    console.log(`  [warning] ${item.label} — ${item.detail}`)
  }
}
console.log('\n===== RESUMEN =====')
for (const row of summary) console.log(`${row.id}  ${row.score}%  mm=${row.mismatch}  warn=${row.warn}`)
const avg = Math.round(summary.reduce((s, r) => s + r.score, 0) / summary.length)
console.log(`promedio=${avg}%  sin mismatch=${summary.filter((r) => r.mismatch === 0).length}/${summary.length}`)
