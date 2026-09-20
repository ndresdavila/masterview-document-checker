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
      if (/^contacto:?$/i.test(s)) continue
      if (/unless provided|non-negotiable unless/i.test(s)) continue
      if (/principal or seller|name and full address/i.test(s)) continue
      if (/copy non-negotiable/i.test(s)) continue
      lines.push(s)
    }
  }
  return lines
}

function splitParty(lines) {
  const rucFrom = (l) => str(l).match(/R\.?U\.?C\.?\s*:?\s*([0-9]{10,13})/i)?.[1] || ''
  const ruc = lines.map(rucFrom).find(Boolean) || ''
  const clean = lines
    .map(str)
    .map((l) => l.replace(/R\.?U\.?C\.?\s*:?\s*[0-9]{10,13}/i, '').trim())
    .filter(Boolean)
  return {
    name: clean[0] || '',
    address: clean.slice(1).join('\n'),
    lines: clean,
    ruc,
  }
}

function isSealToken(value) {
  const tokens = sealTokens(value)
  return tokens.length > 0 && !ISO_RE.test(str(value).toUpperCase())
}

function knKb(text) {
  const raw = str(text)
  const kn = raw.match(/([\d.,]+)\s*K\.?\s*N/i)
  const kb = raw.match(/([\d.,]+)\s*K\.?\s*B/i)
  return {
    netKg: kn ? parseNumber(kn[1]) : null,
    grossKg: kb ? parseNumber(kb[1]) : null,
  }
}

function plausiblePkgs(n) {
  return n != null && n > 0 && n < 800
}

function plausibleGross(n) {
  return n != null && n > 0 && n < 40000
}

function plausibleCbm(n) {
  return n != null && n > 0 && n <= 80
}

function plausibleNet(n) {
  return n != null && n > 0 && n < 40000
}

function bagsFromText(text) {
  const m = str(text).match(/(\d+)\s+BAGS/i)
  return m ? parseNumber(m[1]) : null
}

function pickPkgs(rowPkgs, desc) {
  const fromDesc = bagsFromText(desc)
  if (fromDesc != null && rowPkgs != null && rowPkgs >= 800 && fromDesc < 800) return fromDesc
  if (rowPkgs != null && rowPkgs > 0 && rowPkgs < 800) return rowPkgs
  if (fromDesc != null && fromDesc > 0 && fromDesc < 800) return fromDesc
  if (rowPkgs != null && rowPkgs > 0 && rowPkgs <= 5000) return rowPkgs
  return fromDesc
}

function saneTotal(labelVal, sumVal) {
  if (labelVal == null) return sumVal || null
  if (sumVal && sumVal > 0 && Math.abs(labelVal / sumVal - 100) < 0.02) return sumVal
  return labelVal
}

function parseContainers(grid, startRow, endRow) {
  const containers = []
  let current = null
  let totalRowCbm = null
  let collectingSeals = false
  const flush = () => {
    if (current && (current.id || current.description)) {
      if (current.seals?.length && !current.seal) current.seal = current.seals.join(', ')
      containers.push(current)
    }
    current = null
    collectingSeals = false
  }

  for (let r = startRow; r < endRow; r += 1) {
    const row = grid[r] || []
    const c0 = str(row[0])
    const joined = row.map(str).filter(Boolean).join(' | ')

    if (/^contenedor:?$/i.test(c0) || /^container:?$/i.test(c0)) {
      flush()
      const descCell = str(row[5] || row[4])
      const weights = knKb(descCell)
      const rowPkgs = parseNumber(row[3])
      const rowGross = parseNumber(row[8])
      const rowCbm = parseNumber(row[9])
      current = {
        id: '',
        seal: '',
        seals: [],
        pkgs: pickPkgs(rowPkgs, descCell),
        description: /cocoa|bags|beans|grado|grade|cajas|boxes|atun|tuna/i.test(descCell) ? descCell : '',
        netKg: (() => {
          const fromDesc = /net weight/i.test(descCell) ? parseNumber(descCell) : null
          if (plausibleNet(fromDesc)) return fromDesc
          return plausibleNet(weights.netKg) ? weights.netKg : weights.netKg
        })(),
        grossKg: plausibleGross(rowGross) ? rowGross : weights.grossKg,
        cbm: plausibleCbm(rowCbm) ? rowCbm : null,
      }
      continue
    }

    if (/total bags|total cajas|total net|peso neto total|total gross|^2nd notify|^hs code/i.test(joined)) {
      break
    }

    if (!current) continue

    if (!c0 && parseNumber(row[8]) != null && !str(row[3]) && !str(row[5]) && !str(row[4])) {
      totalRowCbm = parseNumber(row[9])
      continue
    }

    if (/^marcas:?$/i.test(c0) || /^marcas:/i.test(c0)) {
      collectingSeals = false
      continue
    }

    if (/^sellos?:?$/i.test(c0) || /^sellos?:/i.test(c0)) {
      const rest = [c0.replace(/^sellos?:?\s*/i, ''), ...row.slice(1).map(str)]
        .map(str)
        .filter(Boolean)
        .join(', ')
      current.seals.push(...sealTokens(rest))
      collectingSeals = true
      continue
    }

    if (!current.pkgs) {
      current.pkgs = pickPkgs(parseNumber(row[3]), row[5] || row[4])
    }
    if (!current.grossKg) {
      const rowGross = parseNumber(row[8])
      if (plausibleGross(rowGross) && !/^kgs?$/i.test(str(row[8]))) current.grossKg = rowGross
    }
    if (current.cbm == null) {
      const rowCbm = parseNumber(row[9])
      if (plausibleCbm(rowCbm) && !/^cbm$/i.test(str(row[9]))) current.cbm = rowCbm
    }

    const iso = extractIsoId(c0)
    if (iso && !current.id) {
      current.id = iso
      collectingSeals = false
    } else if ((collectingSeals || current.id) && isSealToken(c0) && !iso) {
      current.seals.push(...sealTokens(c0))
      collectingSeals = true
    }

    const descCell = str(row[5] || row[4])
    if (/net weight/i.test(descCell)) {
      const n = parseNumber(descCell)
      if (plausibleNet(n)) current.netKg = n
    } else if (
      descCell
      && /cocoa|bags|beans|grado|grade|cajas|boxes|atun|tuna|lomitos|latas/i.test(descCell)
      && !/^marca:|^p\.a\s*:/i.test(descCell)
    ) {
      if (!current.description || !current.description.includes(descCell)) {
        current.description = current.description
          ? `${current.description} ${descCell}`
          : descCell
      }
      const weights = knKb(descCell)
      if (current.netKg == null && weights.netKg != null) current.netKg = weights.netKg
      if (current.grossKg == null && weights.grossKg != null) current.grossKg = weights.grossKg
    }
  }
  flush()

  const known = containers.reduce((sum, c) => sum + (c.cbm || 0), 0)
  const missing = containers.filter((c) => c.cbm == null)
  if (missing.length === 1 && totalRowCbm != null) {
    missing[0].cbm = known > 0 && totalRowCbm > known + 10 ? totalRowCbm - known : totalRowCbm
  }
  const withCbm = containers.filter((c) => c.cbm != null)
  if (withCbm.length === 1 && containers.length > 1) {
    const v = withCbm[0].cbm
    if (v > 0 && v <= 80) containers.forEach((c) => { if (c.cbm == null) c.cbm = v })
  }
  return containers
}

function parseLooseIsoContainers(grid, startRow, endRow) {
  const containers = []
  for (let r = startRow; r < endRow; r += 1) {
    const row = grid[r] || []
    const c0 = str(row[0])
    if (/^marks$/i.test(c0) || /total bags/i.test(c0)) break
    const iso = extractIsoId(c0)
    if (!iso) continue
    const descCell = str(row[5] || row[4])
    const nextDesc = str((grid[r + 1] || [])[5] || (grid[r + 1] || [])[4])
    const weights = knKb(`${descCell} ${nextDesc}`)
    const seals = []
    for (let k = r + 1; k < Math.min(endRow, r + 7); k += 1) {
      const s = str(grid[k]?.[0])
      if (!s) continue
      if (ISO_RE.test(s.toUpperCase())) break
      if (/^marks$/i.test(s) || /total bags/i.test(s)) break
      if (isSealToken(s)) seals.push(...sealTokens(s))
    }
    const rowGross = parseNumber(row[8])
    const rowCbm = parseNumber(row[9])
    const rowPkgs = parseNumber(row[3])
    containers.push({
      id: iso,
      seal: seals.join(', '),
      pkgs: pickPkgs(rowPkgs, `${descCell} ${nextDesc}`),
      description: /cocoa|bags|beans|grado|grade/i.test(descCell) ? descCell : '',
      netKg: weights.netKg,
      grossKg: plausibleGross(rowGross) ? rowGross : weights.grossKg,
      cbm: plausibleCbm(rowCbm) ? rowCbm : null,
    })
  }
  return containers
}

function parseContainerTable(grid, startRow, endRow) {
  const containers = []
  let header = -1
  for (let r = startRow; r < endRow; r += 1) {
    const joined = (grid[r] || []).map(str).join(' ')
    if (/contenedor/i.test(joined) && /sellos?/i.test(joined)) {
      header = r
      break
    }
  }
  if (header < 0) return containers

  let sharedDesc = ''
  for (let r = startRow; r < header; r += 1) {
    const d = str(grid[r][4] || grid[r][5])
    if (/cocoa|beans|grado|grade|bags of/i.test(d)) sharedDesc = `${sharedDesc} ${d}`.trim()
  }

  for (let r = header + 1; r < endRow; r += 1) {
    const row = grid[r] || []
    const joined = row.map(str).join(' ')
    const iso = extractIsoId(joined)
    if (!iso) {
      if (containers.length && !str(row[4]) && !str(row[5]) && !str(row[6])) break
      continue
    }
    const pkgs = parseNumber(row[4] || row[3])
    const seal = [str(row[6]), str(row[7])].filter(Boolean).join(', ')
    containers.push({
      id: iso,
      seal,
      pkgs,
      description: sharedDesc,
      netKg: null,
      grossKg: null,
      cbm: null,
    })
  }
  return containers
}

export function parseProformaArrayBuffer(buffer, fileName = '') {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const grid = gridFromSheet(sheet)

  const shipperLbl = findLabel(grid, /shipper/i)
  const consigneeLbl = findLabel(grid, /^consignee\b/i)
  const notifyLbl = findLabel(grid, /notify party/i)
  const unlessLbl = findLabel(grid, /unless provided/i)
  const bookingLbl = findLabel(grid, /booking number/i)
  const blLbl = findLabel(grid, /bill of lading no/i)
  const vesselLbl = findLabel(grid, /^vessel$/i)
  const polLbl = findLabel(grid, /port of loading/i)
  const podLbl = findLabel(grid, /port of discharge/i)
  const marksLbl = findLabel(grid, /marks and/i)
  const totalBagsLbl = findLabel(grid, /total bags/i)
  const secondLbl = findLabel(grid, /2nd notify/i)

  const shipperStop = consigneeLbl?.r ?? unlessLbl?.r ?? notifyLbl?.r
  const shipperLines = shipperLbl
    ? collectCol(grid, {
        r0: shipperLbl.r + 1,
        r1: shipperStop,
        c: 0,
        stop: /consignee|unless provided/i,
      })
    : []

  const consigneeStart = consigneeLbl ? consigneeLbl.r + 1 : unlessLbl ? unlessLbl.r + 1 : null
  const consigneeLines = consigneeStart != null
    ? collectCol(grid, {
        r0: consigneeStart,
        r1: notifyLbl?.r,
        c: 0,
        stop: /notify party|contacto|contac:/i,
      })
    : []

  const notifyLines = notifyLbl
    ? collectCol(grid, {
        r0: notifyLbl.r + 1,
        r1: vesselLbl?.r,
        c: 0,
        stop: /initial carriage|^vessel$/i,
      })
    : []

  const bookingNo = bookingLbl ? extractBooking(grid[bookingLbl.r + 1]?.[bookingLbl.c]) : ''
  const blNo = blLbl ? str(grid[blLbl.r + 1]?.[blLbl.c]) : ''

  const vesselRaw = vesselLbl ? str(grid[vesselLbl.r + 1]?.[vesselLbl.c]) : ''
  const voyCell = vesselLbl ? str(grid[vesselLbl.r + 1]?.[2]) : ''
  const split = splitVesselVoyagePort(vesselRaw)
  const vessel = split.vessel
  const voyage = voyCell || split.voyage
  const portLoading = polLbl ? str(grid[polLbl.r + 1]?.[polLbl.c]) : split.portLoading
  const portDischarge = podLbl
    ? str(grid[podLbl.r + 1]?.[podLbl.c]) || str(grid[podLbl.r + 1]?.[3])
    : ''

  const cargoEnd = secondLbl?.r ?? totalBagsLbl?.r ?? grid.length
  const cargoStart = marksLbl ? marksLbl.r + 2 : 0
  let containers = marksLbl ? parseContainers(grid, cargoStart, cargoEnd) : []
  if (!containers.length && marksLbl) {
    containers = parseContainerTable(grid, cargoStart, grid.length)
  }
  if (!containers.length && marksLbl) {
    containers = parseLooseIsoContainers(grid, cargoStart, grid.length)
  }

  const allCbm = containers.reduce((sum, c) => sum + (c.cbm || 0), 0)

  const pickPrefixed = (re) => {
    const hit = findLabel(grid, re)
    if (!hit) return ''
    const raw = str(grid[hit.r][hit.c])
    const after = raw.split(/[:#]/).slice(1).join(':').trim()
    if (after) return after.replace(/^[:#\s]+/, '')
    const neighbor = str(grid[hit.r][hit.c + 1] || grid[hit.r][6])
    if (neighbor) return neighbor
    const num = raw.match(/([A-Z0-9._-]*\d[A-Z0-9._-]*)/i)
    return num ? num[1] : ''
  }

  const totalBags = totalBagsLbl
    ? parseNumber(grid[totalBagsLbl.r][totalBagsLbl.c + 1] ?? grid[totalBagsLbl.r][6])
      || parseNumber(grid[totalBagsLbl.r][totalBagsLbl.c])
    : containers.reduce((s, c) => s + (c.pkgs || 0), 0)
  const netLbl = findLabel(grid, /total net weight|peso neto total/i)
  const grossLbl = findLabel(grid, /total gross weight|peso bruto total/i)

  const marks = []
  if (marksLbl) {
    for (let r = cargoStart; r < Math.min(grid.length, cargoEnd + 16); r += 1) {
      const s = str(grid[r][0])
      if (!s) continue
      if (/^(contenedor|container|sellos?|marcas):?/i.test(s)) continue
      if (/^naviera:|^shipper:|^p\.a\s*:/i.test(s)) continue
      if (ISO_RE.test(s.toUpperCase())) continue
      if (isSealToken(s) && s.length <= 14) continue
      if (/^sps\d/i.test(s)) continue
      const cleaned = s.replace(/^sps\s+/i, '').trim()
      if (!cleaned) continue
      if (/^b\/l to be|ocean freight|freight rates/i.test(cleaned)) break
      marks.push(cleaned)
    }
    for (let r = cargoStart; r < Math.min(grid.length, cargoEnd + 16); r += 1) {
      for (const cell of grid[r] || []) {
        const s = str(cell)
        if (/^marca:\s*/i.test(s) && !marks.some((m) => /marca:/i.test(m))) marks.push(s)
      }
    }
  }

  const loteLbl = findLabel(grid, /\blote#?\b/i)
  let lote = ''
  if (loteLbl) {
    const raw = str(grid[loteLbl.r][loteLbl.c])
    const after = raw.replace(/^.*?lote#?\s*/i, '').trim()
    lote = after || str(grid[loteLbl.r][loteLbl.c + 1] || grid[loteLbl.r][6])
  }
  if (!lote) lote = marks.find((l) => /lote/i.test(l)) || ''
  const secondLines = []
  if (secondLbl) {
    secondLines.push(str(grid[secondLbl.r][secondLbl.c]).replace(/^2nd notify:\s*/i, ''))
    for (let r = secondLbl.r + 1; r < Math.min(grid.length, secondLbl.r + 6); r += 1) {
      const s = str(grid[r][secondLbl.c])
      if (!s) break
      if (/b\/l to be|ocean freight|as carrier/i.test(s)) break
      secondLines.push(s)
    }
  }

  const netFromLabel = netLbl
    ? parseNumber(grid[netLbl.r][netLbl.c + 1] ?? grid[netLbl.r][6]) || parseNumber(grid[netLbl.r][netLbl.c])
    : null
  const grossFromLabel = grossLbl
    ? parseNumber(grid[grossLbl.r][grossLbl.c + 1] ?? grid[grossLbl.r][6]) || parseNumber(grid[grossLbl.r][grossLbl.c])
    : null
  const sumNet = containers.reduce((s, c) => s + (c.netKg || 0), 0)
  const sumGross = containers.reduce((s, c) => s + (c.grossKg || 0), 0)

  return {
    kind: 'proforma',
    fileName,
    shipper: splitParty(shipperLines),
    bookingNo,
    blNo,
    consignee: splitParty(consigneeLines),
    notify: splitParty(notifyLines),
    secondNotify: splitParty(secondLines.filter(Boolean)),
    vessel,
    voyage,
    portLoading,
    portDischarge,
    containers,
    marks: {
      text: marks.join('\n'),
      lote: lote.replace(/lote#?\s*/i, ''),
      lines: marks,
    },
    totals: {
      bags: totalBags,
      netKg: saneTotal(netFromLabel, sumNet),
      grossKg: saneTotal(grossFromLabel, sumGross),
      cbm: allCbm || null,
    },
    refs: {
      hsCode: pickPrefixed(/hs code/i) || pickPrefixed(/\bp\.?\s*a\.?\s*:/i),
      fda: pickPrefixed(/fda/i),
      dae: pickPrefixed(/dae|d\.a\.e/i),
      contract: pickPrefixed(/contract|contrato/i) || pickPrefixed(/\bco\.\s*p/i),
    },
    extras: {
      ruc: splitParty(shipperLines).ruc,
    },
  }
}
