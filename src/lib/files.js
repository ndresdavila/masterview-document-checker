import { parseProformaArrayBuffer } from './parseProforma.js'
import { parseHblPdf, parseHblDocx, parseProformaDocx } from './parseHblPdf.js'

function extOf(name = '') {
  const m = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/)
  return m ? m[1] : ''
}

function looksLikeProformaName(name = '') {
  const n = String(name).toLowerCase()
  if (/proforma/.test(n)) return true
  if (/\bhbl\b|fletado|sea waybill|\bswb\b/.test(n)) return false
  if (/\bdraft\b|\bfinal\b/.test(n) && !/proforma/.test(n)) return false
  return null
}

export function classifyFile(file, hint = '') {
  const ext = extOf(file?.name)
  if (ext === '.xls' || ext === '.xlsx') return 'proforma'
  if (ext === '.pdf') return 'hbl'
  if (ext === '.doc') return 'old-word'
  if (ext === '.docx') {
    const named = looksLikeProformaName(file?.name)
    if (named === true) return 'proforma'
    if (named === false) return 'hbl'
    if (hint === 'proforma' || hint === 'hbl') return hint
    return 'hbl'
  }
  return 'unknown'
}

export async function parseDroppedFile(file, expected) {
  const kind = classifyFile(file, expected)
  if (kind === 'old-word') {
    throw new Error('El .doc antiguo no se puede leer. Use .docx o Excel.')
  }
  if (expected === 'proforma' && kind !== 'proforma') {
    throw new Error('La proforma tiene que ser Excel (.xls, .xlsx) o Word (.docx).')
  }
  if (expected === 'hbl' && kind !== 'hbl') {
    throw new Error('El HBL tiene que ser PDF o Word (.docx).')
  }

  const buffer = await file.arrayBuffer()
  const ext = extOf(file.name)
  if (kind === 'proforma') {
    if (ext === '.docx') return parseProformaDocx(buffer, file.name)
    return parseProformaArrayBuffer(buffer, file.name)
  }
  if (ext === '.pdf') return parseHblPdf(buffer, file.name)
  return parseHblDocx(buffer, file.name)
}
