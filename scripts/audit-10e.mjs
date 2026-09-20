import * as XLSX from '../node_modules/xlsx/xlsx.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve(here, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href

const root = path.resolve(here, '../random-10e')

async function pdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath))
  const pdf = await pdfjs.getDocument({ data }).promise
  const chunks = []
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    chunks.push(content.items.map((it) => it.str).join(' '))
  }
  return chunks.join('\n')
}

function dumpExcel(dir) {
  const prof = fs.readdirSync(dir).find((f) => /\.xlsx?$/i.test(f))
  const wb = XLSX.read(fs.readFileSync(path.join(dir, prof)), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  const hits = []
  rows.forEach((row, i) => {
    const cells = row
      .map((c, j) => {
        const s = String(c ?? '').replace(/\s+/g, ' ').trim()
        return s ? `${j}:${s}` : ''
      })
      .filter(Boolean)
    if (!cells.length) return
    const line = cells.join(' | ')
    if (/voyage|0L[A-Z0-9]+|vessel|booking|peso|neto|bruto|total|dae/i.test(line)) {
      hits.push(`${String(i).padStart(2, '0')} ${line.slice(0, 220)}`)
    }
  })
  return hits
}

const ids = ['03-6463507860', '08-zimugyl807048', '04-6461432810', '10-zimugyl810474']
for (const id of ids) {
  const dir = path.join(root, id)
  console.log(`\n======== ${id} EXCEL ========`)
  console.log(dumpExcel(dir).join('\n'))
  const text = await pdfText(path.join(dir, 'hbl-draft.pdf'))
  const compact = text.replace(/\s+/g, ' ')
  const voyage = compact.match(/0L[A-Z0-9]{5,}/g)
  const nets = compact.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*(?:KN|KB|KG|KGS)|TOTAL (?:NET|GROSS)[^\n]{0,40})/gi)
  console.log('HBL voyage tokens:', voyage)
  console.log('HBL weight-ish:', (nets || []).slice(0, 20))
  console.log('HBL snippet vessel:', compact.match(/VESSEL[^\n]{0,80}|FALCON[^\n]{0,40}|OCEANA[^\n]{0,40}|FORT ST[^\n]{0,50}/i)?.[0])
}
