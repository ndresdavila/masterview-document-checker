export function str(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-6) {
      return String(Math.round(value))
    }
    return String(value)
  }
  return String(value).replace(/\u00a0/g, ' ').replace(/\u200b/g, '').trim()
}

export function canon(value) {
  return str(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:#/()[\]"'`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function softenAddress(value) {
  return canon(value)
    .replace(/\b(DE LA|DEL|DE LOS|DE LAS|DE|LA|EL|LOS|LAS|THE|AND|Y)\b/g, ' ')
    .replace(/\bSUIT\b/g, 'SUITE')
    .replace(/\bCORABASOS\b/g, 'CORABASTOS')
    .replace(/\bCORABATOS\b/g, 'CORABASTOS')
    .replace(/\s+/g, ' ')
    .trim()
}

export function portCanon(value) {
  return canon(value)
    .replace(/\bU S A\b/g, 'UNITED STATES')
    .replace(/\bUSA\b/g, 'UNITED STATES')
    .replace(/\bUS\b/g, 'UNITED STATES')
    .replace(/\bNY\b/g, 'NEW YORK')
    .replace(/\bECUADOR\b/g, 'ECUADOR')
    .replace(/\bNEW YORK NEW YORK\b/g, 'NEW YORK')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  let raw = str(value).trim()
  const token = raw.match(/-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|-?\d+[.,]\d{1,2}|-?\d+/)
  if (token) raw = token[0]
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(raw)) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+\.\d{1,2}$/.test(raw)) {
    const last = raw.lastIndexOf('.')
    raw = raw.slice(0, last).replace(/\./g, '') + '.' + raw.slice(last + 1)
  } else if (/^\d{1,3}\.\d{3}$/.test(raw) && raw.endsWith('.000')) {
    raw = raw.slice(0, -4)
  } else if (/^\d{1,3}(,\d{3})+,\d{2}$/.test(raw)) {
    raw = raw.replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  } else if (/^\d+,\d{1,2}$/.test(raw)) {
    raw = raw.replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
    raw = raw.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
    raw = raw.replace(/,/g, '')
  } else {
    raw = raw.replace(/,/g, '')
  }
  const m = raw.match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

export function numbersClose(a, b, tol = 0.51) {
  const na = parseNumber(a)
  const nb = parseNumber(b)
  if (na == null || nb == null) return false
  return Math.abs(na - nb) <= tol
}

export function formatNumber(value, digits = 2) {
  const n = parseNumber(value)
  if (n == null) return str(value)
  return n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : digits,
    maximumFractionDigits: digits,
  })
}

export function joinLines(lines) {
  return (lines || []).map(str).filter(Boolean).join('\n')
}

export function tokenRatio(a, b) {
  const A = new Set(canon(a).split(' ').filter(Boolean))
  const B = new Set(canon(b).split(' ').filter(Boolean))
  if (!A.size && !B.size) return 1
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

export function levenshteinRatio(a, b) {
  const s = canon(a)
  const t = canon(b)
  if (s === t) return 1
  if (!s || !t) return 0
  const m = s.length
  const n = t.length
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= n; j += 1) dp[0][j] = j
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return 1 - dp[m][n] / Math.max(m, n)
}

export function similar(a, b) {
  const ca = canon(a)
  const cb = canon(b)
  if (ca === cb) return 1
  return Math.max(tokenRatio(a, b), levenshteinRatio(a, b))
}

function wordJoinerTypes(value) {
  const raw = str(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const found = new Set()
  for (const m of raw.matchAll(/[A-Z]{2,}\s*([,-])\s*[A-Z]{2,}/g)) {
    found.add(m[1])
  }
  return found
}

export function joinersConflict(a, b) {
  const A = wordJoinerTypes(a)
  const B = wordJoinerTypes(b)
  if (!A.size || !B.size) return false
  const aHyphen = A.has('-') && !A.has(',')
  const bComma = B.has(',') && !B.has('-')
  const aComma = A.has(',') && !A.has('-')
  const bHyphen = B.has('-') && !B.has(',')
  return (aHyphen && bComma) || (aComma && bHyphen)
}

export const ISO_RE = /\b([A-Z]{4}\d{7})\b/
export const VOYAGE_RE = /\b(0[A-Z]{2,6}\d[A-Z]{1,3}|\d{2,6}[NSEW])\b/
export const BL_RE = /\b(ULGO\d{2}[A-Z]{2}\d{5,}|ONEY[A-Z0-9]{10,}|[A-Z]{4}\d{2}[A-Z]{2}\d{5,})\b/
export const BOOKING_RE = /\b(ZIMU\s*[A-Z]{2,5}\s*\d{5,}|GYEG\s*\d{8,}|\d{10})\b/i

export function isVoyageToken(token) {
  const s = canon(token).replace(/\s+/g, '')
  return /^0[A-Z]{2,6}\d[A-Z]{1,3}$/.test(s) || /^\d{2,6}[NSEW]$/.test(s)
}

export function voyageCanon(value) {
  return canon(value).replace(/\s+/g, '')
}

export function voyagesMatch(a, b) {
  const A = voyageCanon(a)
  const B = voyageCanon(b)
  if (!A || !B) return false
  return A === B
}

export function findVoyage(text) {
  const tokens = str(text).toUpperCase().split(/\s+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (isVoyageToken(tokens[i])) return tokens[i]
    const glued = tokens[i].match(/^(.*?)(\d{2,6}[NSEW])$/)
    if (glued && glued[1].length >= 3 && isVoyageToken(glued[2])) return glued[2]
  }
  return str(text).toUpperCase().match(VOYAGE_RE)?.[1] || ''
}

export function splitVesselVoyagePort(text) {
  const raw = str(text).replace(/\s+/g, ' ')
  const voyage = findVoyage(raw)
  const stripLabels = (value) =>
    str(value)
      .replace(/\bMarks\b[\s\S]*/i, ' ')
      .replace(/\b(vessel|voy|n[ºo°]?|port of loading)\b/gi, ' ')
      .replace(/^(MN|MV|M\/V)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()

  // Puerto pegado al final del nombre del buque en el HBL ("CMA CGM ALIAGA AMX010N19 GUAYAQUIL - ECUADOR").
  const stripPort = (value) => str(value).replace(/\s*-?\s*\bGUAYAQUIL\b(\s*-?\s*ECUADOR)?\s*$/i, '').trim()

  if (!voyage) {
    return { vessel: stripPort(stripLabels(raw)), voyage: '', portLoading: '' }
  }
  const unglued = raw.replace(new RegExp(`([^\\s])(${voyage})\\b`, 'i'), `$1 ${voyage}`)
  const parts = unglued.split(new RegExp(`\\b${voyage}\\b`, 'i'))
  return {
    vessel: stripPort(stripLabels(parts[0] || '')),
    voyage,
    portLoading: stripLabels(parts.slice(1).join(' ')),
  }
}

export function vesselCanon(value) {
  return canon(value)
    .replace(VOYAGE_RE, ' ')
    .replace(/^(MN|MV|M V|SL|MSC)\s+/, '')
    .replace(/\bMARKS.*$/, ' ')
    .replace(/\b(GUAYAQUIL|ECUADOR|PORT OF LOADING|VESSEL|VOY)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function vesselsMatch(a, b) {
  const A = vesselCanon(a)
  const B = vesselCanon(b)
  if (!A || !B) return false
  if (A === B) return true
  if (A.replace(/ /g, '') === B.replace(/ /g, '')) return true
  if (A.length >= 5 && B.length >= 5 && (A.includes(B) || B.includes(A))) return true
  return similar(A, B) >= 0.82
}

export function portsMatch(a, b) {
  const A = portCanon(a)
  const B = portCanon(b)
  if (!A || !B) return false
  if (joinersConflict(a, b) && !(/\b(GUAYAQUIL|BUENAVENTURA|NEW YORK|OAKLAND|HALIFAX|SAVANNAH|PHILADELPHIA)\b/.test(A) && /\b(GUAYAQUIL|BUENAVENTURA|NEW YORK|OAKLAND|HALIFAX|SAVANNAH|PHILADELPHIA)\b/.test(B))) {
    return false
  }
  if (A === B) return true
  if (/\bSAVANNAH\b/.test(A) && /\bSAVANNAH\b/.test(B)) return true
  if (/\bOAKLAND\b/.test(A) && /\bOAKLAND\b/.test(B)) return true
  if (A.includes(B) || B.includes(A)) return true
  return similar(A, B) >= 0.86
}

export function contractCanon(value) {
  return canon(value)
    .replace(/\b\d*TNS?\b/g, ' ')
    .replace(/[^A-Z0-9]/g, '')
}

export function contractsMatch(a, b) {
  const A = contractCanon(a)
  const B = contractCanon(b)
  if (!A || !B) return false
  if (A === B) return true
  const shorter = A.length <= B.length ? A : B
  const longer = A.length > B.length ? A : B
  return longer.startsWith(shorter) && longer.length - shorter.length <= 2
}

export function commoditiesMatch(a, b) {
  if (joinersConflict(a, b)) return false
  const A = commodityCanon(a)
  const B = commodityCanon(b)
  if (!A || !B) return false
  if (A === B) return true
  if (A.startsWith(B) || B.startsWith(A)) return true
  if (A.endsWith(B) || B.endsWith(A)) return true
  if (A.includes(B) || B.includes(A)) return true
  return similar(A, B) >= 0.86
}

export function extractBooking(text) {
  const raw = str(text).toUpperCase()
  const m = raw.match(BOOKING_RE)
  return m ? m[1].replace(/\s+/g, '') : ''
}

export function bookingCanon(value) {
  return canon(str(value).replace(/\/\d+$/, ''))
    .replace(/\s+/g, '')
    .replace(/^ONEY/, '')
}

export function bookingsMatch(a, b) {
  const A = bookingCanon(a)
  const B = bookingCanon(b)
  if (!A || !B) return false
  if (A === B) return true
  if (A.length >= 8 && B.length >= 8 && (A.includes(B) || B.includes(A))) return true
  const dA = A.replace(/\D/g, '')
  const dB = B.replace(/\D/g, '')
  return dA.length >= 8 && dA === dB
}

export function hsMatch(a, b) {
  const A = str(a).replace(/\D/g, '')
  const B = str(b).replace(/\D/g, '')
  if (!A || !B) return false
  return A === B || A.startsWith(B) || B.startsWith(A)
}

export function loteCanon(value) {
  const raw = str(value).toUpperCase()
  const m = raw.match(/LOTE#?\s*([A-Z0-9-]+)/) || raw.match(/\b([A-Z]{2,}\d{4,}|\d+(?:-\d+)?)\b/)
  return m ? m[1] : canon(value)
}

export function lotesMatch(a, b) {
  const A = loteCanon(a)
  const B = loteCanon(b)
  if (!A || !B) return false
  if (A === B) return true
  const nA = A.split('-')[0].replace(/^0+/, '')
  const nB = B.split('-')[0].replace(/^0+/, '')
  return Boolean(nA) && nA === nB
}

// LOTE#2611102, "LOTE: 2611102", "LOTE 2611102", "LOT NO 2611102", "LOTE Nº 2611102".
// El grupo que sigue a la etiqueta es el lote; si es una cifra de 7 dígitos, sin este corte
// cumpliría el largo de un sello. Una cifra suelta ("1234567") no lleva etiqueta y sí es sello.
function loteLabelPattern() {
  return /\bLOTE\s*(?:#|:|N[º°]\.?|NO\.?|NUMBER|NRO\.?)\s*:?\s*([A-Z0-9-]+)|\bLOT\s*(?:#|:|N[º°]\.?|NO\.?|NUMBER|NRO\.?)\s*:?\s*([A-Z0-9-]+)|\bLOTE\s+([A-Z0-9-]+)/gi
}

export function stripLoteLabels(value) {
  return str(value).replace(loteLabelPattern(), ' ')
}

export function loteLabelPayloads(value) {
  return [...str(value).matchAll(loteLabelPattern())].map((m) => m[1] || m[2] || m[3]).filter(Boolean)
}

function stripSealNoise(value) {
  let raw = str(value)
  // El DAE (DAE:028-2026-40-02099786) no es un sello. Si se parte por los guiones,
  // el último grupo (02099786) cumple el largo de un sello y se cuela en la lista.
  // Un lote con etiqueta tampoco: "LOTE#2611102" se parte en 2611102.
  raw = stripLoteLabels(raw.replace(/\bDAE\s*:?\s*\d[\d-]*/gi, ' '))
  raw = raw.replace(/\b(?:CONTRACT|CONTRATO)\s*(?:NO\.?|NUMBER|#)?\s*[:#]?\s*[A-Z0-9][A-Z0-9._-]*/gi, ' ')
  raw = raw.replace(/\bSCS\d+\b/gi, ' ')
  raw = raw.replace(/\b(?:ZIMU[A-Z]{0,6}\d{5,}|GYEG\d{6,}|ONEY[A-Z0-9]{8,}|COSU\d{8,}|ULGO\d{2}[A-Z]{2}\d{4,}|HLCU[A-Z0-9]{6,})\b/gi, ' ')
  // "FS-36458" es un sello. El guion no lo parte en "36458".
  raw = raw.replace(/\b([A-Z]{1,4})-(\d{4,10})\b/gi, '$1$2')
  // Pesos y medidas: "25228.50 KG", "25090 KGS", "25,014.20", "20039.000KGS", "60.000M3".
  raw = raw.replace(/\d[\d.,]*\s*(?:KGS?|KILOS?|K\.?\s*[NB]|LBS?|M3|CBM)\b/gi, ' ')
  raw = raw.replace(/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b/g, ' ')
  raw = raw.replace(/\b\d+[.,]\d+\b/g, ' ')
  return raw
}

export function sealTokens(value) {
  const tokens = stripSealNoise(value)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => {
      if (t.length < 5 || t.length > 14) return false
      if (!/\d/.test(t)) return false
      if (/X40HQ|X40HC/.test(t)) return false
      if (/^\d+X\d+(ST|HQ|GP|HC|DRY)?$/.test(t)) return false
      if (ISO_RE.test(t)) return false
      if (/^(BAGS|SEALS?|SELLOS?|NET|GROSS|WEIGHT|CONTAINER|CONTENEDOR)$/.test(t)) return false
      // 24978 / 25047 / 100775 son pesos, no sellos.
      if (isBareWeightToken(t)) return false
      return true
    })
  return dropAbsorbedCounts(tokens)
}

// Si "ECK6303" y "ECK63031450" salen juntos, el segundo absorbió el conteo de bultos.
function dropAbsorbedCounts(tokens) {
  const list = [...new Set(tokens)]
  return list.filter((t) => !list.some((other) => (
    other.length >= 5
    && other.length < t.length
    && t.startsWith(other)
    && /^\d{3,5}$/.test(t.slice(other.length))
  )))
}

const SEAL_LINE_NOISE = /\b(FDA|HS|CODE|CONTRACT|CONTRATO|LOTE|DAE|WEIGHT|KGS?|KILOS?|BAGS|BOXES|CARTONS|CAJAS|INVOICE|BOOKING|NET|GROSS|TOTAL|PAGE|VOYAGE|VESSEL|FREIGHT|PORT|CONTAINER|CONTENEDOR|SHIPPER|MARKS|MARCAS|CBM|M3|CNT|TARE|PACKED|DESCRIPTION|MEASUREMENT|ORIGIN|PRODUCT)\b/i

function labeledSealTokens(line) {
  const s = str(line)
  if (!/(?:SEALS?|SELLOS?)\s*(?:[WBR]\s*)?[:.#]/i.test(s) && !/(?:(?:W|B|R|OTHER)\s+)(?:SEALS?|SELLOS?)\s*[:.#]/i.test(s)) {
    return null
  }
  const body = s
    .replace(/(?:(?:W|B|R|OTHER)\s+)?(?:SEALS?|SELLOS?)\s*[:.#]/gi, ' ')
    .replace(/(?:SEALS?|SELLOS?)\s*(?:W|B|R)\s*[:.#]/gi, ' ')
    .replace(/\/HC\d+\b.*/gi, ' ')
  return sealTokens(body)
}

function isPureSealLine(line) {
  const s = str(line).toUpperCase().replace(/\/HC\d+\b.*/g, '').trim()
  if (!s || SEAL_LINE_NOISE.test(s) || /\b(SEALS?|SELLOS?)\b/.test(s)) return false
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)?(?:[\s,;/]+[A-Z0-9]+(?:-[A-Z0-9]+)?)*$/.test(s)
}

// Un número pelado en el rango de un peso de contenedor (24,978) o del total (100,775)
// no es un sello si no viene detrás de la etiqueta SEAL.
function isBareWeightToken(token) {
  if (!/^\d+$/.test(token)) return false
  const n = Number(token)
  return (n >= 20000 && n <= 40000) || (n >= 100000 && n <= 400000)
}

// "A4 25 1040506" es un sello partido. "SPS151792 1450" no: 1450 es un conteo de bultos.
function joinShortSealGroups(line) {
  const s = str(line).toUpperCase().trim()
  if (!/^[A-Z0-9]+(?: [A-Z0-9]+)+$/.test(s)) return line
  const groups = s.split(' ')
  // "TYPE GRADO 3" son palabras. "ECK6303 1450" es un sello y el conteo de la columna de al lado.
  if (groups.some((g) => /^[A-Z]{4,}$/.test(g))) return line
  if (groups.some((g) => g.length >= 5 && /[A-Z]/.test(g) && /\d/.test(g)) && groups.some((g) => /^\d{3,5}$/.test(g))) return line
  const compact = groups.join('')
  if (!groups.some((g) => g.length < 5) || compact.length < 8 || compact.length > 14 || !/\d/.test(compact)) return line
  return compact
}

// Sellos de un bloque: cada "SEAL:" / "SEALS:" / "SELLO:" (también W/B/R y OTHER SEALS)
// y las líneas que son solo sellos. No entra el peso, el contrato, el lote ni el booking.
export function collectListedSeals(text) {
  const seals = []
  for (const line of str(text).split(/\n/)) {
    const labeled = labeledSealTokens(line)
    if (labeled) {
      seals.push(...labeled)
      continue
    }
    if (isPureSealLine(line)) {
      seals.push(...sealTokens(joinShortSealGroups(line.replace(/\/HC\d+\b.*/gi, ' '))).filter((t) => !isBareWeightToken(t)))
    }
  }
  return dropAbsorbedCounts(seals)
}

// RP0156380 y RP0156380EC son el mismo sello: el sufijo EC se conserva al leerlo
// y se ignora solo al comparar.
function sealKey(token) {
  if (/^RP\d+EC$/.test(token)) return token.slice(0, -2)
  return token
}

export function sealsMatch(a, b) {
  const A = [...new Set(sealTokens(a).map(sealKey))].sort()
  const B = [...new Set(sealTokens(b).map(sealKey))].sort()
  if (!A.length || !B.length || A.length !== B.length) return false
  return A.every((token, i) => token === B[i])
}

export function extractIsoId(text) {
  const raw = str(text).toUpperCase()
  const compact = raw.replace(/\s+/g, '')
  const hyphen = compact.match(/([A-Z]{4})(\d{6})-(\d)/)
  if (hyphen) return `${hyphen[1]}${hyphen[2]}${hyphen[3]}`
  const eight = raw.match(/\b([A-Z]{4}\d{8})\b/)
  const seven = raw.match(/\b([A-Z]{4}\d{7})\b/)
  if (eight && !seven) return eight[1]
  if (seven) return seven[1]
  // Con espacios dentro ("ZCSU 769095 2"), pero las 4 letras tienen que empezar palabra: "LOTE SGE3832026"
  // no es el contenedor ESGE3832026.
  const any = raw.match(/(?<![A-Z])([A-Z]{4})\s*((?:\d\s*){6}\d)(?!\d)/)
  if (any) return any[1] + any[2].replace(/\s+/g, '')
  const three = compact.match(/^([A-Z]{3}\d{7})$/)
  return three ? three[1] : ''
}

export function commodityCanon(value) {
  return canon(value)
    .replace(/\b[A-Z]{4}\d{6,8}\b/g, ' ')
    .replace(/\b\d+[.,]?\d*\s*K\s*[NB]\b/g, ' ')
    .replace(/\bSEALS?\b/g, ' ')
    .replace(/\bCONTAINERS?\b/g, ' ')
    .replace(/^\d+\s+/, '')
    .replace(/^BAGS OF\s+/, '')
    .replace(/^BAGS\s+/, '')
    .replace(/\bSTC\b/g, ' ')
    .replace(/\b\dX40HQ\b/g, ' ')
    .replace(/\bECUADORIAN\b/g, 'ECUADOR')
    .replace(/\bTYPE GRADO\b/g, 'GRADE')
    .replace(/\bTYPE GRADE\b/g, 'GRADE')
    .replace(/\bGRADO\b/g, 'GRADE')
    .replace(/\bRFA\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
