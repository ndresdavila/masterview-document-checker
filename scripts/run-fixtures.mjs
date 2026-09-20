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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures')
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

for (const id of ids) {
  const dir = path.join(root, id)
  const pBuf = fs.readFileSync(path.join(dir, 'proforma.xls'))
  const proforma = parseProformaArrayBuffer(pBuf.buffer.slice(pBuf.byteOffset, pBuf.byteOffset + pBuf.byteLength), 'proforma.xls')
  const hbl = await parsePdf(path.join(dir, 'hbl-draft.pdf'))
  const result = compareDocs(proforma, hbl)
  const mismatches = result.items.filter((i) => i.status === 'mismatch')
  const warnings = result.items.filter((i) => i.status === 'warning')
  console.log(`\n======== ${id}  score=${result.score}%  mismatch=${mismatches.length}  warn=${warnings.length} ========`)
  console.log(`vessel P:${proforma.vessel} / ${proforma.voyage}  H:${hbl.vessel} / ${hbl.voyage}`)
  console.log(`booking P:${proforma.bookingNo}  H:${hbl.bookingNo}`)
  console.log(`ctr P:${proforma.containers.map((c) => `${c.id}:${c.pkgs}:${c.seal}`).join(' | ')}`)
  console.log(`ctr H:${hbl.containers.map((c) => `${c.id}:${c.pkgs}:${c.seal}`).join(' | ')}`)
  for (const item of [...mismatches, ...warnings]) {
    const p = String(item.proforma).replace(/\s+/g, ' ').slice(0, 100)
    const h = String(item.hbl).replace(/\s+/g, ' ').slice(0, 100)
    console.log(`  [${item.status}] ${item.label}: ${p} || ${h} — ${item.detail}`)
  }
}
