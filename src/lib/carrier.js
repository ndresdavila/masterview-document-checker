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
  // Sigue pudiendo usarse: selectMblCandidate lo deja como último recurso.
  if (isArrivalNoticeName(name)) return false
  if (/ZIMU|ZIMUGYL|ONEYGYEG|\bCOSU\d{10}|\bCOSCO\b/.test(n)) return true
  if (/DRAFT[_\s-]*BL|FINAL[_\s-]*BL/.test(n)) return true
  if (/DRAFT_BL_\d{10}|DRAFT_BL\s+\d{10}/.test(n.replace(/ /g, '_'))) return true
  return false
}

// Aviso de llegada que convive con el B/L en la carpeta de la naviera.
// ZIM lo exporta como AF3_<tipo>_S_<booking>-<n> (AF3_118_S_ZIMUGYL811371-1.pdf).
// COSCO lo nombra AN_BL… / AN_COSU…. El título es "NOTICE OF ARRIVAL",
// "ARRIVAL NOTICE" o "AVISO DE LLEGADA". Un Final/Draft sigue siendo el B/L
// aunque el nombre también diga "notice".
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
  if (!stem || hasStrongBlToken(stem)) return false
  if (NOTICE_PHRASE.test(stem)) return true
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
  // El B/L de ZIM dice "notice of the arrival of the Goods" en las cláusulas.
  // Eso no es el título. "BILL OF LADING No." es la casilla del número, no el título.
  if (BILL_TITLE.test(title)) return false
  if (NOTICE_PHRASE.test(title)) return true
  const head = flat.slice(0, 4000)
  return /ARRIVAL\s+NOTICE/.test(head) && /CNTR SIZE\s*\/\s*TYPE/.test(head)
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
  if (looksLikeHblName(name)) return false
  if (looksLikeMblName(name)) return true
  if (isArrivalNoticeName(name)) return true
  if (namedCarrierBl(fileStem(name))) return true
  if (text && (isArrivalNoticeText(text) || isBillOfLadingText(text))) return true
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

function blKind(stem) {
  if (/FINAL[\s_-]*BL|FINAL[\s_-]*BILL/.test(stem)) return 0
  if (/DRAFT[\s_-]*BL|DRAFT[\s_-]*BILL/.test(stem)) return 1
  return 2
}

function mblRank(file) {
  const stem = fileStem(file.name)
  const kind = blKind(stem)
  const billText = file.text ? isBillOfLadingText(file.text) : false
  const noticeText = file.text ? isArrivalNoticeText(file.text) : false
  if (noticeText && !billText) return [2, kind]
  if (billText && !noticeText) {
    return [(isArrivalNoticeName(file.name) || isAmbiguousNoticeName(file.name)) ? 1 : 0, kind]
  }
  if (isArrivalNoticeName(file.name)) return [2, kind]
  if (isAmbiguousNoticeName(file.name)) return [1, kind]
  return [0, kind]
}

function fileEntry(item) {
  if (typeof item === 'string') return { name: item, text: '' }
  if (!item || typeof item !== 'object') return { name: '', text: '' }
  return { name: item.name || item.fileName || '', text: item.text || '' }
}

// Elige el MBL entre los PDF de la carpeta (p. ej. "5 BL NAVIERA").
// Final, luego Draft, luego un B/L nombrado con el booking (ZIMUGYL…, COSU…, ONEY…).
// El aviso de llegada solo gana si no quedó otro candidato. null si no hay ninguno.
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
    const bare = pdfs.filter((file) => looksLikeBareBlNumber(file.name))
    if (bare.length === 1) source = bare
  }
  if (!source.length) return null
  source.sort((a, b) => {
    const ra = mblRank(a)
    const rb = mblRank(b)
    return ra[0] - rb[0]
      || ra[1] - rb[1]
      || fileStem(a.name).localeCompare(fileStem(b.name), 'en', { numeric: true, sensitivity: 'base' })
      || a.index - b.index
  })
  return source[0].name
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
