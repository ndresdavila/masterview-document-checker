import { parseProformaArrayBuffer } from './parseProforma.js'
import { parseHblPdf, parseHblDocx } from './parseHblPdf.js'

const PROFORMA_EXT = ['.xls', '.xlsx']

function extOf(name = '') {
  const m = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/)
  return m ? m[1] : ''
}

export function classifyFile(file) {
  const ext = extOf(file?.name)
  if (PROFORMA_EXT.includes(ext)) return 'proforma'
  if (ext === '.pdf' || ext === '.docx') return 'hbl'
  if (ext === '.doc') return 'hbl-old'
  return 'unknown'
}

export async function parseDroppedFile(file, expected) {
  const kind = classifyFile(file)
  if (expected === 'proforma' && kind !== 'proforma') {
    throw new Error('La proforma tiene que ser un Excel (.xls o .xlsx).')
  }
  if (expected === 'hbl' && kind === 'hbl-old') {
    throw new Error('El .doc antiguo no se puede leer. Usa PDF o .docx.')
  }
  if (expected === 'hbl' && kind !== 'hbl') {
    throw new Error('El HBL tiene que ser PDF o Word (.docx).')
  }

  const buffer = await file.arrayBuffer()
  if (kind === 'proforma') return parseProformaArrayBuffer(buffer, file.name)
  if (extOf(file.name) === '.pdf') return parseHblPdf(buffer, file.name)
  return parseHblDocx(buffer, file.name)
}
