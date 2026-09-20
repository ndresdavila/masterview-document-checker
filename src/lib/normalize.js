export function str(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-6) {
      return String(Math.round(value))
    }
    return String(value)
  }
  return String(value).replace(/\u00a0/g, ' ').trim()
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

export function numbersClose(a, b, tol = 0.051) {
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

export const ISO_RE = /\b([A-Z]{4}\d{7})\b/
export const VOYAGE_RE = /\b(0[A-Z]{2,6}\d[A-Z]{1,3}|\d{2,6}[NSEW])\b/
export const BL_RE = /\b([A-Z]{4}\d{2}[A-Z]{2}\d{5,})\b/
export const BOOKING_RE = /\b(ZIMU\s*[A-Z]{2,5}\s*\d{5,}|GYEG\s*\d{8,}|\d{10})\b/i

export function isVoyageToken(token) {
  const s = canon(token).replace(/\s+/g, '')
  return /^0[A-Z]{2,6}\d[A-Z]{1,3}$/.test(s) || /^\d{2,6}[NSEW]$/.test(s)
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

  if (!voyage) {
    return { vessel: stripLabels(raw), voyage: '', portLoading: '' }
  }
  const unglued = raw.replace(new RegExp(`([^\\s])(${voyage})\\b`, 'i'), `$1 ${voyage}`)
  const parts = unglued.split(new RegExp(`\\b${voyage}\\b`, 'i'))
  return {
    vessel: stripLabels(parts[0] || ''),
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
  if (A === B) return true
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

export function sealTokens(value) {
  return str(value)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => {
      if (t.length < 5 || t.length > 14) return false
      if (!/\d/.test(t)) return false
      if (/X40HQ/.test(t)) return false
      if (ISO_RE.test(t)) return false
      if (/^(BAGS|SEALS?|SELLOS?|NET|GROSS|WEIGHT|CONTAINER|CONTENEDOR)$/.test(t)) return false
      return true
    })
}

export function sealsMatch(a, b) {
  const A = sealTokens(a)
  const B = sealTokens(b)
  if (!A.length || !B.length) return false
  return A.some((x) => B.includes(x))
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
  const three = raw.match(/\b([A-Z]{3}\d{7})\b/)
  if (three) return three[1]
  const any = compact.match(/([A-Z]{4}\d{7})/)
  return any ? any[1] : ''
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
