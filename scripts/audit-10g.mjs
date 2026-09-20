import * as XLSX from '../node_modules/xlsx/xlsx.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import * as pdfjs from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.resolve(here, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href
const root = path.resolve(here, '../random-10g')

function dumpExcel(id, re) {
  const dir = path.join(root, id)
  const prof = fs.readdirSync(dir).find((f) => /\.xlsx?$/i.test(f))
  const wb = XLSX.read(fs.readFileSync(path.join(dir, prof)), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  console.log(`\n======== ${id} EXCEL ========`)
  rows.forEach((row, i) => {
    const cells = row
      .map((c, j) => {
        const s = String(c ?? '').replace(/\s+/g, ' ').trim()
        return s ? `${j}:${s.slice(0, 100)}` : ''
      })
      .filter(Boolean)
    if (!cells.length) return
    const line = cells.join(' | ')
    if (re.test(line)) console.log(String(i).padStart(2, '0'), line.slice(0, 240))
  })
}

dumpExcel('05-zimugyl805345', /TIIU4478836|CAAU8729831|JXLU6316737|GAOU7683281|25083|25090|25014|25021|GROSS|BRUTO|CONTENEDOR|ISO/i)
dumpExcel('06-6463150520', /POSORJA|GUAYAQUIL|DAE|MARCA|MARK|PORT|GRANDSOUTH|028-202/i)
dumpExcel('08-zimugyl00022177', /JXLU6313105|JXLU4684663|CONTENEDOR|ISO/i)
dumpExcel('10-zimugyl810472', /BOOKING|ZIMUGYL810/i)
dumpExcel('02-zimugyl807157', /JXLU431/i)
