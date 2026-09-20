import * as XLSX from '../node_modules/xlsx/xlsx.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve(here, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href
const root = path.resolve(here, '../random-10b')

async function pdfText(file) {
  const data = new Uint8Array(fs.readFileSync(file))
  const pdf = await pdfjs.getDocument({ data }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((i) => i.str).join('|')
}

function dumpExcel(id, from = 0, to = 70) {
  const dir = path.join(root, id)
  const prof = fs.readdirSync(dir).find((f) => f.endsWith('.xls') || f.endsWith('.xlsx'))
  const wb = XLSX.read(fs.readFileSync(path.join(dir, prof)), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  console.log(`\n======== EXCEL ${id} ========`)
  rows.slice(from, to).forEach((row, i) => {
    const r = i + from
    const cells = row
      .map((c, j) => {
        const s = String(c ?? '').replace(/\s+/g, ' ').trim()
        return s ? `${j}:${s.slice(0, 78)}` : ''
      })
      .filter(Boolean)
    if (cells.length) console.log(String(r).padStart(2, '0') + ' ' + cells.join(' | '))
  })
}

const ids = fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory()).sort()
for (const id of ids) dumpExcel(id, 8, 68)

for (const id of ids) {
  const dir = path.join(root, id)
  const text = await pdfText(path.join(dir, 'hbl-draft.pdf'))
  const up = text.toUpperCase()
  const v = up.indexOf('VESSEL')
  const c = Math.max(up.indexOf('CONTAINER'), up.indexOf('CONTENEDOR'))
  const d = up.indexOf('DAE')
  const b = up.indexOf('BOOKING')
  console.log(`\n======== PDF ${id} ========`)
  if (b >= 0) console.log('BOOKING', text.slice(b, b + 180))
  if (v >= 0) console.log('VESSEL', text.slice(v, v + 220))
  if (c >= 0) console.log('CARGO', text.slice(c, c + 420))
  if (d >= 0) console.log('DAE', text.slice(d, d + 120))
}
