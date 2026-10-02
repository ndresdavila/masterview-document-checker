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

const JUNK_PARTY = /^(country of origin|booking no\.?|shipper'?s ref\.?|f\/agent.*|scac:.*|carrier|second notify:?|notify party:?|consignee|shipper|ecuador|full address of place of (receipt|delivery)|intended (port|vessel|transshipment).*|containers?\s*&\s*seals|no\.?\s*of original.*|gross weight|measurement)$/i

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

    const iso = extractIsoId(c0) || extractIsoId(joined)
    if (iso && !current.id) current.id = iso

    if (/^seals?:/i.test(c0)) {
      current.seals.push(...sealTokens(c0.replace(/^seals?:?\s*/i, '')))
    } else if (current.id && isSealToken(c0) && !iso) {
      current.seals.push(...sealTokens(c0))
    }

    const bagsHit = `${desc} ${joined}`.match(/(\d{2,4})\s+BAGS OF/i)
    const pkgs = bagsHit ? parseNumber(bagsHit[1]) : null
    if (pkgs != null && pkgs >= 100 && pkgs < 800) current.pkgs = pkgs

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
  let notifyOut = isCarrierBox(notify) ? emptyParty : notify
  let secondOut = isCarrierBox(second) ? emptyParty : second
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
  return {
    ...doc,
    kind: 'swb',
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

  return finalizeSwb(
    {
      ...fromText,
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
  if (fromGrouped.notify?.name && isCarrierBox(doc.notify)) doc.notify = fromGrouped.notify
  if (fromGrouped.portLoading && (!doc.portLoading || /empty container|country of export/i.test(doc.portLoading))) {
    doc.portLoading = fromGrouped.portLoading
  }
  if (fromGrouped.portDischarge && (!doc.portDischarge || /please check eta|size \/ type/i.test(doc.portDischarge))) {
    doc.portDischarge = fromGrouped.portDischarge
  }
  return finalizeSwb({
    ...doc,
    extras: { ...doc.extras, _raw: grouped },
  }, fileName)
}
