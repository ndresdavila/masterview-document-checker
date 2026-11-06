import { parseProformaArrayBuffer } from './parseProforma.js'
import { parseHblPdf, parseHblDocx, parseProformaDocx, parseMblPdf, parseSwbPdf, pdfPlainText } from './parseHblPdf.js'
import { parseSwbArrayBuffer, excelLooksLikeSwb, finalizeSwb } from './parseSwb.js'
import {
  isArrivalNoticeName,
  isArrivalNoticeText,
  looksLikeHblName,
  looksLikeMblName,
  looksLikeSwbName,
  selectMblCandidate,
} from './carrier.js'

export { isArrivalNoticeName, isArrivalNoticeText, selectMblCandidate } from './carrier.js'

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
  if (looksLikeSwbName(name)) {
    if (ext === '.xls' || ext === '.xlsx' || ext === '.pdf' || ext === '.docx') return 'swb'
  }
  if (
    hint === 'swb'
    && (ext === '.xls' || ext === '.xlsx' || ext === '.pdf' || ext === '.docx')
    && !looksLikeMblName(name)
    && !isArrivalNoticeName(name)
  ) {
    return 'swb'
  }
  if (ext === '.xls' || ext === '.xlsx') return 'proforma'
  if (ext === '.pdf') {
    if (isArrivalNoticeName(name)) return 'unknown'
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

const PANEL_ROLES = new Set(['proforma', 'hbl', 'mbl', 'swb'])

async function textOfDroppedPdf(file) {
  if (typeof file?.text === 'string' && file.text) return file.text
  if (!/\.pdf$/i.test(file?.name || '') || typeof file?.arrayBuffer !== 'function') return ''
  try {
    return await pdfPlainText(await file.arrayBuffer())
  } catch {
    return ''
  }
}

// Punto de entrada al soltar archivos: lee el PDF y elige con selectMblCandidate.
// Final queda delante de Draft. Un aviso identificado no se devuelve.
export async function chooseDroppedMbl(files) {
  const list = Array.from(files || []).filter((file) => file && file.name)
  const described = []
  for (const file of list) {
    described.push({
      name: file.name,
      text: await textOfDroppedPdf(file),
      file,
    })
  }
  const chosen = selectMblCandidate(described)
  if (!chosen) {
    return {
      file: null,
      blocked: described.some((item) => isArrivalNoticeName(item.name) || isArrivalNoticeText(item.text)),
    }
  }
  return {
    file: described.find((item) => item.name === chosen)?.file || null,
    blocked: false,
  }
}

export async function parseDroppedFile(file, expected) {
  const named = classifyFile(file, expected)
  if (named === 'old-word') {
    throw new Error('El .doc antiguo no se puede leer. Use .docx o Excel.')
  }
  if (expected === 'proforma' && named !== 'proforma' && named !== 'swb') {
    throw new Error('La proforma tiene que ser Excel (.xls, .xlsx) o Word (.docx).')
  }

  const buffer = await file.arrayBuffer()
  const ext = extOf(file.name)
  const role = PANEL_ROLES.has(expected) ? expected : named

  if (role === 'swb') {
    if (ext === '.xls' || ext === '.xlsx') return parseSwbArrayBuffer(buffer, file.name)
    if (ext === '.pdf') return parseSwbPdf(buffer, file.name)
    if (ext === '.docx') return finalizeSwb(await parseHblDocx(buffer, file.name), file.name)
    throw new Error('El SWB tiene que ser PDF, Excel (.xls, .xlsx) o Word (.docx).')
  }

  if (role === 'proforma') {
    if (ext === '.docx') return parseProformaDocx(buffer, file.name)
    if ((ext === '.xls' || ext === '.xlsx') && excelLooksLikeSwb(buffer)) {
      return parseSwbArrayBuffer(buffer, file.name)
    }
    return parseProformaArrayBuffer(buffer, file.name)
  }
  if (ext === '.pdf') {
    if (role === 'mbl' || named === 'mbl') return parseMblPdf(buffer, file.name)
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
