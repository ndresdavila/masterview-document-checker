import {
  str,
  parseNumber,
  ISO_RE,
  VOYAGE_RE,
  BL_RE,
  splitVesselVoyagePort,
  findVoyage,
  extractBooking,
  extractIsoId,
  sealTokens,
  canon,
} from './normalize.js'

function groupLines(words, yTol = 5) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  for (const w of sorted) {
    const t = str(w.str)
    if (!t) continue
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - w.y) <= yTol) last.words.push(w)
    else lines.push({ y: w.y, words: [w] })
  }
  return lines.map((l) => ({
    y: l.y,
    x: Math.min(...l.words.map((w) => w.x)),
    text: l.words
      .sort((a, b) => a.x - b.x)
      .map((w) => str(w.str))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }))
}

function inBox(w, box) {
  return w.x >= box.x0 && w.x < box.x1 && w.y >= box.y0 && w.y < box.y1
}

function textIn(words, box) {
  return groupLines(words.filter((w) => inBox(w, box)))
    .map((l) => l.text)
    .filter(Boolean)
}

function stripBoiler(line) {
  return str(line)
    .replace(/your cargo,?\s*our commitment/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dropLeadingContacts(lines) {
  const out = [...lines]
  while (out.length && (/@/.test(out[0]) || /^(email|tel|telefono|contacto):/i.test(out[0]))) {
    out.shift()
  }
  return out
}

function startOfParty(lines) {
  const idx = lines.findIndex((l) => /llc|inc\.?|s\.a|logistics|company|solutions|international/i.test(l) && !/^(email|tel|office|contact|contacto):/i.test(l))
  return idx > 0 ? lines.slice(idx) : lines
}

function splitParty(lines) {
  const clean = lines
    .map((l) => str(l).replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((l) => !/copy non-negotiable|continued from reverse|combined transport/i.test(l))
  return {
    name: clean[0] || '',
    address: clean.slice(1).join('\n'),
    lines: clean,
  }
}

function captureAfter(text, re, stopRe) {
  const m = text.match(re)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const stop = rest.search(stopRe)
  return str(stop >= 0 ? rest.slice(0, stop) : rest)
}

function pickPortFromBlock(block, kind = 'loading') {
  const city = kind === 'discharge'
    ? /buenaventura|colombia|new york|united states|\busa\b|philadelphia|oakland|hamburg|rotterdam|savannah|halifax/i
    : /guayaquil|posorja|ecuador|manta/i
  const lines = str(block)
    .split(/\r?\n/)
    .map((l) => str(l).replace(/\s+/g, ' '))
    .filter(Boolean)
  for (const line of lines) {
    if (!city.test(line)) continue
    if (kind === 'discharge' && findVoyage(line) && !city.test(line)) continue
    if (kind === 'loading' && /port of discharge/i.test(line) && !/guayaquil|posorja|manta/i.test(line)) continue
    const cleaned = line
      .replace(/port of loading:?/gi, ' ')
      .replace(/port of discharge:?/gi, ' ')
      .replace(/place of (receipt|delivery):?\s*\*?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned || !city.test(cleaned)) continue
    if (kind === 'loading') {
      const named = cleaned.match(/\b((?:GUAYAQUIL|POSORJA|MANTA)(?:\s*[,.-]\s*ECUADOR)?)\b/i)
      if (named) return named[1].replace(/\s+/g, ' ').trim()
    } else {
      const named = cleaned.match(/\b((?:BUENAVENTURA)(?:\s*[,.-]\s*COLOMBIA)?|(?:NEW YORK)(?:\s*[,.-]\s*(?:UNITED STATES|USA|US))?|(?:SAVANNAH)(?:\s*[,.-]\s*(?:UNITED STATES|USA|GA))?|(?:PHILADELPHIA|OAKLAND|HAMBURG|ROTTERDAM)(?:\s*[,.-]\s*(?:UNITED STATES|USA|COLOMBIA|GERMANY|NETHERLANDS))?)\b/i)
      if (named) return named[1].replace(/\s+/g, ' ').trim()
    }
    return cleaned
  }
  return ''
}

function extractPort(text, startRe, stopRe, kind = 'loading') {
  const m = text.match(startRe)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const stop = rest.search(stopRe)
  const window = str(stop >= 0 ? rest.slice(0, Math.max(stop, 280)) : rest.slice(0, 280))
  return pickPortFromBlock(window, kind)
}

function parseLabeledRefs(text) {
  const hs = text.match(/HS\s*CODE\s*:?\s*([0-9.]+)/i)?.[1]
    || text.match(/P\.A\s*:\s*([0-9.]+)/i)?.[1]
    || ''
  const fda =
    text.match(/FDA\.?\s*REG\.?\s*#\s*([0-9]+)/i)?.[1]
    || text.match(/FDA\s*NR\s*([0-9]+)/i)?.[1]
    || text.match(/FDA(?:\s*NUMBER)?\s*:?\s*([0-9]{8,})/i)?.[1]
    || ''
  const dae = (text.match(/D\.?A\.?E\.?:?\s*#?\s*['"]?([0-9][0-9\s-]{10,}[0-9])/i)?.[1] || '').replace(/\s+/g, '')
  let contract = text.match(/CONTRATO:\s*([A-Z0-9._-]+)/i)?.[1]
    || text.match(/CONTRACT#:\s*([A-Z0-9._-]+(?:\s+[A-Z]\b)?)/i)?.[1]
    || ''
  if (/^(FREIGHT|SHIPPED|COLLECT|PREPAID|EXPRESS)$/i.test(contract)) contract = ''
  return { hsCode: hs, fda, dae, contract }
}

function knKb(text) {
  const raw = str(text)
  const nets = [...raw.matchAll(/([\d.,]+)\s*(?:K\.?\s*N|N\.?\s*W|KG\s*NET)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000)
  const grosses = [...raw.matchAll(/([\d.,]+)\s*(?:K\.?\s*B|G\.?\s*W|KG\s*GROSS)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000)
  return {
    netKg: nets.length ? nets[nets.length - 1] : null,
    grossKg: grosses.length ? grosses[grosses.length - 1] : null,
  }
}

function parseBoxedGoodsBlocks(text) {
  const descRe = /(?:LOMITOS DE AT[UÚ]N|RALLADO DE AT[UÚ]N|CONSERVAS DE[\s\S]{0,40}?PESCADO)[\s\S]{0,220}?(?=LOMITOS DE AT[UÚ]N|RALLADO DE AT[UÚ]N|CONSERVAS DE|TOTAL CAJAS|PESO NETO|FREIGHT COLLECT|$)/gi
  const descs = [...text.matchAll(descRe)]
    .map((m) => m[0]
      .replace(/\bMARCA:[\s\S]*/i, ' ')
      .replace(/\bP\.A\s*:[\s\S]*/i, ' ')
      .replace(/\bSELLOS?:[\s\S]*/i, ' ')
      .replace(/\bCONTENEDOR:[\s\S]*/i, ' ')
      .replace(/\bONE[A-Z]\s*\d[\s\S]*/i, ' ')
      .replace(/\d{1,2}[.,]\d{3}[.,]\d{2}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
  const cargoHead = text.split(/TOTAL CAJAS|TOTAL PACKAGES|PESO NETO TOTAL|TOTAL PESO NETO|TOTAL NET WEIGHT|PESO BRUTO TOTAL|TOTAL GROSS/i)[0]
  const boxHits = [...cargoHead.matchAll(/(\d{3,4})\s+(?:BOXES|CAJAS|LOMITOS|CONSERVAS|RALLADO)\b/gi)]
  const boxes = boxHits
    .filter((m) => {
      const before = cargoHead.slice(Math.max(0, m.index - 12), m.index).replace(/\s+/g, '')
      return !/[A-Z]{3,4}\d+$/i.test(before)
    })
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 100 && n <= 5000)
  const grosses = []
  for (const m of text.matchAll(/(\d{1,2}[.,]\d{3}[.,]\d{2}|\d{4,5}\.\d{2})(?:\s*KGS?)?/gi)) {
    const n = parseNumber(m[1])
    if (n == null || n <= 8000 || n >= 32000) continue
    const lineStart = text.lastIndexOf('\n', m.index)
    const lineEnd = text.indexOf('\n', m.index)
    const line = text.slice(lineStart + 1, lineEnd < 0 ? text.length : lineEnd)
    if (/PESO NETO|NET WEIGHT|TOTAL PESO NETO|TOTAL NET/i.test(line) && !/GROSS/i.test(line)) continue
    grosses.push(n)
  }
  const count = Math.max(descs.length, boxes.length)
  if (!count) return []
  return Array.from({ length: count }, (_, i) => ({
    pkgs: boxes[i] ?? null,
    description: descs[i] ?? '',
    netKg: null,
    grossKg: grosses[i] ?? null,
  }))
}

function parseCargoBlocks(text) {
  const upper = text.toUpperCase()
  const boxed = parseBoxedGoodsBlocks(upper)
  if (boxed.length) return boxed
  const blocks = []
  const re = /(\d+)\s+(?:BAGS OF|BAGS\b|BOXES|PACKAGES(?:\s+BULKS)?\s+OF|CAJAS DE)\b[\s\S]{0,420}?(?=\d+\s+(?:BAGS OF|BAGS\b|BOXES|PACKAGES(?:\s+BULKS)?\s+OF|CAJAS DE)|TOTAL BAGS|TOTAL CAJAS|TOTAL PACKAGES|HS CODE|FREIGHT COLLECT|$)/g
  let m
  while ((m = re.exec(upper))) {
    const chunk = m[0]
    if (/TOTAL BAGS/.test(chunk) && !/BAGS OF/.test(chunk)) continue
    const pkgs = parseNumber(m[1])
    const isLoose = /\b(?:BOXES|PACKAGES OF|PACKAGES\b|CAJAS DE)\b/.test(chunk) && !/BAGS(?:\s+OF)?/.test(chunk)
    if (pkgs != null && pkgs > 800 && !isLoose) continue
    if (pkgs != null && pkgs > 5000) continue
    const weights = knKb(chunk)
    if (weights.netKg != null && weights.netKg > 40000) continue
    const grado = chunk.match(/TYPE GRADO\s+\d|TYPE GRADE\s+\d(?:\s+RFA)?|GRADE\s+\d(?:\s+RFA)?/)?.[0] || ''
    const bagsLine = chunk.match(/BAGS OF[\s\S]{0,90}?(?:BEANS|ARABICA|COFFEE)/)?.[0]
      || chunk.match(/PACKAGES(?:\s+BULKS)?\s+OF(?:\s+WELL-POLISHED)?\s+WHITE\s+RICE(?:\s+SYLVIA\s+MARIA|\s+SULTAN\s+MACARE[NÑ]O)?(?:\s+OF\s+\d+\s+KILOS?)?/i)?.[0]
      || chunk.match(/(?:LOMITOS|RALLADO|ATUN|CONSERVAS)[\s\S]{0,90}?LATAS/)?.[0]
      || chunk.match(/CAJAS DE[\s\S]{0,80}?PESCADO/)?.[0]
      || chunk.match(/OF\s+G\d[\s\S]{0,60}?BEANS/)?.[0]
      || chunk.match(/ECUADOR COCOA BEANS[\s\S]{0,40}/)?.[0]
      || ''
    const labeledGross = parseNumber(chunk.match(/GROSS WEIGHT:\s*([\d.,]+)/i)?.[1])
      ?? parseNumber(chunk.match(/([\d.,]+)\s+GROSS WEIGHT/i)?.[1])
    const labeledNet = parseNumber(chunk.match(/NET WEIGHT:\s*([\d.,]+)/i)?.[1])
      ?? parseNumber(chunk.match(/([\d.,]+)\s+NET WEIGHT/i)?.[1])
    const netKg = labeledNet != null && (labeledNet < 1000 || labeledNet > 40000) ? null : labeledNet
    blocks.push({
      pkgs: parseNumber(m[1]),
      description: [bagsLine, grado].filter(Boolean).join(' ').replace(/\bAGROSYLMA\b/gi, ' ').replace(/\s+/g, ' ').trim(),
      netKg,
      grossKg: labeledGross != null && (labeledGross < 1000 || labeledGross > 40000) ? weights.grossKg : (labeledGross ?? weights.grossKg),
    })
  }
  return blocks
}

function parseContainersFromText(text) {
  const upper = text.toUpperCase()
  const chunks = upper.split(/(?:CONTAINER|CONTENEDOR):\s*/)
  const containers = []
  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const id = extractIsoId(chunk) || chunk.match(/^([A-Z]{3,4}\d{6,8})\b/)?.[1]
    if (!id) continue
    const afterId = chunk.slice(chunk.toUpperCase().indexOf(id) + id.length)
    const sealZone = afterId.split(/BAGS OF|MARCAS|TOTAL BAGS|CONTAINER|CONTENEDOR/)[0]
    const seals = sealTokens(sealZone.replace(/^\s*(SEALS?|SELLOS?):?\s*/i, ''))
    const beforeTotal = afterId.split(/TOTAL BAGS|TOTAL PACKAGES/)[0]
    const bagHitsNear = [...beforeTotal.matchAll(/(\d{3,4})\s+BAGS\b/gi)]
      .map((m) => parseNumber(m[1]))
      .filter((n) => n != null && n >= 100 && n < 700)
    const hasBagsOf = /BAGS OF/i.test(beforeTotal)
    const pkgsNear = hasBagsOf ? null : (bagHitsNear[0] ?? null)
    containers.push({
      id,
      seal: seals.join(', '),
      pkgs: pkgsNear != null && pkgsNear >= 100 && pkgsNear < 800 ? pkgsNear : null,
      description: '',
      netKg: null,
      grossKg: null,
      cbm: null,
    })
  }

  if (!containers.length) {
    const cargo = upper.split(/MARKS AND NUMBERS|PARTICULARS FURNISHED/i).slice(-1)[0] || upper
    const seen = new Set()
    const hits = [...cargo.matchAll(/([A-Z]{4}\d{7})(?:\s*SEALS?:)?/g)]
    for (const m of hits) {
      const id = m[1]
      if (seen.has(id)) continue
      seen.add(id)
      const from = m.index + m[0].length
      const next = hits.find((x) => x.index > m.index && x[1] !== id)
      const zone = cargo.slice(from, next ? next.index : from + 220)
      const seals = sealTokens(zone.replace(/^\s*(SEALS?|SELLOS?):?\s*/i, '').split(/BAGS|MARKS|TOTAL|CONTAINER/)[0])
      containers.push({
        id,
        seal: seals.join(', '),
        pkgs: null,
        description: '',
        netKg: null,
        grossKg: null,
        cbm: null,
      })
    }
  }

  const blocks = parseCargoBlocks(upper)
  const cargoBlocks = (() => {
    if (containers.length <= 1) return blocks
    const per = blocks.filter((b) => b.pkgs != null && b.pkgs >= 100 && b.pkgs < 500)
    return per.length === containers.length ? per : blocks
  })()
  if (containers.length === 1 && cargoBlocks.length > 1 && containers[0].pkgs == null) {
    const sku = cargoBlocks.filter((b) => b.pkgs != null)
    const distinct = new Set(sku.map((b) => `${b.pkgs}|${str(b.description)}`)).size
    if (sku.length > 1 && distinct > 1) {
      containers[0].pkgs = sku.reduce((s, b) => s + b.pkgs, 0)
      containers[0].description = sku.map((b) => b.description).filter(Boolean).join(' ')
    } else {
      const best = cargoBlocks.reduce((a, b) => ((b.pkgs || 0) > (a.pkgs || 0) ? b : a))
      containers[0].pkgs = best.pkgs
      containers[0].description = best.description
      containers[0].netKg = best.netKg
      containers[0].grossKg = best.grossKg
    }
  } else {
    const n = Math.min(containers.length, cargoBlocks.length)
    for (let i = 0; i < n; i += 1) {
      if (containers[i].pkgs == null) containers[i].pkgs = cargoBlocks[i].pkgs
      if (!containers[i].description) containers[i].description = cargoBlocks[i].description
      if (containers[i].netKg == null) containers[i].netKg = cargoBlocks[i].netKg
      if (containers[i].grossKg == null) containers[i].grossKg = cargoBlocks[i].grossKg
    }
  }
  const complete = containers.filter((c) => c.pkgs != null)
  const missingCargo = containers.filter((c) => c.pkgs == null)
  const boxCounts = [...upper.matchAll(/(\d+)\s+BOXES\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n <= 5000)
  const sameBoxes = new Set(boxCounts).size <= 1
  if (missingCargo.length && complete.length && sameBoxes && complete.every((c) => c.pkgs === complete[0].pkgs)) {
    missingCargo.forEach((c) => {
      c.pkgs = complete[0].pkgs
      c.description = c.description || complete[0].description
      c.netKg = c.netKg ?? complete[0].netKg
      c.grossKg = c.grossKg ?? complete[0].grossKg
    })
  }
  const kns = [...upper.matchAll(/([\d.,]+)\s*(?:K\.?\s*N|N\.?\s*W|KG\s*NET)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  if (kns.length === containers.length) {
    containers.forEach((c, i) => { if (c.netKg == null) c.netKg = kns[i] })
  }
  const kbs = [...upper.matchAll(/([\d.,]+)\s*(?:K\.?\s*B|G\.?\s*W|KG\s*GROSS)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  if (kbs.length === containers.length) {
    containers.forEach((c, i) => { if (c.grossKg == null) c.grossKg = kbs[i] })
  }
  const bagHits = [...upper.matchAll(/(\d{3,4})\s+BAGS\b/gi)]
    .filter((m) => !/TOTAL\s*$/i.test(upper.slice(Math.max(0, m.index - 12), m.index)))
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 100 && n < 800)
  if (bagHits.length === containers.length) {
    containers.forEach((c, i) => { if (c.pkgs == null) c.pkgs = bagHits[i] })
  }
  return containers
}

function parseHblFromPlainText(text, fileName) {
  const t = text.replace(/\u00a0/g, ' ')
  const bookingNo = extractBooking(t)
  const blNo = t.toUpperCase().match(/\b(ULGO\d{2}[A-Z]{2}\d{5,})\b/)?.[1]
    || t.toUpperCase().match(/\b(ONEY[A-Z0-9]{10,})\b/)?.[1]
    || t.toUpperCase().match(BL_RE)?.[1]
    || (/^ZIMU|^GYEG|^ONEY/i.test(bookingNo) ? bookingNo : '')

  const shipperBlock = captureAfter(
    t,
    /Shipper[\s\S]{0,40}?/i,
    /\bConsignee\b/i,
  )
  const shipperLines = shipperBlock
    .split(/\r?\n/)
    .map(str)
    .filter((l) => l && !/booking\s*number|bill of lading|continued from|combined transport|principal or seller|export references|^contact:?$|^fda\s*:/i.test(l) && l !== bookingNo && l !== blNo)
    .filter((l) => !/^\d{10,}$/.test(l))
    .filter((l) => !/copy non-negotiable/i.test(l))

  const ruc = t.match(/R\.?U\.?C\.?\s*:?\s*([0-9]{10,13})/i)?.[1] || ''
  const shipper = splitParty(startOfParty(shipperLines.filter((l) => !/^R\.?U\.?C\.?/i.test(l))))
  shipper.ruc = ruc

  const consignee = splitParty(
    captureAfter(t, /\bConsignee\b/i, /\bNotify Party\b/i)
      .split(/\r?\n/)
      .map(stripBoiler)
      .filter((l) => l && !/unless provided|non-negotiable unless|forward agent|^contact:?$/i.test(l)),
  )

  const notify = splitParty(
    startOfParty(
      captureAfter(t, /\bNotify Party\b/i, /\bSecond Notify:?|\bThird Notify:?|\bPre-Carriage|\bVessel\b|\bInitial Carriage/i)
        .split(/\r?\n/)
        .map(str)
        .filter((l) => l && !/intermediate consignee|name and full address|^notify party\b|^contact:?$/i.test(l)),
    ),
  )

  const secondNotify = splitParty(
    captureAfter(t, /\bSecond Notify:?/i, /\bPre-Carriage|\bVessel\b|\bNotify Party\b|\bThird Notify|\bInitial Carriage/i)
      .split(/\r?\n/)
      .map(stripBoiler)
      .filter((l) => l && !/intermediate consignee|name and full address|^contact:?$/i.test(l)),
  )

  const vesselLine = t
    .split(/\r?\n/)
    .map(str)
    .find((l) => findVoyage(l) && /GUAYAQUIL|NIKE|CMA|MAERSK|MSC|HAPAG|COSCO|EVERGREEN|HSL|FELICIA|ENDURANCE|OCEANA|SIROCCO|CONTSHIP|JOHN|MARTI/i.test(l))
    || t.split(/\r?\n/).map(str).find((l) => findVoyage(l))
    || ''

  const split = splitVesselVoyagePort(vesselLine)
  const vessel = split.vessel
  const polFromLabel = extractPort(t, /Port of Loading/i, /Port of Discharge|Place of Delivery|Marks &/i, 'loading')
    || pickPortFromBlock(captureAfter(t, /Place of Receipt/i, /Vessel|Port of Loading|Port of Discharge/i), 'loading')
  const portLoading = polFromLabel || split.portLoading || ''
  const voyage = split.voyage || t.toUpperCase().match(VOYAGE_RE)?.[1] || ''

  const portDischarge =
    extractPort(t, /Port of Discharge/i, /Place of Delivery|Marks &|CONTAINER:/i, 'discharge')
    || (t.match(/BUENAVENTURA[, ]+COLOMBIA/i)?.[0] ?? '')
    || (t.match(/NEW YORK,\s*UNITED STATES/i)?.[0] ?? '')
    || (t.match(/PHILADELPHIA/i)?.[0] ?? '')

  const lote = t.match(/LOTE#?\s*([A-Z0-9-]+)/i)?.[1] || ''
  const lastBrandMarks = (() => {
    const re = /(GLOBAL-COCOA|ECO-KAKAO|BURNEOEXPORT|K'?MEN|AGROARRIBA|JOHANSACORP|SAN GERARDO|OSELLA|GRANDSOUTH|AROMATIC|MOI FOODS|EXPORCAFE|MAQUITA|FUNDACION|NIRSA|SUDESPENSA)[\s\S]{0,200}(?:LOTE|LOT\s*N)[^\n]{0,40}/gi
    const all = [...t.matchAll(re)]
    return all.length ? all[all.length - 1][0] : ''
  })()
  const marksMatch = t.match(/MARCAS:?\s*([\s\S]{0,220}?)(?=\d+\s+BAGS|TOTAL BAGS|HS CODE|FREIGHT COLLECT|$)/i)
  const marcaLine = t.match(/MARCA:\s*[A-Z0-9 ./-]+/i)?.[0] || ''
  const marksRaw = (lastBrandMarks || marksMatch?.[0] || marcaLine).split(/TOTAL BAGS|TOTAL CAJAS|TOTAL NET|HS CODE|FREIGHT COLLECT|\d+\s+BAGS\b/i)[0]
  const totalsBags = parseNumber(t.match(/TOTAL BAGS\s*:?\s*([\d,]+)/i)?.[1])
    || parseNumber(t.match(/TOTAL CAJAS:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/TOTAL PACKAGES:\s*([\d,]+)/i)?.[1])
    || parseNumber(t.match(/(\d+)\s+BAGS\s+\d+X40/i)?.[1])
  const pickLargeWeight = (labeledRe, genericRe) => {
    const labeled = parseNumber(t.match(labeledRe)?.[1])
    if (labeled != null) return labeled
    const all = [...t.matchAll(genericRe)].map((m) => parseNumber(m[1] || m[2])).filter((n) => n != null)
    const large = all.filter((n) => n > 40000)
    return large.length ? large[large.length - 1] : null
  }
  const lastLargeKn = [...t.matchAll(/([\d.,]+)\s*K\.?\s*N/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n > 40000)
    .pop()
  const lastLargeKb = [...t.matchAll(/([\d.,]+)\s*K\.?\s*B/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n > 40000)
    .pop()
  const lastGrossLabeled = [...t.matchAll(/GROSS WEIGHT:\s*([\d,]+\.?\d*)/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n > 40000)
    .pop()
  const kgBesideCbm = parseNumber(t.match(/([\d,]+\.?\d*)\s*KG\s+[\d,]+\.?\d*\s*CBM/i)?.[1])
  const totalNet = pickLargeWeight(
    /TOTAL NET WEIGHT:?\s*([\d,]+\.?\d*)/i,
    /N(?:ET)?\s*W(?:EIGHT)?:?\s*([\d,]+\.?\d*)/gi,
  ) || parseNumber(t.match(/PESO NETO TOTAL:\s*([\d.,]+)/i)?.[1]) || lastLargeKn
  let totalGross = pickLargeWeight(
    /TOTAL GROSS WEIGHT:?\s*([\d,]+\.?\d*)/i,
    /GROSS WEIGHT:\s*([\d,]+\.?\d*)/gi,
  ) || lastGrossLabeled
    || (kgBesideCbm != null && kgBesideCbm > 40000 ? kgBesideCbm : null)
    || parseNumber(t.match(/PESO BRUTO TOTAL:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/TOTAL PESO BRUTO:\s*([\d.,]+)/i)?.[1])
    || [...t.matchAll(/([\d.,]+)\s+GROSS WEIGHT/gi)].map((m) => parseNumber(m[1])).filter((n) => n != null && n > 10000).pop()
    || lastLargeKb
  if (totalNet != null && totalGross != null && totalGross > totalNet * 3) {
    const labeled = parseNumber(t.match(/TOTAL GROSS WEIGHT:?\s*([\d.,]+)/i)?.[1])
    totalGross = labeled != null && labeled <= totalNet * 3 ? labeled : null
  }
  const totalMeas = parseNumber(t.match(/TOTAL MEASUREMENT:?\s*([\d,]+\.?\d*)\s*CBM/i)?.[1])
  const cbmHits = [...t.matchAll(/([\d,]+\.?\d*)\s*CBM/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null)
  const cbm = totalMeas
    ?? cbmHits.filter((n) => n > 80).pop()
    ?? (cbmHits.length === 1 ? cbmHits[0] : null)

  const containers = parseContainersFromText(t)
  const sharedDesc = (
    t.match(/\d+\s+BAGS OF[\s\S]{0,90}?(?:BEANS|ARABICA|COFFEE)/i)?.[0]
    || t.match(/G3 ECUADOR COCOA BEANS/i)?.[0]
    || t.match(/ECUADOR COCOA BEANS[\s\S]{0,40}(?:GRADE|GRADO)\s+\d/i)?.[0]
    || ''
  ).replace(/\s+/g, ' ').trim()
  if (sharedDesc) {
    containers.forEach((c) => { if (!c.description) c.description = sharedDesc })
  }

  shipper.lines = (shipper.lines || []).map((l) => l.replace(/\bFDA\s*:?\s*\d+/gi, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  shipper.address = (shipper.address || '').replace(/\bFDA\s*:?\s*\d+/gi, '').replace(/\s+/g, ' ').trim()
  if (shipper.lines[0]) shipper.name = shipper.lines[0]

  return {
    kind: 'hbl',
    fileName,
    shipper,
    bookingNo,
    blNo,
    consignee,
    notify,
    secondNotify,
    vessel,
    voyage,
    portLoading,
    portDischarge,
    containers,
    marks: {
      text: marksRaw.replace(/\s+/g, '\n'),
      lote,
      lines: marksRaw.split(/\r?\n/).map(str).filter(Boolean),
    },
    totals: {
      bags: totalsBags,
      netKg: totalNet,
      grossKg: totalGross,
      cbm,
    },
    refs: parseLabeledRefs(t),
    extras: {
      ruc,
      freightCollect: /FREIGHT COLLECT/i.test(t),
      shippedOnBoard: /SHIPPED ON BOARD/i.test(t),
      hqLine: t.match(/\d+\s*X\s*\d+\s*(?:ST|HQ|GP|DRY)\b[^\n]{0,80}/i)?.[0]
        || t.match(/\dX40HQ CONTAINERS STC/i)?.[0]
        || '',
    },
  }
}

function labelAt(words, re, maxX = 360) {
  return words.find((w) => re.test(str(w.str)) && w.x < maxX) || null
}

function parseHblFromPdfWords(words, fileName, extraText = '') {
  const W = 596
  const shipperLbl = labelAt(words, /^shipper$/i, 120)
  const consigneeLbl = labelAt(words, /^consignee$/i, 120)
  const notifyLbl = labelAt(words, /^notify party$/i, 160)
  const secondLbl = words.find((w) => /^second notify:?$/i.test(str(w.str))) || null
  const preLbl = words.find((w) => /pre-carriage/i.test(str(w.str))) || null
  const shipperY = shipperLbl?.y ?? 55
  const consigneeY = consigneeLbl?.y ?? 118
  const notifyY = notifyLbl?.y ?? 170
  const partiesBottom = preLbl?.y ?? 235
  const secondX = secondLbl && secondLbl.x > 200 ? secondLbl.x - 8 : 280

  const left = { x0: 0, x1: 285, y0: shipperY, y1: consigneeY - 2 }
  const booking = { x0: 285, x1: 430, y0: 55, y1: 95 }
  const bl = { x0: 430, x1: W, y0: 55, y1: 95 }
  const consigneeBox = { x0: 0, x1: 285, y0: consigneeY, y1: notifyY - 2 }
  const notifyBox = { x0: 0, x1: secondX, y0: notifyY, y1: partiesBottom - 2 }
  const secondBox = { x0: secondX, x1: W, y0: (secondLbl?.y ?? notifyY) - 4, y1: partiesBottom - 2 }
  const podBox = { x0: 290, x1: 430, y0: 250, y1: 300 }
  const descBox = { x0: 175, x1: 430, y0: 315, y1: 560 }
  const weightBox = { x0: 430, x1: W, y0: 315, y1: 360 }
  const useLayoutParties = Boolean(consigneeLbl && notifyLbl)

  const shipperLines = textIn(words, left).filter((l) => !/^shipper$/i.test(l) && !/^consignee$/i.test(l) && !/copy non-negotiable/i.test(l))
  const rucLine = shipperLines.find((l) => /R\.?U\.?C\.?/i.test(l))
  const ruc = rucLine?.match(/R\.?U\.?C\.?\s*:?\s*([0-9]{10,13})/i)?.[1] || ''
  const shipper = splitParty(shipperLines.filter((l) => !/^R\.?U\.?C\.?/i.test(l) && !/^shipper$/i.test(l)))
  shipper.ruc = ruc

  const bookingNo = extractBooking(textIn(words, booking).join(' '))
  const blNo = textIn(words, bl).join(' ').toUpperCase().match(BL_RE)?.[1] || ''
  const consignee = splitParty(
    dropLeadingContacts(textIn(words, consigneeBox).filter((l) => !/^consignee$/i.test(l) && !/unless provided/i.test(l))),
  )
  const notify = splitParty(startOfParty(textIn(words, notifyBox).filter((l) => !/^notify party$/i.test(l) && !/your cargo/i.test(l))))
  const secondNotify = splitParty(
    textIn(words, secondBox).filter((l) => !/^second notify:?$/i.test(l) && !/your cargo/i.test(l)),
  )

  const vesselHeader = words.find((w) => /^vessel$/i.test(w.str))
  let vessel = ''
  let voyage = ''
  let portLoading = ''
  if (vesselHeader) {
    const row = words.filter(
      (w) => w.y > vesselHeader.y + 6 && w.y < vesselHeader.y + 28 && w.x < 300,
    )
    const line = row
      .sort((a, b) => a.x - b.x)
      .map((w) => str(w.str))
      .filter(Boolean)
      .join(' ')
    const split = splitVesselVoyagePort(line)
    vessel = split.vessel
    voyage = split.voyage
    portLoading = split.portLoading
  }
  const portDischarge = textIn(words, podBox)
    .filter((l) => !/port of discharge|place of delivery/i.test(l))
    .join(' ')

  const descText = textIn(words, descBox).join('\n')
  const leftCargo = textIn(words, { x0: 0, x1: 178, y0: 300, y1: 700 }).join('\n')
  const rawMarks = textIn(words, { x0: 0, x1: 178, y0: 360, y1: 700 })
  const marksStart = rawMarks.findIndex((l) => {
    if (/^(container|contenedor|seals?|sellos?):/i.test(l)) return false
    if (ISO_RE.test(String(l).toUpperCase())) return false
    if (sealTokens(l).length && !/lote|cocoa|product|marcas/i.test(l)) return false
    return /lote|lot n|marcas|cocoa|beans|product of|ecuador|grado|grade|usa|global|kakao|burneo|agro|intikaw|gerardo|k.?men|johansa|osella|sudespensa|dexicon|aromatic|moi foods|aromaexco|expocafe|maquita|nirsa/i.test(l)
  })
  const marksLines = (marksStart >= 0 ? rawMarks.slice(marksStart) : []).filter((l) => {
    if (/marks|containers nos|shipper/i.test(l)) return false
    if (/^(container|contenedor|seals?|sellos?):/i.test(l)) return false
    if (/^[A-Z]{4}\d{7}$/i.test(l)) return false
    if (/x40hq/i.test(l)) return false
    if (/if no value|declared liability|clause \d|received by carrier|freight payable|shippers declared|in witness|place and date of issue|freight\s*&\s*charges|your cargo/i.test(l)) return false
    if (sealTokens(l).length && !/lote|cocoa|product|ecuador|grado|grade|beans|marcas|usa/i.test(l)) return false
    return true
  })
  const weightText = textIn(words, weightBox).join(' ')
  const page1 = groupLines(words).map((l) => l.text).join('\n')
  const fromText = parseHblFromPlainText([page1, extraText].filter(Boolean).join('\n'), fileName)
  const leftContainers = parseContainersFromText(`${leftCargo}\n${descText}`)
  const fullContainers = fromText.containers
  const cargoScore = (list) => list.reduce((s, c) => s + (c.pkgs != null ? 2 : 0) + (c.grossKg != null ? 2 : 0) + (c.description ? 1 : 0), 0)
  const containers = (cargoScore(fullContainers) >= cargoScore(leftContainers) && fullContainers.length
    ? fullContainers
    : (leftContainers.length ? leftContainers : fullContainers))
  containers.forEach((c, i) => {
    const left = leftContainers.find((x) => x.id === c.id) || leftContainers[i]
    const full = fullContainers.find((x) => x.id === c.id) || fullContainers[i]
    if (left?.seal) c.seal = left.seal
    if (c.pkgs == null) c.pkgs = full?.pkgs ?? left?.pkgs ?? null
    if (!c.description) c.description = full?.description || left?.description || ''
    if (c.netKg == null) c.netKg = full?.netKg ?? left?.netKg ?? null
    if (c.grossKg == null) c.grossKg = full?.grossKg ?? left?.grossKg ?? null
  })

  return {
    ...fromText,
    fileName,
    shipper,
    bookingNo: bookingNo || fromText.bookingNo,
    blNo: blNo || fromText.blNo,
    consignee: useLayoutParties && consignee.name
      ? consignee
      : ((fromText.consignee?.lines || []).join(' ').length > (consignee.lines || []).join(' ').length + 15
        ? fromText.consignee
        : consignee),
    notify: useLayoutParties && notify.name
      ? notify
      : ((fromText.notify?.lines || []).join(' ').length > (notify.lines || []).join(' ').length + 15
        ? fromText.notify
        : notify),
    secondNotify: (useLayoutParties && secondNotify.name) || secondNotify.name
      ? secondNotify
      : fromText.secondNotify,
    vessel: vessel || fromText.vessel,
    voyage: voyage || fromText.voyage,
    portLoading: portLoading || fromText.portLoading,
    portDischarge: pickPortFromBlock([portDischarge, fromText.portDischarge].filter(Boolean).join('\n'), 'discharge')
      || fromText.portDischarge
      || portDischarge,
    containers: containers.length ? containers : fromText.containers,
    marks: {
      text: (() => {
        const layout = marksLines.length ? marksLines.join('\n') : ''
        const fallback = fromText.marks.text || ''
        const score = (t) => {
          const s = str(t).toUpperCase()
          let n = s.length
          if (/LOTE/.test(s)) n += 200
          if (/COCOA|BEANS|CACAO|GRADE|GRADO/.test(s)) n += 50
          if (/ULGO|RUC:|ZIMU|BOOKING NO/.test(s)) n -= 250
          if (/IF NO VALUE|DECLARED LIABILITY|CLAUSE \d|RECEIVED BY CARRIER/.test(s)) n -= 400
          if (/^MARCAS?\b/.test(s) && s.length < 48) n -= 80
          return n
        }
        if (/LOTE/i.test(fallback) && !/LOTE/i.test(layout)) return fallback
        if (/LOTE/i.test(layout) && !/LOTE/i.test(fallback)) return layout
        return score(layout) >= score(fallback) ? layout : fallback
      })(),
      lote: marksLines.find((l) => /lote/i.test(l))?.replace(/lote#?\s*/i, '') || fromText.marks.lote,
      lines: marksLines.length ? marksLines : fromText.marks.lines,
    },
    totals: {
      ...fromText.totals,
      cbm: parseNumber(weightText.match(/([\d,]+\.?\d*)\s*CBM/i)?.[1]) || fromText.totals.cbm,
      grossKg: fromText.totals.grossKg
        || parseNumber(weightText.match(/([\d,]+\.?\d*)\s*KGS?/i)?.[1]),
    },
  }
}

export { parseHblFromPlainText, parseHblFromPdfWords }

export function parseProformaFromPlainText(text, fileName) {
  const doc = parseHblFromPlainText(text, fileName)
  doc.kind = 'proforma'
  if (doc.blNo && doc.bookingNo && canon(doc.blNo) === canon(doc.bookingNo)) doc.blNo = ''
  if (/^(ZIMU|GYEG)/i.test(doc.blNo)) doc.blNo = ''
  return doc
}

