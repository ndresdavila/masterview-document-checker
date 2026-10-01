import { parseProformaArrayBuffer } from './parseProforma.js'
import { parseHblPdf, parseHblDocx, parseProformaDocx, parseMblPdf } from './parseHblPdf.js'
import { looksLikeHblName, looksLikeMblName } from './carrier.js'

function extOf(name = '') {
  const m = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/)
  return m ? m[1] : ''
}

function looksLikeProformaName(name = '') {
  const n = String(name).toLowerCase()
  if (/proforma/.test(n) && !/\.pdf$/i.test(name)) return true
  if (/\bhbl\b|fletado|sea waybill|\bswb\b/.test(n)) return false
  if (/\bdraft\b|\bfinal\b/.test(n) && !/proforma/.test(n)) return false
  return null
}

export function classifyFile(file, hint = '') {
  const ext = extOf(file?.name)
  const name = file?.name || ''
  if (ext === '.xls' || ext === '.xlsx') return 'proforma'
  if (ext === '.pdf') {
    if (looksLikeMblName(name)) return 'mbl'
    if (looksLikeHblName(name)) return 'hbl'
    if (hint === 'mbl' || hint === 'hbl') return hint
    return 'hbl'
  }
  if (ext === '.doc') return 'old-word'
  if (ext === '.docx') {
    const named = looksLikeProformaName(name)
    if (named === true) return 'proforma'
    if (named === false) return 'hbl'
    if (hint === 'proforma' || hint === 'hbl') return hint
    return 'hbl'
  }
  return 'unknown'
}

export async function parseDroppedFile(file, expected) {
  const named = classifyFile(file, expected)
  if (named === 'old-word') {
    throw new Error('El .doc antiguo no se puede leer. Use .docx o Excel.')
  }
  if (expected === 'proforma' && named !== 'proforma') {
    throw new Error('La proforma tiene que ser Excel (.xls, .xlsx) o Word (.docx).')
  }

  const buffer = await file.arrayBuffer()
  const ext = extOf(file.name)

  if (named === 'proforma') {
    if (ext === '.docx') return parseProformaDocx(buffer, file.name)
    return parseProformaArrayBuffer(buffer, file.name)
  }
  if (ext === '.pdf') {
    if (named === 'mbl' || expected === 'mbl') return parseMblPdf(buffer, file.name)
    return parseHblPdf(buffer, file.name)
  }
  if (expected === 'mbl') {
    throw new Error('El MBL de la naviera tiene que ser PDF.')
  }
  if (expected === 'hbl' && named !== 'hbl' && named !== 'mbl') {
    throw new Error('El HBL tiene que ser PDF o Word (.docx).')
  }
  return parseHblDocx(buffer, file.name)
}
