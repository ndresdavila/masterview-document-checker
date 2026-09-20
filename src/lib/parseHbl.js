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

function parseLabeledRefs(text) {
  const hs = text.match(/HS\s*CODE:\s*([0-9.]+)/i)?.[1] || ''
  const fda =
    text.match(/FDA\.?\s*REG\.?\s*#\s*([0-9]+)/i)?.[1]
    || text.match(/FDA\s*NR\s*([0-9]+)/i)?.[1]
    || ''
  const dae = text.match(/D\.?A\.?E\.?:?\s*#?\s*([0-9-]+)/i)?.[1] || ''
  const contract = text.match(/CONTRACT#:\s*([A-Z0-9._-]+(?:\s+[A-Z]\b)?)/i)?.[1] || ''
  return { hsCode: hs, fda, dae, contract }
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

function parseCargoBlocks(text) {
  const upper = text.toUpperCase()
  const blocks = []
  const re = /(\d+)\s+(?:BAGS OF|BOXES)\b[\s\S]{0,220}?(?=\d+\s+(?:BAGS OF|BOXES)|TOTAL BAGS|TOTAL CAJAS|HS CODE|FREIGHT COLLECT|$)/g
  let m
  while ((m = re.exec(upper))) {
    const chunk = m[0]
    if (/TOTAL BAGS/.test(chunk) && !/BAGS OF/.test(chunk)) continue
    const pkgs = parseNumber(m[1])
    const isBoxes = /\bBOXES\b/.test(chunk) && !/BAGS OF/.test(chunk)
    if (pkgs != null && pkgs > 800 && !isBoxes) continue
    if (pkgs != null && pkgs > 5000) continue
    const weights = knKb(chunk)
    if (weights.netKg != null && weights.netKg > 40000) continue
    const grado = chunk.match(/TYPE GRADO\s+\d|TYPE GRADE\s+\d(?:\s+RFA)?|GRADE\s+\d(?:\s+RFA)?/)?.[0] || ''
    const bagsLine = chunk.match(/BAGS OF[\s\S]{0,90}?BEANS/)?.[0]
      || chunk.match(/(?:LOMITOS|RALLADO|ATUN)[\s\S]{0,90}?LATAS/)?.[0]
      || ''
    blocks.push({
      pkgs: parseNumber(m[1]),
      description: [bagsLine, grado].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      netKg: parseNumber(chunk.match(/NET WEIGHT:\s*([\d,]+\.?\d*)/)?.[1]) ?? weights.netKg,
      grossKg: parseNumber(chunk.match(/GROSS WEIGHT:\s*([\d,]+\.?\d*)/)?.[1]) ?? weights.grossKg,
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

  const blocks = parseCargoBlocks(upper)
  const n = Math.min(containers.length, blocks.length)
  for (let i = 0; i < n; i += 1) {
    containers[i].pkgs = blocks[i].pkgs
    containers[i].description = blocks[i].description
    containers[i].netKg = blocks[i].netKg
    containers[i].grossKg = blocks[i].grossKg
  }
  const complete = containers.filter((c) => c.pkgs != null)
  const missingCargo = containers.filter((c) => c.pkgs == null)
  if (missingCargo.length && complete.length && complete.every((c) => c.pkgs === complete[0].pkgs)) {
    missingCargo.forEach((c) => {
      c.pkgs = complete[0].pkgs
      c.description = c.description || complete[0].description
      c.netKg = c.netKg ?? complete[0].netKg
      c.grossKg = c.grossKg ?? complete[0].grossKg
    })
  }
  return containers
}

function parseHblFromPlainText(text, fileName) {
  const t = text.replace(/\u00a0/g, ' ')
  const bookingNo = extractBooking(t)
  const blNo = t.toUpperCase().match(BL_RE)?.[1] || ''

  const shipperBlock = captureAfter(
    t,
    /Shipper[\s\S]{0,40}?/i,
    /\bConsignee\b/i,
  )
  const shipperLines = shipperBlock
    .split(/\r?\n/)
    .map(str)
    .filter((l) => l && !/booking no|bill of lading|continued from|combined transport/i.test(l) && l !== bookingNo && l !== blNo)
    .filter((l) => !/^\d{10,}$/.test(l))
    .filter((l) => !/copy non-negotiable/i.test(l))

  const ruc = t.match(/R\.?U\.?C\.?\s*:?\s*([0-9]{10,13})/i)?.[1] || ''
  const shipper = splitParty(shipperLines.filter((l) => !/^R\.?U\.?C\.?/i.test(l)))
  shipper.ruc = ruc

  const consignee = splitParty(
    captureAfter(t, /\bConsignee\b/i, /\bNotify Party\b/i)
      .split(/\r?\n/)
      .map(str)
      .filter((l) => l && !/your cargo|unless provided|non-negotiable unless/i.test(l)),
  )

  const notify = splitParty(
    startOfParty(
      captureAfter(t, /\bNotify Party\b/i, /\bSecond Notify:?|\bPre-Carriage|\bVessel\b/i)
        .split(/\r?\n/)
        .map(str)
        .filter(Boolean),
    ),
  )

  const secondNotify = splitParty(
    captureAfter(t, /\bSecond Notify:?/i, /\bPre-Carriage|\bVessel\b|\bNotify Party\b/i)
      .split(/\r?\n/)
      .map(str)
      .filter((l) => l && !/your cargo/i.test(l)),
  )

  const vesselLine = t
    .split(/\r?\n/)
    .map(str)
    .find((l) => findVoyage(l) && /GUAYAQUIL|NIKE|CMA|MAERSK|MSC|HAPAG|COSCO|EVERGREEN|HSL|FELICIA|ENDURANCE|OCEANA|SIROCCO|CONTSHIP|JOHN|MARTI/i.test(l))
    || t.split(/\r?\n/).map(str).find((l) => findVoyage(l))
    || ''

  const split = splitVesselVoyagePort(vesselLine)
  const vessel = split.vessel
  const portLoading = split.portLoading
  const voyage = split.voyage || t.toUpperCase().match(VOYAGE_RE)?.[1] || ''

  const portDischarge =
    captureAfter(t, /Port of Discharge/i, /Place of Delivery|Marks &|CONTAINER:/i)
      .split(/\r?\n/)
      .map(str)
      .find((l) => /new york|united states|usa|guayaquil|hamburg|rotterdam|oakland|buenaventura|colombia|philadelphia|posorja/i.test(l))
    || (t.match(/BUENAVENTURA[, ]+COLOMBIA/i)?.[0] ?? '')
    || (t.match(/NEW YORK,\s*UNITED STATES/i)?.[0] ?? '')
    || (t.match(/PHILADELPHIA/i)?.[0] ?? '')

  const lote = t.match(/LOTE#?\s*([A-Z0-9-]+)/i)?.[1] || ''
  const lastBrandMarks = (() => {
    const re = /(GLOBAL-COCOA|ECO-KAKAO|BURNEOEXPORT|K'?MEN|AGROARRIBA|JOHANSACORP|SAN GERARDO|OSELLA|GRANDSOUTH)[\s\S]{0,200}LOTE[^\n]{0,40}/gi
    const all = [...t.matchAll(re)]
    return all.length ? all[all.length - 1][0] : ''
  })()
  const marksMatch = t.match(/MARCAS:?\s*([\s\S]{0,220}?)(?=\d+\s+BAGS|TOTAL BAGS|HS CODE|FREIGHT COLLECT|$)/i)
  const marksRaw = (lastBrandMarks || marksMatch?.[0] || '').split(/TOTAL BAGS|TOTAL CAJAS|TOTAL NET|HS CODE|FREIGHT COLLECT|\d+\s+BAGS\b/i)[0]
  const totalsBags = parseNumber(t.match(/TOTAL BAGS:\s*([\d,]+)/i)?.[1])
    || parseNumber(t.match(/TOTAL CAJAS:\s*([\d.,]+)/i)?.[1])
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
    /TOTAL NET WEIGHT:\s*([\d,]+\.?\d*)/i,
    /N(?:ET)?\s*W(?:EIGHT)?:?\s*([\d,]+\.?\d*)/gi,
  ) || parseNumber(t.match(/PESO NETO TOTAL:\s*([\d.,]+)/i)?.[1]) || lastLargeKn
  const totalGross = pickLargeWeight(
    /TOTAL GROSS WEIGHT:\s*([\d,]+\.?\d*)/i,
    /GROSS WEIGHT:\s*([\d,]+\.?\d*)/gi,
  ) || lastGrossLabeled
    || (kgBesideCbm != null && kgBesideCbm > 40000 ? kgBesideCbm : null)
    || parseNumber(t.match(/PESO BRUTO TOTAL:\s*([\d.,]+)/i)?.[1])
    || lastLargeKb
  const cbm = parseNumber(t.match(/([\d,]+\.?\d*)\s*CBM/i)?.[1])

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
    containers: parseContainersFromText(t),
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
      hqLine: t.match(/\dX40HQ CONTAINERS STC/i)?.[0] || '',
    },
  }
}

function parseHblFromPdfWords(words, fileName, extraText = '') {
  const W = 596
  const left = { x0: 0, x1: 285, y0: 55, y1: 120 }
  const booking = { x0: 285, x1: 430, y0: 55, y1: 95 }
  const bl = { x0: 430, x1: W, y0: 55, y1: 95 }
  const consigneeBox = { x0: 0, x1: 285, y0: 118, y1: 170 }
  const notifyBox = { x0: 0, x1: 280, y0: 170, y1: 235 }
  const secondBox = { x0: 280, x1: W, y0: 168, y1: 235 }
  const podBox = { x0: 290, x1: 430, y0: 250, y1: 300 }
  const descBox = { x0: 175, x1: 430, y0: 315, y1: 560 }
  const weightBox = { x0: 430, x1: W, y0: 315, y1: 360 }

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
  const notify = splitParty(startOfParty(textIn(words, notifyBox).filter((l) => !/^notify party$/i.test(l))))
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
    return /lote|marcas|cocoa|beans|product of|ecuador|grado|grade|usa|global|kakao|burneo|agro|intikaw|gerardo|k.?men|johansa|osella|sudespensa|dexicon/i.test(l)
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
  const containers = leftContainers.length >= fullContainers.length ? leftContainers : fullContainers
  containers.forEach((c, i) => {
    const left = leftContainers.find((x) => x.id === c.id) || leftContainers[i]
    const full = fullContainers.find((x) => x.id === c.id) || fullContainers[i]
    if (left?.seal) c.seal = left.seal
    if (c.pkgs == null && full?.pkgs != null) {
      c.pkgs = full.pkgs
      c.description = c.description || full.description
      c.netKg = c.netKg ?? full.netKg
      c.grossKg = c.grossKg ?? full.grossKg
    }
  })

  return {
    ...fromText,
    fileName,
    shipper,
    bookingNo: bookingNo || fromText.bookingNo,
    blNo: blNo || fromText.blNo,
    consignee,
    notify,
    secondNotify: secondNotify.name ? secondNotify : fromText.secondNotify,
    vessel: vessel || fromText.vessel,
    voyage: voyage || fromText.voyage,
    portLoading: portLoading || fromText.portLoading,
    portDischarge: /guayaquil|york|philadelphia|buenaventura|oakland|hamburg|rotterdam|posorja|colombia|united states/i.test(portDischarge)
      ? portDischarge
      : (fromText.portDischarge || portDischarge),
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

