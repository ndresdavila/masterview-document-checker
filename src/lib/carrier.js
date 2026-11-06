export function looksLikeSwbName(name = '') {
  const n = String(name).toUpperCase()
  return /SEA\s*WAYBILL|\bSWB\b/.test(n)
}

export function looksLikeHblName(name = '') {
  const n = String(name).toUpperCase()
  if (looksLikeSwbName(name)) return false
  if (/HBL DRAFT|BL FLETADO/.test(n)) return true
  if (/\bULGO\d/.test(n) && !/DRAFT[_\s-]*BL/.test(n)) return true
  return false
}

export function looksLikeMblName(name = '') {
  const n = String(name).toUpperCase().replace(/\s+/g, ' ')
  if (looksLikeHblName(name)) return false
  // El aviso de llegada trae el booking (ZIMUGYL…, COSU…) pero no es el B/L.
  if (isArrivalNoticeName(name)) return false
  if (/ZIMU|ZIMUGYL|ONEYGYEG|\bCOSU\d{10}|\bCOSCO\b/.test(n)) return true
  if (/DRAFT[_\s-]*BL|FINAL[_\s-]*BL/.test(n)) return true
  if (/DRAFT_BL_\d{10}|DRAFT_BL\s+\d{10}/.test(n.replace(/ /g, '_'))) return true
  return false
}

// Aviso de llegada que convive con el B/L en la carpeta de la naviera.
// ZIM lo exporta como AF3_<tipo>_S_<booking>-<n> (AF3_118_S_ZIMUGYL811371-1.pdf).
// COSCO lo nombra AN_BL… / AN_COSU…. El título es "NOTICE OF ARRIVAL",
// "ARRIVAL NOTICE" o "AVISO DE LLEGADA". Esa frase identifica al aviso
// aunque el archivo se llame Final_BL o Draft_BL. "notice of the arrival
// of the Goods" es una cláusula del B/L y no cuenta.
const NOTICE_PHRASE = /NOTICE[\s_-]*OF[\s_-]*ARRIVAL|ARRIVAL[\s_-]*NOTICE|AVISO[\s_-]*DE[\s_-]*LLEGADA/
const AMBIGUOUS_TOKEN = /(?:^|[_\s-])(?:NOTICE|ARRIVAL|AVISO|LLEGADA|NOA|AN)(?:[_\s-]|$)/
const STRONG_BL = /FINAL[\s_-]*BL|DRAFT[\s_-]*BL|FINAL[\s_-]*BILL|DRAFT[\s_-]*BILL/
const NAMED_BL = /BILL[\s_-]*OF[\s_-]*LADING|\bMBL\b|ORIGINAL[\s_-]*B\/?L|COPY[\s_-]*(?:NON[\s_-]*NEGOTIABLE[\s_-]*)?(?:BL|B\/L)\b/
const BILL_TITLE = /BILL OF LADING(?!\s*(?:NO\.?|NUMBER)\b)/

function fileStem(name = '') {
  const leaf = String(name).split(/[/\\]/).pop() || ''
  return leaf.replace(/\.[A-Za-z0-9]{1,8}$/, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

function hasStrongBlToken(stem) {
  return STRONG_BL.test(stem)
}

export function isArrivalNoticeName(name = '') {
  const stem = fileStem(name)
  if (!stem) return false
  if (NOTICE_PHRASE.test(stem)) return true
  if (hasStrongBlToken(stem)) return false
  if (/^NOA(?:[\s_-]|$)/.test(stem)) return true
  // COSCO: AN_BL…, AN_COSU…, o AN_<número>. "AND_BL" no entra (hace falta el separador).
  if (/^AN[\s_-]/.test(stem) || /^AN(?:BL|B\/L|COSU|ZIMU|ONEY)\b/.test(stem)) return true
  if (/^AF3_\d+_S_/.test(stem.replace(/[\s-]+/g, '_'))) return true
  return false
}

function isAmbiguousNoticeName(name = '') {
  const stem = fileStem(name)
  if (!stem || hasStrongBlToken(stem) || isArrivalNoticeName(name)) return false
  return AMBIGUOUS_TOKEN.test(stem)
}

export function isArrivalNoticeText(text = '') {
  const flat = String(text).toUpperCase().replace(/\s+/g, ' ').trim()
  if (!flat) return false
  const title = flat.slice(0, 900)
  // La frase del título manda: un nombre Final/Draft no la tapa, y
  // "BILL OF LADING No." en el mismo aviso tampoco.
  if (NOTICE_PHRASE.test(title)) return true
  // El B/L de ZIM dice "notice of the arrival of the Goods" en las cláusulas.
  // Eso no es el título. "BILL OF LADING No." es la casilla del número.
  if (BILL_TITLE.test(title)) return false
  const head = flat.slice(0, 4000)
  return /ARRIVAL\s+NOTICE/.test(head) && /CNTR SIZE\s*\/\s*TYPE/.test(head)
}

function isIdentifiedArrivalNotice(file) {
  if (file.text && isArrivalNoticeText(file.text)) return true
  if (file.text && isBillOfLadingText(file.text)) return false
  return isArrivalNoticeName(file.name)
}

function isBillOfLadingText(text = '') {
  const title = String(text).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 900)
  return BILL_TITLE.test(title)
}

function isPdfName(name = '') {
  return /\.pdf$/i.test(String(name))
}

function namedCarrierBl(stem) {
  return hasStrongBlToken(stem) || NAMED_BL.test(stem)
}

function inMblPool(name, text) {
  if (isIdentifiedArrivalNotice({ name, text })) return false
  if (looksLikeHblName(name)) return false
  if (looksLikeMblName(name)) return true
  if (namedCarrierBl(fileStem(name))) return true
  if (text && isBillOfLadingText(text)) return true
  return false
}

function looksLikeBareBlNumber(name) {
  const stem = fileStem(name)
  if (!stem || looksLikeHblName(name) || looksLikeSwbName(name)) return false
  if (/ZIMU|ZIMUGYL|ONEY|\bCOSU\d{10}\b/.test(stem)) return true
  if (/\bBL[\s_-]?\d{6,}\b/.test(stem)) return true
  if (/^\d{10}$/.test(stem)) return true
  return false
}

// 0 emitido (Final, noncopy, released), 1 Draft_BL, 2 booking pelado u otro.
// _draft suelto no sube a 1: si no, le ganaría al PDF que solo trae el booking.
const ISSUED_BL = /(?:^|[\s_-])(?:NON[\s_-]?COPY|RELEASED?|ISSUED)(?:[\s_-]|$)/

function blKind(stem) {
  if (/FINAL[\s_-]*BL|FINAL[\s_-]*BILL/.test(stem) || ISSUED_BL.test(stem)) return 0
  if (/DRAFT[\s_-]*BL|DRAFT[\s_-]*BILL/.test(stem)) return 1
  return 2
}

function revisionScore(stem) {
  const frt = stem.match(/(?:^|[\s_-])FRT(?:[\s_-]?(\d+))?$/)
  if (!frt) return 0
  const n = Number(frt[1] || 1)
  return 100 + (Number.isFinite(n) ? n : 1)
}

function readMtime(source) {
  if (!source || typeof source !== 'object') return null
  const raw = source.mtimeMs ?? source.mtime ?? source.lastModified
  if (raw instanceof Date) {
    const ms = raw.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw) {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function mblRank(file) {
  const stem = fileStem(file.name)
  const kind = blKind(stem)
  if (isAmbiguousNoticeName(file.name)) return [1, kind]
  return [0, kind]
}

function fileEntry(item) {
  if (typeof item === 'string') return { name: item, text: '', mtime: null }
  if (!item || typeof item !== 'object') return { name: '', text: '', mtime: null }
  const nested = item.file && typeof item.file === 'object' ? item.file : null
  return {
    name: item.name || item.fileName || nested?.name || '',
    text: typeof item.text === 'string' ? item.text : '',
    mtime: readMtime(item) ?? readMtime(nested),
  }
}

// Elige el MBL entre los PDF de la carpeta (p. ej. "5 BL NAVIERA").
// Emitido (Final, noncopy, released), luego Draft_BL, luego el booking pelado.
// Entre emitidos del mismo tipo, *_frt y después el mtime más nuevo si ambos lo traen.
// Un aviso de llegada identificado no se devuelve nunca. null si no queda MBL.
export function selectMblCandidate(files = []) {
  const list = Array.isArray(files) ? files : []
  const pdfs = []
  for (let index = 0; index < list.length; index += 1) {
    const entry = fileEntry(list[index])
    if (!entry.name || !isPdfName(entry.name)) continue
    pdfs.push({ ...entry, index })
  }
  const pool = pdfs.filter((file) => inMblPool(file.name, file.text))
  let source = pool
  if (!source.length) {
    const bare = pdfs.filter((file) => !isIdentifiedArrivalNotice(file) && looksLikeBareBlNumber(file.name))
    if (bare.length === 1) source = bare
  }
  const eligible = source.filter((file) => !isIdentifiedArrivalNotice(file))
  if (!eligible.length) return null
  eligible.sort((a, b) => {
    const ra = mblRank(a)
    const rb = mblRank(b)
    if (ra[0] !== rb[0]) return ra[0] - rb[0]
    if (ra[1] !== rb[1]) return ra[1] - rb[1]
    if (ra[0] === 0 && ra[1] === 0) {
      const rev = revisionScore(fileStem(b.name)) - revisionScore(fileStem(a.name))
      if (rev) return rev
      if (a.mtime != null && b.mtime != null && a.mtime !== b.mtime) return b.mtime - a.mtime
    }
    const byName = fileStem(a.name).localeCompare(fileStem(b.name), 'en', { numeric: true, sensitivity: 'base' })
    if (byName) return byName
    return a.index - b.index
  })
  return eligible[0].name
}

export function detectCarrier(name = '', text = '') {
  const t = `${name} ${text}`.toUpperCase()
  if (/COSCO SHIPPING|ELINES\.COSCOSHIPPING|\bCOSU\d{10}/.test(t)) return 'cosco'
  if (/OCEAN NETWORK EXPRESS|ONE-LINE\.COM|\bONEY[A-Z0-9]{10,}/.test(t)) return 'one'
  if (/\bZIMU|ZIMUGYL|ZIM INTEGRATED/.test(t)) return 'zim'
  if (/DRAFT_BL_\d{10}|BILL OF LADING NO\.?\s*COSU/.test(t)) return 'cosco'
  if (/\bGYEG\d{8,}/.test(t) && /OCEAN NETWORK|ONEY|ONE-LINE/.test(t)) return 'one'
  if (/\b\d{10}\b/.test(t) && /PROFORMA/.test(t) && /BILL OF LADING/.test(t)) return 'cosco'
  return ''
}
