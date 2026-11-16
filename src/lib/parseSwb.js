import * as XLSX from 'xlsx'
import {
  str,
  parseNumber,
  ISO_RE,
  splitVesselVoyagePort,
  extractBooking,
  extractIsoId,
  sealTokens,
} from './normalize.js'
import { parseHblFromPlainText, parseHblFromPdfWords } from './parseHbl.js'

function gridFromSheet(sheet) {
  const ref = sheet['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const grid = []
  for (let r = 0; r <= range.e.r; r += 1) {
    const row = []
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      row.push(cell ? cell.v : '')
    }
    grid.push(row)
  }
  return grid
}

function findLabel(grid, re) {
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const s = str(grid[r][c])
      if (s && re.test(s)) return { r, c, s }
    }
  }
  return null
}

function cellLines(value) {
  return str(value)
    .split(/\r?\n/)
    .map(str)
    .filter(Boolean)
}

function collectCol(grid, { r0, r1, c, stop }) {
  const lines = []
  const end = r1 ?? grid.length
  for (let r = r0; r < end; r += 1) {
    const parts = cellLines(grid[r]?.[c])
    if (!parts.length) continue
    for (const s of parts) {
      if (stop && stop.test(s)) return lines
      lines.push(s)
    }
  }
  return lines
}

const JUNK_PARTY = /^(country of origin|booking no\.?|shipper'?s ref\.?|f\/agent.*|scac:.*|carrier|second notify:?|notify party:?|consignee|shipper|ecuador|full address of place of (receipt|delivery)|intended (port|vessel|transshipment).*|containers?\s*&\s*seals|no\.?\s*of original.*|gross weight|measurement|\(?if\s+applicable\)?\.?|applicable\))$/i

function partyBlob(party) {
  return [(party?.name || ''), (party?.address || ''), ...((party?.lines) || [])].join(' ')
}

function isCarrierBox(party) {
  const t = partyBlob(party).toUpperCase()
  if (!t.trim()) return true
  return /SUCRE ARIAS|UCC LOGISTICS|P\.O\.\s*BOX 0816|EDIFICIO SUCRE|RICARDO ARANGO|PANAMA,\s*PANAMA|PLACE OF DELIVERY|NO\.?\s*OF ORIGINAL BILLS|GROSS WEIGHT MEASUREMENT|SPECIAL CLAUSES/.test(t)
}

function splitParty(lines) {
  const rucFrom = (l) => str(l).match(/R\.?U\.?C\.?\s*:?\s*([0-9]{10,13})/i)?.[1] || ''
  const ruc = lines.map(rucFrom).find(Boolean) || ''
  const clean = lines
    .map(str)
    .map((l) => l.replace(/R\.?U\.?C\.?\s*:?\s*[0-9]{10,13}/i, '').trim())
    .filter((l) => l && !JUNK_PARTY.test(l))
    .filter((l) => !/^(c\/o sucre arias|p\.o\.\s*box 0816|edificio sucre|av\.\s*ricardo arango)/i.test(l))
    .filter((l) => !/^panama,?\s*panama$/i.test(l))
  const cut = clean.findIndex((l) => /full address of place of receipt|intended port of loading|intended vessel/i.test(l))
  const kept = cut >= 0 ? clean.slice(0, cut) : clean
  return {
    name: kept[0] || '',
    address: kept.slice(1).join('\n'),
    lines: kept,
    ruc,
  }
}

function isSealToken(value) {
  const tokens = sealTokens(value)
  return tokens.length > 0 && !ISO_RE.test(str(value).toUpperCase())
}

// La casilla Gross Weight (Excel G25/G26, o la columna del PDF) y la linea
// "GROSS WEIGHT:" de la descripcion se leen por separado. La que no aparezca queda null.
function grossKgInCell(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 100) return value
  const s = str(value)
  if (!s || !/\d/.test(s)) return null
  if (/gross\s+weight\s*:/i.test(s)) return null
  if (/cbm/i.test(s) && !/\bkg/i.test(s)) return null
  const kg = s.match(/([\d,]+\.?\d*)\s*KGS?\b/i)
  const n = parseNumber(kg ? kg[1] : s)
  if (n == null || n < 100) return null
  return n
}

function grossKgFromSwbGrid(grid) {
  const lbl = findLabel(grid, /^gross\s*weight$/i)
  if (!lbl) return null
  const spots = [
    [lbl.r + 1, lbl.c],
    [lbl.r, lbl.c],
    [lbl.r + 1, lbl.c + 1],
    [lbl.r, lbl.c + 1],
  ]
  for (const [r, c] of spots) {
    const n = grossKgInCell(grid[r]?.[c])
    if (n != null) return n
  }
  return null
}

function swbPdfWords(pages) {
  const words = []
  for (const page of pages || []) {
    for (const w of page.words || []) {
      if (str(w.str)) words.push(w)
    }
  }
  return words
}

function swbPdfGrossHeaders(words) {
  const headers = []
  for (const g of words) {
    if (!/^gross$/i.test(str(g.str))) continue
    const weight = words.find((w) => (
      /^weights?:?$/i.test(str(w.str))
      && Math.abs(w.y - g.y) <= 3
      && w.x > g.x
      && w.x < g.x + 90
    ))
    if (!weight || /:$/.test(str(weight.str))) continue
    const colon = words.some((w) => (
      str(w.str) === ':'
      && Math.abs(w.y - weight.y) <= 3
      && w.x >= weight.x
      && w.x < weight.x + 16
    ))
    if (colon) continue
    const sameLine = words
      .filter((w) => Math.abs(w.y - g.y) <= 3 && w.x >= g.x - 8)
      .sort((a, b) => a.x - b.x)
      .map((w) => str(w.str))
      .join(' ')
    if (/gross[ \t]+weight(?:[ \t]*\([^)\n]{0,16}\))?[ \t]*:?[ \t]*[\d,]/i.test(sameLine)) continue
    headers.push(g)
  }
  return headers
}

function swbPdfColumnLine(words, header, y, x1) {
  return words
    .filter((w) => Math.abs(w.y - y) <= 3 && w.x >= header.x - 12 && w.x < x1)
    .sort((a, b) => a.x - b.x)
    .map((w) => str(w.str))
    .join(' ')
}

// Casilla: la cifra pegada al rotulo (hasta 36px) y, si no hay, el total de la columna
// ("252,285.00 KG" al lado de "600.00 CBM"), que puede quedar mucho mas abajo.
function grossKgFromSwbPdfWords(pages) {
  const words = swbPdfWords(pages)
  const headers = swbPdfGrossHeaders(words)
  const near = []
  const column = []
  for (const h of headers) {
    const ys = new Set()
    for (const w of words) {
      if (w.y <= h.y + 4 || w.y > h.y + 36) continue
      if (w.x < h.x - 12 || w.x > h.x + 140) continue
      ys.add(Math.round(w.y))
    }
    for (const y of ys) {
      const line = swbPdfColumnLine(words, h, y, h.x + 140)
      if (/gross\s+weight\s*:/i.test(line)) continue
      const n = grossKgInCell(line)
      if (n != null) near.push(n)
    }
    for (const w of words) {
      if (w.y <= h.y + 36) continue
      if (w.x < h.x - 12 || w.x > h.x + 80) continue
      if (!/\d/.test(str(w.str))) continue
      const y = w.y
      const besideCbm = words.some((other) => (
        Math.abs(other.y - y) <= 4
        && other.x >= h.x
        && /cbm/i.test(str(other.str))
      ))
      if (!besideCbm) continue
      const line = swbPdfColumnLine(words, h, y, h.x + 260)
      const n = grossKgInCell(line)
      if (n != null && n > 40000) column.push(n)
    }
  }
  return {
    near: near.length ? Math.max(...near) : null,
    column: column.length ? Math.max(...column) : null,
  }
}

function sameKg(a, b) {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) <= 0.51
}

// "GROSS WEIGHT" con o sin dos puntos, en la misma linea, KG o KGS.
// No cruza el salto de linea: el rotulo de la casilla y la cifra de abajo no son la descripcion.
function grossWeightAmounts(text) {
  const t = str(text)
  const hits = []
  const re = /GROSS[ \t]+WEIGHT(?:[ \t]*\([ \t]*KGS?\.?[ \t]*\))?[ \t]*:?[ \t]*([\d,]+\.?\d*)/gi
  for (const m of t.matchAll(re)) {
    const n = parseNumber(m[1])
    if (n == null || n < 100) continue
    const before = t.slice(Math.max(0, m.index - 16), m.index)
    hits.push({ n, total: /TOTAL[ \t]+$/i.test(before) })
  }
  return hits
}

function grossKgFromDescriptionText(text) {
  const hits = grossWeightAmounts(text)
  const totals = hits.filter((h) => h.total)
  if (totals.length) return totals[totals.length - 1].n
  const large = hits.filter((h) => h.n > 40000)
  if (large.length) return large[large.length - 1].n
  return null
}

function textHasGrossWeightAmount(text, n) {
  return grossWeightAmounts(text).some((hit) => sameKg(hit.n, n))
}

function kgBesideCbmHas(text, n) {
  const re = /([\d,]+\.?\d*)\s*KGS?\s+(?:[\d,]+\.?\d*\s*LBS\s+)?[\d,]+\.?\d*\s*CBM/gi
  for (const m of str(text).matchAll(re)) {
    const value = parseNumber(m[1])
    if (value != null && value > 40000 && sameKg(value, n)) return true
  }
  return false
}

// El total que ya sacaba el lector anterior (casilla cercana, si no el texto) se conserva.
// La casilla y la descripcion se agregan encima; si ese total no cayo en ninguna, se copia al campo que le corresponde.
function resolveSwbGross(totals, { near, column, description, text }) {
  const baseline = totals?.grossKg ?? null
  const mainGross = near ?? baseline ?? null
  let grossKgBox = near ?? null
  let grossKgDescription = description ?? null
  if (column != null && grossKgBox == null) grossKgBox = column
  const keep = (n) => {
    if (n == null || sameKg(grossKgBox, n) || sameKg(grossKgDescription, n)) return
    const asBox = !textHasGrossWeightAmount(text, n) && kgBesideCbmHas(text, n)
    if (asBox && grossKgBox == null) grossKgBox = n
    else if (!asBox && grossKgDescription == null) grossKgDescription = n
    else if (grossKgBox == null) grossKgBox = n
    else if (grossKgDescription == null) grossKgDescription = n
  }
  keep(mainGross)
  if (!sameKg(baseline, mainGross)) keep(baseline)
  return {
    ...(totals || {}),
    grossKgBox,
    grossKgDescription,
    grossKg: mainGross ?? grossKgBox ?? grossKgDescription ?? null,
  }
}

function swbGrossTotals(totals, boxGross, descGross, text = '') {
  return resolveSwbGross(totals, {
    near: boxGross ?? null,
    column: null,
    description: descGross ?? null,
    text,
  })
}

// Excel y PDF dejan las dos cifras (o null). Un SWB Word no tiene casilla: el peso
// que ya traia el texto queda como descripcion, y la casilla queda null.
function swbGrossFromDoc(totals = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(totals, key)
  if (has('grossKgBox') || has('grossKgDescription')) {
    return resolveSwbGross(totals, {
      near: null,
      column: has('grossKgBox') ? totals.grossKgBox : null,
      description: has('grossKgDescription') ? totals.grossKgDescription : null,
      text: '',
    })
  }
  return resolveSwbGross(totals, {
    near: null,
    column: null,
    description: totals.grossKg ?? null,
    text: '',
  })
}

function lastNwGw(text) {
  const raw = str(text)
  const nets = [...raw.matchAll(/([\d.,]+)\s*(?:N\.?\s*W|K\.?\s*N|KG\s*NET)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  const grosses = [...raw.matchAll(/([\d.,]+)\s*(?:G\.?\s*W|K\.?\s*B|KG\s*GROSS)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  return {
    netKg: nets.length ? nets[nets.length - 1] : null,
    grossKg: grosses.length ? grosses[grosses.length - 1] : null,
  }
}

function firstCell(row) {
  for (const value of row || []) {
    const s = str(value)
    if (s) return s
  }
  return ''
}

function parseSwbContainers(grid, startRow) {
  const containers = []
  let current = null
  const flush = () => {
    if (current?.id) {
      if (current.seals?.length && !current.seal) current.seal = current.seals.join(', ')
      containers.push({
        id: current.id,
        seal: current.seal || '',
        pkgs: current.pkgs,
        description: current.description,
        netKg: current.netKg,
        grossKg: current.grossKg,
        cbm: null,
      })
    }
    current = null
  }

  for (let r = startRow; r < grid.length; r += 1) {
    const row = grid[r] || []
    const c0 = firstCell(row)
    const desc = str(row[4] || row[3] || row[2])
    const joined = row.map(str).filter(Boolean).join(' ')

    if (/total bags|total net weight|total gross weight/i.test(joined)) {
      flush()
      break
    }
    if (/^container:?$/i.test(c0)) {
      flush()
      current = {
        id: '',
        seal: '',
        seals: [],
        pkgs: null,
        description: '',
        netKg: null,
        grossKg: null,
      }
    } else if (!current) {
      continue
    }

    if (!current) continue

    if (/^(total bags|total net weight|packed in\b|\d+[.,]\d+\s*MTS\b)/i.test(joined) && !/^container:?$/i.test(firstCell(row))) {
      flush()
      break
    }
    // La fila MARKS cierra el bloque de contenedores: lo que sigue es la descripcion general del embarque.
    if (/^marks\b/i.test(c0)) {
      flush()
      break
    }

    const iso = extractIsoId(c0) || extractIsoId(joined)
    if (iso && !current.id) current.id = iso

    if (/^seals?:/i.test(c0)) {
      current.seals.push(...sealTokens(c0.replace(/^seals?:?\s*/i, '')))
    } else if (current.id && isSealToken(c0) && !iso && !/^(DAE|FDA|HS CODE|CONTRACT|CONTRATO|REF|INVOICE|LOTE)/i.test(c0)) {
      current.seals.push(...sealTokens(c0))
    }

    const bagsHit = `${desc} ${joined}`.match(/(\d{2,4})\s+BAGS OF/i)
    const pkgs = bagsHit ? parseNumber(bagsHit[1]) : null
    if (pkgs != null && pkgs >= 100 && pkgs < 800 && current.pkgs == null) current.pkgs = pkgs

    if (/cocoa|beans|bags of|arabica|coffee|rice|cajas|boxes/i.test(desc)) {
      if (!current.description || !current.description.includes(desc)) {
        current.description = current.description ? `${current.description} ${desc}` : desc
      }
    }

    const weights = lastNwGw(`${desc} ${joined}`)
    if (weights.netKg != null) current.netKg = weights.netKg
    if (weights.grossKg != null) current.grossKg = weights.grossKg
  }
  flush()
  return containers
}

function trimPartyAtFormLabels(party) {
  if (!party) return party
  const lines = (party.lines || [])
    .map(str)
    .filter(Boolean)
    .filter((l) => !JUNK_PARTY.test(l))
  const cut = lines.findIndex((l) => /full address of place of receipt|intended port of loading|intended vessel|containers?\s*&/i.test(l))
  const kept = cut >= 0 ? lines.slice(0, cut) : lines
  return {
    ...party,
    name: kept[0] || party.name || '',
    address: kept.slice(1).join('\n'),
    lines: kept,
  }
}

export function looksLikeSwbContent(text = '') {
  return /sea\s*waybill/i.test(str(text)) && !/proforma/i.test(str(text).slice(0, 400))
}

export function finalizeSwb(doc, fileName = '') {
  const notify = trimPartyAtFormLabels(doc.notify)
  const second = trimPartyAtFormLabels(doc.secondNotify)
  const shipper = trimPartyAtFormLabels(doc.shipper)
  const consignee = trimPartyAtFormLabels(doc.consignee)

  const emptyParty = { name: '', address: '', lines: [] }
  const formChromeParty = (party) => {
    const t = partyBlob(party)
    if (!t.trim()) return true
    if (/intended (port|vessel|transshipment)|if applicable|full address of place of delivery|no\.?\s*of original bills/i.test(t)
      && !/\b(llc|inc\.?|s\.a|logistics|international|company)\b/i.test(t)) return true
    return false
  }
  let notifyOut = isCarrierBox(notify) ? emptyParty : notify
  let secondOut = isCarrierBox(second) || formChromeParty(second) ? emptyParty : second
  if (!(notifyOut?.name) && secondOut?.name && !isCarrierBox(secondOut)) {
    notifyOut = secondOut
    secondOut = emptyParty
  }

  const raw = [
    doc.marks?.text,
    ...(doc.marks?.lines || []),
    doc.extras?._raw,
    fileName,
  ].filter(Boolean).join('\n')
  const freightCollect = /FREIGHT\s+COLLECT|FREIGH\s+COLLECT/i.test(raw) || Boolean(doc.extras?.freightCollect)
  const freightTypo = /FREIGH\s+COLLECT/i.test(raw) && !/FREIGHT\s+COLLECT/i.test(raw)

  const restExtras = { ...(doc.extras || {}) }
  delete restExtras._raw
  const totals = swbGrossFromDoc(doc.totals || {})
  return {
    ...doc,
    kind: 'swb',
    totals,
    fileName: fileName || doc.fileName,
    shipper,
    consignee,
    notify: notifyOut,
    secondNotify: secondOut,
    extras: {
      ...restExtras,
      ruc: shipper?.ruc || restExtras.ruc || '',
      freightCollect,
      freightTypo,
    },
  }
}

export function parseSwbFromGrid(grid, fileName = '') {
  const blob = grid.map((row) => (row || []).map(str).filter(Boolean).join('\n')).join('\n')
  const fromText = parseHblFromPlainText(blob, fileName)

  const shipperLbl = findLabel(grid, /^shipper$/i)
  const consigneeLbl = findLabel(grid, /^consignee$/i)
  const notifyLbl = findLabel(grid, /notify party/i)
  const secondLbl = findLabel(grid, /second notify/i)
  const placeLbl = findLabel(grid, /full address of place of receipt/i)
  const vesselLbl = findLabel(grid, /^intended vessel$/i) || findLabel(grid, /^vessel$/i)
  const polLbl = findLabel(grid, /intended port of loading|port of loading/i)
  const podLbl = findLabel(grid, /intended port of discharge|port of discharge/i)
  const blLbl = findLabel(grid, /bill of lading no/i)
  const bookingLbl = findLabel(grid, /booking no/i)
  const cargoLbl = findLabel(grid, /containers?\s*&\s*seals|^container:?$/i)

  const shipperLines = shipperLbl
    ? collectCol(grid, {
        r0: shipperLbl.r + 1,
        r1: consigneeLbl?.r,
        c: shipperLbl.c,
        stop: /consignee/i,
      })
    : []
  const consigneeLines = consigneeLbl
    ? collectCol(grid, {
        r0: consigneeLbl.r + 1,
        r1: notifyLbl?.r,
        c: consigneeLbl.c,
        stop: /notify party/i,
      })
    : []
  const notifyLines = notifyLbl
    ? collectCol(grid, {
        r0: notifyLbl.r + 1,
        r1: placeLbl?.r ?? vesselLbl?.r,
        c: notifyLbl.c,
        stop: /full address of place of receipt|intended vessel|intended port of loading/i,
      })
    : []
  const secondLines = secondLbl
    ? collectCol(grid, {
        r0: secondLbl.r + 1,
        r1: placeLbl?.r ?? vesselLbl?.r,
        c: secondLbl.c,
        stop: /full address of place of receipt|intended vessel/i,
      })
    : []

  const shipper = splitParty(shipperLines)
  const consignee = splitParty(consigneeLines)
  const notify = splitParty(notifyLines)
  const secondNotify = splitParty(secondLines.filter((l) => l && !/^\s*$/.test(l)))

  const bookingNo = bookingLbl
    ? extractBooking(str(grid[bookingLbl.r + 1]?.[bookingLbl.c]) || str(grid[bookingLbl.r]?.[bookingLbl.c]))
    : fromText.bookingNo
  const blNo = blLbl
    ? (str(grid[blLbl.r + 1]?.[blLbl.c]).toUpperCase().match(/\b(ULGO\d{2}[A-Z]{2}\d{5,})\b/)?.[1] || str(grid[blLbl.r + 1]?.[blLbl.c]))
    : fromText.blNo

  const vesselRaw = vesselLbl ? str(grid[vesselLbl.r + 1]?.[vesselLbl.c]) : ''
  const split = splitVesselVoyagePort(vesselRaw || `${fromText.vessel} ${fromText.voyage}`)
  const portLoading = polLbl ? str(grid[polLbl.r + 1]?.[polLbl.c]) : fromText.portLoading
  const portDischarge = podLbl
    ? str(grid[podLbl.r + 1]?.[podLbl.c]) || str(grid[podLbl.r + 1]?.[2])
    : fromText.portDischarge

  const cargoStart = cargoLbl?.r ?? 0
  let containers = parseSwbContainers(grid, cargoStart)
  if (!containers.length) containers = fromText.containers || []
  containers.forEach((c) => {
    const full = (fromText.containers || []).find((x) => x.id === c.id)
    if (!full) return
    if (c.netKg == null) c.netKg = full.netKg
    if (c.grossKg == null) c.grossKg = full.grossKg
    if (!c.seal) c.seal = full.seal
    if (c.pkgs == null) c.pkgs = full.pkgs
    if (!c.description) c.description = full.description
  })

  // Marcas: la columna de "CONTAINER:" despues del ultimo contenedor y sus sellos, hasta Special Clauses /
  // FREIGHT CHARGES. El texto corrido mezcla la descripcion de la columna de al lado.
  const gridMarks = (() => {
    const lbl = findLabel(grid, /^container:?$/i)
    if (!lbl || !containers.length) return null
    const ids = new Set(containers.map((c) => c.id))
    const sealSet = new Set(containers.flatMap((c) => sealTokens(c.seal)))
    const lines = []
    for (let r = lbl.r; r < grid.length; r += 1) {
      const parts = cellLines(grid[r]?.[lbl.c])
      if (parts.some((p) => /^(special clauses|freight charges)/i.test(p))) break
      lines.push(...parts)
    }
    let last = -1
    lines.forEach((s, i) => {
      const tokens = sealTokens(s)
      if (/^(containers?|seals?):?$/i.test(s) || ids.has(extractIsoId(s)) || (tokens.length && tokens.every((t) => sealSet.has(t)))) last = i
    })
    const out = lines.slice(last + 1).filter((s) => !/^marks(\s+and\s+nos\.?)?:?$/i.test(s))
    return out.length ? out : null
  })()
  const marks = gridMarks
    ? { text: gridMarks.join('\n'), lote: fromText.marks?.lote || '', lines: gridMarks }
    : fromText.marks

  const boxGross = grossKgFromSwbGrid(grid)
  const descGross = grossKgFromDescriptionText(blob)
  return finalizeSwb(
    {
      ...fromText,
      totals: swbGrossTotals(fromText.totals, boxGross, descGross, blob),
      marks,
      shipper: shipper.name ? shipper : fromText.shipper,
      consignee: consignee.name ? consignee : fromText.consignee,
      notify: notify.name ? notify : fromText.notify,
      secondNotify: secondLbl ? secondNotify : (secondNotify.name ? secondNotify : fromText.secondNotify),
      bookingNo: bookingNo || fromText.bookingNo,
      blNo: blNo || fromText.blNo,
      vessel: split.vessel || fromText.vessel,
      voyage: split.voyage || fromText.voyage,
      portLoading: portLoading || fromText.portLoading,
      portDischarge: portDischarge || fromText.portDischarge,
      containers,
      extras: { ...fromText.extras, _raw: blob },
    },
    fileName,
  )
}

export function parseSwbArrayBuffer(buffer, fileName = '') {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const grid = gridFromSheet(sheet)
  return parseSwbFromGrid(grid, fileName)
}

export function excelLooksLikeSwb(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const grid = gridFromSheet(sheet)
    const head = grid.slice(0, 8).flat().map(str).join(' ')
    return looksLikeSwbContent(head)
  } catch {
    return false
  }
}

function groupedPageText(words, yTol = 5) {
  const sorted = [...(words || [])].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  for (const w of sorted) {
    const t = str(w.str)
    if (!t) continue
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - w.y) <= yTol) last.words.push(w)
    else lines.push({ y: w.y, words: [w] })
  }
  return lines
    .map((l) => l.words.sort((a, b) => a.x - b.x).map((w) => str(w.str)).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function parseSwbFromPdfPages(pages, fileName = '') {
  const extra = pages.slice(1).map((p) => p.text).join('\n')
  const doc = parseHblFromPdfWords(pages[0]?.words || [], fileName, extra)
  const grouped = pages.map((p) => groupedPageText(p.words)).join('\n')
  const fromGrouped = parseHblFromPlainText(grouped, fileName)
  if (fromGrouped.containers?.length) {
    const layout = doc.containers || []
    doc.containers = fromGrouped.containers.map((c) => {
      const hit = layout.find((x) => x.id === c.id) || {}
      return {
        ...hit,
        ...c,
        seal: c.seal || hit.seal || '',
        pkgs: c.pkgs ?? hit.pkgs ?? null,
        netKg: c.netKg ?? hit.netKg ?? null,
        grossKg: c.grossKg ?? hit.grossKg ?? null,
        description: c.description || hit.description || '',
      }
    })
  }
  if (fromGrouped.vessel && (!doc.vessel || /GUAYAQUIL|ECUADOR|LOAD PICKUP/i.test(doc.vessel))) {
    doc.vessel = fromGrouped.vessel
    doc.voyage = fromGrouped.voyage || doc.voyage
  }
  // SWB de envios ONE: "Intended Vessel" sale dos veces (cabecera repetida); el valor es la primera linea
  // de la columna debajo del ultimo ("ONE SHINE 2626WN"). Solo si no hay viaje.
  if (!doc.voyage) {
    const w1 = pages[0]?.words || []
    const lbl = w1.filter((w) => /^intended vessel$/i.test(str(w.str))).sort((a, b) => b.y - a.y)[0]
    const near = lbl ? w1.filter((w) => str(w.str) && w.y > lbl.y + 2 && w.y < lbl.y + 24 && w.x >= lbl.x - 5 && w.x < lbl.x + 90) : []
    const y0 = Math.min(...near.map((w) => w.y))
    const below = near.filter((w) => Math.abs(w.y - y0) <= 2).sort((a, b) => a.x - b.x)
    const m = below.map((w) => str(w.str)).join(' ').replace(/\s+/g, ' ').trim().match(/^(.+?)\s+([A-Z]{0,4}\d{2,4}[A-Z]{0,2}\d{0,2})$/)
    if (m) { doc.vessel = m[1]; doc.voyage = m[2] }
  }
  if (fromGrouped.notify?.name && isCarrierBox(doc.notify)) doc.notify = fromGrouped.notify
  if (fromGrouped.portLoading && (!doc.portLoading || /empty container|country of export/i.test(doc.portLoading))) {
    doc.portLoading = fromGrouped.portLoading
  }
  if (fromGrouped.portDischarge && (!doc.portDischarge || /please check eta|size \/ type/i.test(doc.portDischarge))) {
    doc.portDischarge = fromGrouped.portDischarge
  }
  // La caja de marcas del PDF termina donde empieza el pie del formulario (Special Clauses, FREIGHT CHARGES).
  const FOOTER = /^(special clauses|freight charges|received by the carrier)/i
  if (doc.marks?.lines?.some((l) => FOOTER.test(str(l)))) {
    const lines = doc.marks.lines.slice(0, doc.marks.lines.findIndex((l) => FOOTER.test(str(l))))
    const cut = str(doc.marks.text).split(/\r?\n/)
    const at = cut.findIndex((l) => FOOTER.test(str(l)))
    doc.marks = { ...doc.marks, lines, text: at >= 0 ? cut.slice(0, at).join('\n') : doc.marks.text }
  }
  const boxGross = grossKgFromSwbPdfWords(pages)
  const descGross = grossKgFromDescriptionText(grouped)
  return finalizeSwb({
    ...doc,
    totals: resolveSwbGross(doc.totals, {
      near: boxGross.near,
      column: boxGross.column,
      description: descGross,
      text: grouped,
    }),
    extras: { ...doc.extras, _raw: grouped },
  }, fileName)
}
