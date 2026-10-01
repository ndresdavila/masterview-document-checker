import {
  str,
  parseNumber,
  extractBooking,
  extractIsoId,
  sealTokens,
  findVoyage,
  splitVesselVoyagePort,
  ISO_RE,
} from './normalize.js'
import { detectCarrier } from './carrier.js'

function splitParty(lines) {
  const clean = lines
    .map((l) => str(l).replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((l) => !/copy non-negotiable|continued from reverse|combined transport|insert name/i.test(l))
  return {
    name: clean[0] || '',
    address: clean.slice(1).join('\n'),
    lines: clean,
  }
}

function partyFromText(block) {
  const raw = str(block)
    .replace(/Insert Name Address and Phone\/Fax/gi, ' ')
    .replace(/\b(?:Bill of Lading No\.?|Booking No\.?|Export References|FMC\/?CHB No\.?)\b/gi, ' ')
    .replace(/\bCOSU\d{10}\b/g, ' ')
    .replace(/\bONEY[A-Z0-9]{10,}\b/g, ' ')
    .replace(/\bZIMU[A-Z]{2,5}\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return splitParty([])
  const bits = raw
    .split(/(?=\bEMAIL:)|(?=\bRUC:?\s*\d)|(?=\bTEL(?:EFONO)?:)/i)
    .map((p) => str(p))
    .filter(Boolean)
  const lines = []
  for (const bit of bits) {
    const parts = bit.split(/\s{2,}|(?<=S\.?A\.?)\s+(?=RUC)|(?<=LLC)\s+/)
    parts.forEach((p) => {
      const t = str(p)
      if (t) lines.push(t)
    })
  }
  const collapsed = (lines.length ? lines : [raw])
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
  const named = collapsed.match(
    /^((?:MASTERVIEW|UCC [A-Z]+(?: GROUP)?|NIRSA|PUERTOMAR|OSELLA|ECO-?KAKAO|MOI FOODS|AGROARRIBA|GRANDSOUTH|GLOBAL COCOA|SUDESPENSA BARRAGAN|ITOCHU|BLOMMER)[^,]*(?:S\.?A\.?|LLC|SAS|LTDA)?)/i,
  )
  if (named) {
    return splitParty([named[1], str(collapsed.slice(named[1].length))])
  }
  return splitParty(collapsed.split(/(?=\bRUC\b)|(?=\bEMAIL:)|(?=\bURB\.)|(?=\d{3,}\s+NW)/i))
}

function captureAfter(text, re, stopRe) {
  const m = text.match(re)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const stop = rest.search(stopRe)
  return str(stop >= 0 ? rest.slice(0, stop) : rest)
}

function parseRefs(text) {
  const t = str(text)
  const hs = t.match(/HS\s*(?:CODE|IMPORTING CODE)?\s*:?\s*([0-9.]+)/i)?.[1]
    || t.match(/PARTIDA ARANCELARIA:\s*([0-9.]+)/i)?.[1]
    || t.match(/P\.A\s*:?\s*([0-9.]+)/i)?.[1]
    || ''
  const fda =
    t.match(/FDA\.?\s*REG\.?\s*#\s*([0-9]+)/i)?.[1]
    || t.match(/FDA\s*NR\s*([0-9]+)/i)?.[1]
    || t.match(/FDA(?:\s*NUMBER)?\s*:?\s*([0-9]{8,})/i)?.[1]
    || ''
  const dae = (t.match(/D\.?A\.?E\.?\s*#?:?\s*['"]?([0-9][0-9\s-]{10,}[0-9])/i)?.[1] || '').replace(/\s+/g, '')
  let contract = t.match(/CONTRATO#?:?\s*([A-Z0-9._-]+)/i)?.[1]
    || t.match(/CONTRACT#:\s*([A-Z0-9._-]+)/i)?.[1]
    || t.match(/\bCO\.\s*(P\d[\d.]+)/i)?.[1]
    || t.match(/\bPO:\s*(P\d[\d.]+)/i)?.[1]
    || t.match(/\b(P0\d{4}(?:\.\d+)?)\b/i)?.[1]
    || ''
  if (/^(FREIGHT|SHIPPED|COLLECT|PREPAID|EXPRESS|NO|FORM|DOC|ITEM)$/i.test(contract)) contract = ''
  const loteHit = t.match(/LOTE#?\s*(?:NUMBER:?\s*)?([A-Z0-9-]+)/i)?.[1] || ''
  const lote = /^NUMBER$/i.test(loteHit) ? (t.match(/LOTE#?\s*NUMBER:?\s*(\d+)/i)?.[1] || loteHit) : loteHit
  return { hsCode: hs, fda, dae, contract, lote }
}

function pkgsFrom(chunk) {
  const hits = [...str(chunk).matchAll(/(\d{2,5})\s+(BAGS|BOXES|CARTONS|PACKAGES|CAJAS)\b/gi)]
    .map((m) => ({ n: parseNumber(m[1]), unit: m[2].toUpperCase() }))
    .filter((x) => x.n != null && x.n >= 10 && x.n < 8000)
  const per = hits.filter((x) => x.n < 800)
  return (per[0] || hits[0])?.n ?? null
}

function descFrom(chunk) {
  const t = str(chunk).replace(/\s+/g, ' ')
  return (
    t.match(/\b(?:36[0-9]|3[0-5]\d|2\d{2}|1\d{2}|[5-9]\d)\s+BAGS OF[\s\S]{0,90}?(?:BEANS|ARABICA|COFFEE|QUALITY|GRADE|GRADO)\s*\d?/i)?.[0]
    || t.match(/\d+\s+(?:CARTONS|BOXES|CAJAS)[\s\S]{0,80}?(?:PESCADO|ATUN|CONSERVAS|FISH)/i)?.[0]
    || t.match(/ECUADOR(?:IAN)? COCOA[\s\S]{0,40}?(?:GRADE|GRADO)\s+\d/i)?.[0]
    || t.match(/COCOA BEANS[\s\S]{0,30}?(?:GRADE|GRADO)\s+\d/i)?.[0]
    || ''
  ).replace(/\s+/g, ' ').trim()
}

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
    text: l.words.sort((a, b) => a.x - b.x).map((w) => str(w.str)).join(' ').replace(/\s+/g, ' ').trim(),
  }))
}

function textIn(words, box) {
  return groupLines(words.filter((w) => w.x >= box.x0 && w.x < box.x1 && w.y >= box.y0 && w.y < box.y1))
    .map((l) => l.text)
    .filter(Boolean)
}

function lastKnKb(chunk) {
  const nets = [...str(chunk).matchAll(/([\d.,]+)\s*(?:K\.?\s*N|KN)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  const grosses = [...str(chunk).matchAll(/([\d.,]+)\s*(?:K\.?\s*B|KB)\b/gi)]
    .map((m) => parseNumber(m[1]))
    .filter((n) => n != null && n >= 8000 && n < 40000)
  return {
    netKg: nets.length ? nets[nets.length - 1] : null,
    grossKg: grosses.length ? grosses[grosses.length - 1] : null,
  }
}

function parseZimContainers(text) {
  const t = str(text).toUpperCase()
  const hits = [...t.matchAll(/CONT:\s*([A-Z]{4}\d{7})/g)]
  const containers = []
  for (let i = 0; i < hits.length; i += 1) {
    const id = hits[i][1]
    const prev = i === 0 ? Math.max(0, hits[i].index - 280) : hits[i - 1].index
    const to = hits[i + 1] ? hits[i + 1].index : Math.min(t.length, hits[i].index + 900)
    const gap = t.slice(prev, hits[i].index)
    const after = t.slice(hits[i].index, to)
    const bagHits = [...gap.matchAll(/(\d{2,4})\s+BAGS\b/g)]
      .map((x) => parseNumber(x[1]))
      .filter((n) => n != null && n >= 50 && n < 500)
    const weights = lastKnKb(gap)
    const labeledNet = parseNumber(after.match(/(?<!TOTAL )NET WEIGHT:\s*([\d.,]+)/i)?.[1])
    const labeledGross = parseNumber(after.match(/(?<!TOTAL )GROSS WEIGHT:\s*([\d.,]+)/i)?.[1])
    const bagsAfter = [...after.matchAll(/(\d{2,4})\s+BAGS\b/g)]
      .map((x) => parseNumber(x[1]))
      .filter((n) => n != null && n >= 50 && n < 500)
    const seals = [...after.matchAll(/SEAL:\s*([A-Z0-9]+)/gi)].map((x) => x[1])
    const extra = sealTokens(after.split(/BAGS OF|MARCAS|SHIPPER'S LOAD|CONT TARE/)[0])
    const netKg = weights.netKg ?? (labeledNet != null && labeledNet < 40000 ? labeledNet : null)
    const grossKg = weights.grossKg ?? (labeledGross != null && labeledGross < 40000 ? labeledGross : null)
    containers.push({
      id,
      seal: [...new Set([...seals, ...extra])].join(', '),
      pkgs: bagHits[bagHits.length - 1] ?? (labeledNet ? bagsAfter[0] : null),
      description: descFrom(gap) || descFrom(after),
      netKg,
      grossKg,
      cbm: /HC40|40HQ/i.test(after) ? 50 : (/20(?:GP|ST)/i.test(after) ? 20 : null),
    })
  }
  const knownGross = containers.map((c) => c.grossKg).filter((n) => n != null)
  if (knownGross.length && knownGross.length === containers.length - 1 && new Set(knownGross).size === 1) {
    containers.forEach((c) => { if (c.grossKg == null) c.grossKg = knownGross[0] })
  }
  const knownNet = containers.map((c) => c.netKg).filter((n) => n != null)
  if (knownNet.length && knownNet.length === containers.length - 1 && new Set(knownNet).size === 1) {
    containers.forEach((c) => { if (c.netKg == null) c.netKg = knownNet[0] })
  }
  return containers
}

function parseZimPartiesFromWords(words) {
  if (!words?.length) return null
  const left = words.filter((w) => w.x < 280 && w.y > 50 && w.y < 250)
  if (left.length < 4) return null
  const lines = groupLines(left, 6).filter((l) => !/^KGS$|^M3$|^CONT TOT/i.test(l.text))
  const blocks = []
  let cur = []
  let lastY = -999
  for (const line of lines) {
    if (cur.length && line.y - lastY > 22) {
      blocks.push(cur)
      cur = [line.text]
    } else {
      cur.push(line.text)
    }
    lastY = line.y
  }
  if (cur.length) blocks.push(cur)
  const named = blocks.filter((b) => {
    const t = b.join(' ')
    return t.length > 8 && /MASTERVIEW|UCC |LLC|S\.?A|S\.E\.C|BROKERAGE|INC\.|SAS|LTDA|NUTRIART|ITOCHU|BLOMMER/i.test(t)
  })
  if (named.length < 2) return null
  return {
    shipper: splitParty(named[0] || []),
    consignee: splitParty(named[1] || []),
    notify: splitParty(named[2] || named[1] || []),
  }
}

function parseCoscoContainers(text) {
  const t = str(text).toUpperCase()
  const seen = new Set()
  const containers = []
  const summary = /([A-Z]{4}\d{7})\s*\/\s*([A-Z0-9]+)\s*\/\s*(\d+)\s+(BAGS|BOXES|CARTONS|PACKAGES)\s*\/[^\n]*?\/[A-Z0-9]+\/([\d.]+)KGS(?:;([\d.]+)CBM)?/gi
  let m
  while ((m = summary.exec(t))) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    containers.push({
      id,
      seal: m[2],
      pkgs: parseNumber(m[3]),
      description: '',
      netKg: null,
      grossKg: parseNumber(m[5]),
      cbm: parseNumber(m[6]),
    })
  }
  const blockRe = /CONTAINER:\s*([A-Z]{4}\d{7})?([\s\S]*?)(?=CONTAINER:|SAY |DECLARED CARGO|MARKS FDA|-{10,}|OCEAN FREIGHT COLLECT|$)/gi
  while ((m = blockRe.exec(t))) {
    const chunk = `${m[1] || ''} ${m[2]}`
    const id = extractIsoId(chunk)
    if (!id) continue
    const weights = lastKnKb(chunk)
    const seals = sealTokens(
      chunk
        .replace(/SEALS?:/gi, ' ')
        .split(/BAGS OF|ECUADORIAN|COCOA|MARKS/)[0],
    )
    const pkgs = pkgsFrom(chunk)
    let row = containers.find((c) => c.id === id)
    if (!row) {
      if (seen.has(id)) continue
      seen.add(id)
      row = { id, seal: '', pkgs: null, description: '', netKg: null, grossKg: null, cbm: null }
      containers.push(row)
    }
    if (!row.seal && seals.length) row.seal = seals.join(', ')
    if (row.pkgs == null || (pkgs != null && pkgs < 500 && (row.pkgs == null || row.pkgs >= 500))) row.pkgs = pkgs
    if (row.netKg == null && weights.netKg != null && weights.netKg < 40000) row.netKg = weights.netKg
    if (row.grossKg == null && weights.grossKg != null && weights.grossKg < 40000) row.grossKg = weights.grossKg
    if (!row.description) row.description = descFrom(chunk)
  }
  const knownNet = containers.map((c) => c.netKg).filter((n) => n != null)
  if (knownNet.length && knownNet.length === containers.length - 1 && new Set(knownNet).size === 1) {
    containers.forEach((c) => { if (c.netKg == null) c.netKg = knownNet[0] })
  }
  return containers
}

function parseOneContainers(text) {
  const t = str(text).toUpperCase()
  const containers = []
  const seen = new Set()
  const re = /([A-Z]{4}\d{7})\s*\/\s*([A-Z0-9]+)\s*\/\s*(\d+)\s+(CARTONS|BOXES|BAGS|PACKAGES|CAJAS)/gi
  let m
  while ((m = re.exec(t))) {
    const id = m[1]
    if (seen.has(id) || /X40|X20/.test(id)) continue
    seen.add(id)
    const tail = t.slice(m.index, m.index + 220)
    const gw = parseNumber(tail.match(/([\d.]+)\s*KGS/i)?.[1])
    const cbm = parseNumber(tail.match(/([\d.]+)\s*(?:M3|CBM)/i)?.[1])
    containers.push({
      id,
      seal: m[2],
      pkgs: parseNumber(m[3]),
      description: descFrom(tail)
        || str(text).match(/SAID TO CONTAIN:\s*([\s\S]{10,160}?)(?=-{10,}|TOTAL |FREIGHT |PAGE:|$)/i)?.[1]?.replace(/\s+/g, ' ').trim()
        || `${m[3]} ${m[4]}`,
      netKg: null,
      grossKg: gw != null && gw >= 1000 ? gw : null,
      cbm,
    })
  }
  if (!containers.length) {
    const hits = [...t.matchAll(ISO_RE)]
    for (const hit of hits) {
      const id = hit[1]
      if (seen.has(id)) continue
      seen.add(id)
      const zone = t.slice(hit.index, hit.index + 180)
      const seals = sealTokens(zone)
      containers.push({
        id,
        seal: seals[0] || '',
        pkgs: pkgsFrom(zone),
        description: descFrom(zone),
        netKg: null,
        grossKg: parseNumber(zone.match(/([\d.]+)\s*KGS/i)?.[1]),
        cbm: parseNumber(zone.match(/([\d.]+)\s*(?:M3|CBM)/i)?.[1]),
      })
    }
  }
  return containers
}

function parseZim(text, fileName, words = []) {
  const t = str(text)
  const blNo = (t.toUpperCase().match(/ZIMU[A-Z]{2,5}\d{6,}/)?.[0] || '').replace(/\/\d+$/, '')
  const bookingNo = extractBooking(t) || blNo
  const voySlash = t.match(/\b(\d{2,4}\s*\/\s*[NSEW])\b/i)?.[1] || ''
  const voyageRaw = str(t.match(/VOYAGE:\s*(\d{2,4}\s*\/\s*[NSEW]|[A-Z0-9]+)/i)?.[1])
  const voyage = /^(FINAL|DESTINATION|PORT)$/i.test(voyageRaw)
    ? voySlash
    : (voySlash || voyageRaw || findVoyage(t.replace(/FINAL DESTINATION/gi, ' ')))
  const vesselRaw = str(t.match(/([A-Z][A-Z0-9 .'-]{2,40}?)\s+VESSEL:/i)?.[1])
    || str(t.match(/VESSEL:\s*([A-Z][A-Z0-9 .'-]+?)(?:\s+VOYAGE:|\s+LOAD|\s*$)/i)?.[1])
  const vessel = str(vesselRaw)
    .replace(/^MASTERVIEW\s*-\s*[A-Z0-9]+\s+/i, '')
    .replace(/^(ECOKAKAO|ECO-KAKAO|OSELLA|NIRSA|PUERTOMAR)\s+/i, '')
  const portLoading = str(t.match(/LOAD PORT:\s*([A-Z]{4,})/i)?.[1])
    || (/\bGUAYAQUIL\b/i.test(t) ? 'GUAYAQUIL' : '')
  const portDischarge = t.match(/HALIFAX\s*\(NS\)/i)?.[0]
    || t.match(/NEW YORK\s*\(NY\)/i)?.[0]
    || t.match(/BUENAVENTURA/i)?.[0]
    || t.match(/PHILADELPHIA|SAVANNAH|OAKLAND/i)?.[0]
    || ''
  const fromWords = parseZimPartiesFromWords(words)
  const shipper = fromWords?.shipper?.name
    ? fromWords.shipper
    : partyFromText(t.match(/MASTERVIEW S\.?A\.?[\s\S]{0,180}?EMAIL:[^\s]+/i)?.[0] || 'MASTERVIEW S.A.')
  const consignee = fromWords?.consignee?.name
    ? fromWords.consignee
    : partyFromText(t.match(/UCC LOGISTICS GROUP[\s\S]{0,140}?PANAMA CITY,\s*PANAMA/i)?.[0] || '')
  const notify = fromWords?.notify?.name
    ? fromWords.notify
    : partyFromText(t.match(/UCC AMERICA LLC[\s\S]{0,160}?(?:@UCCLOG\.COM)/i)?.[0] || '')
  const containers = parseZimContainers(t)
  const refs = parseRefs(t)
  const totalNet = parseNumber(t.match(/TOTAL NET WEIGHT:\s*([\d.,]+)/i)?.[1])
  const totalGross = parseNumber(t.match(/TOTAL GROSS WEIGHT:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/CARGO W\s*:\s*[\d.,]+\s+([\d.,]+)/i)?.[1])
  const cbm = parseNumber(t.match(/CARGO W\s*:\s*([\d.,]+)/i)?.[1])
    || containers.reduce((s, c) => s + (c.cbm || 0), 0)
    || null
  const bags = containers.every((c) => c.pkgs != null)
    ? containers.reduce((s, c) => s + c.pkgs, 0)
    : parseNumber(t.match(/(\d+)\s+BAGS OF[\s\S]{0,40}CACAO/i)?.[1])
  const marks = t.match(/MARCAS:\s*([\s\S]{0,240}?)(?=ALSO NOTIFY|CLAUSES:|SHIPPER'S LOAD|TOTAL NET|$)/i)?.[1] || ''
  return finish({
    carrier: 'zim',
    fileName,
    shipper,
    consignee,
    notify,
    bookingNo,
    blNo,
    vessel,
    voyage,
    portLoading,
    portDischarge,
    containers,
    marks: { text: marks, lote: refs.lote, lines: str(marks).split(/\n/).filter(Boolean) },
    totals: { bags, netKg: totalNet, grossKg: totalGross, cbm: cbm || null },
    refs,
  }, t)
}

function parseCosco(text, fileName) {
  const t = str(text)
  const blNo = t.toUpperCase().match(/COSU\d{10}/)?.[0] || ''
  const bookingNo = t.match(/Booking No\s*\.?\s*(\d{10})/i)?.[1]
    || t.match(/\b(\d{10})\b/)?.[1]
    || extractBooking(t)
  const vessel = str(t.match(/Vessel:\s*([A-Z0-9 ]+?)\s+Voyage:/i)?.[1])
    || str(captureAfter(t, /6\.\s*Ocean Vessel Voy\.?\s*No\.?/i, /7\.\s*Port of Loading|Service Contract/i))
      .replace(/\d{10}|COSU\d+ /g, ' ')
      .trim()
  const voyage = str(t.match(/Voyage:\s*([A-Z0-9]+)/i)?.[1]) || findVoyage(`${vessel} ${t.match(/Ocean Vessel Voy\.?\s*No\.?\s*([^\n]+)/i)?.[1] || ''}`)
  const vesselClean = splitVesselVoyagePort(`${vessel} ${voyage}`).vessel || vessel
  const voyageClean = splitVesselVoyagePort(`${vessel} ${voyage}`).voyage || voyage
  const portLoading = str(
    t.match(/Port of Loading\s*(GUAYAQUIL(?:,\s*ECUADOR)?)/i)?.[1]
      || t.match(/LOAD PORT:\s*(GUAYAQUIL)/i)?.[1]
      || '',
  ) || (/\bGUAYAQUIL\b/i.test(t) ? 'GUAYAQUIL' : '')
  const portDischarge = str(t.match(/8\.\s*Port of Discharge\s*([A-Z ,]+)/i)?.[1])
    || t.match(/NEW YORK[^\n,]*(?:,[A-Z ]+)?/i)?.[0]
    || t.match(/BUENAVENTURA/i)?.[0]
    || ''
  const shipper = partyFromText(
    captureAfter(t, /1\.\s*Shipper[\s\S]{0,60}?Phone\/Fax/i, /2\.\s*Consignee|Booking No/i)
      || t.match(/MASTERVIEW S\.?A\.?[\s\S]{0,200}?EMAIL:[^\s]+/i)?.[0],
  )
  const consignee = partyFromText(
    captureAfter(t, /2\.\s*Consignee[\s\S]{0,60}?Phone\/Fax/i, /3\.\s*Notify|Forwarding Agent/i)
      || t.match(/UCC AMERICA LLC[\s\S]{0,220}?USA/i)?.[0],
  )
  const notify = partyFromText(
    captureAfter(t, /Also Notify Party-routing[^A-Z]* /i, /4\.\s*Combined Transport/i)
      || captureAfter(t, /3\.\s*Notify Party/i, /4\.\s*Combined Transport/i)
      || t.match(/UCC LOGISTICS GROUP[\s\S]{0,140}?PANAMA CITY,\s*PANAMA/i)?.[0],
  )
  const containers = parseCoscoContainers(t)
  const refs = parseRefs(t)
  const headerTot = t.match(/(\d+)X40HQ CONTAINER\s+([\d.]+)KGS\s+([\d.]+)CBM/i)
  const summedNet = containers.reduce((s, c) => s + (c.netKg || 0), 0)
  const totalNet = (() => {
    const labeled = parseNumber(t.match(/\bNW:\s*([\d.,]+)/i)?.[1])
    if (summedNet > 1000 && labeled && summedNet > labeled * 1.4) return summedNet
    return labeled || (summedNet > 1000 ? summedNet : null)
  })()
  const totalGross = parseNumber(t.match(/\bGW:\s*([\d.,]+)/i)?.[1])
    || parseNumber(headerTot?.[2])
    || parseNumber(t.match(/TOTAL GROSS WEIGHT:\s*([\d.,]+)/i)?.[1])
  const cbm = parseNumber(headerTot?.[3])
    || containers.reduce((s, c) => s + (c.cbm || 0), 0)
    || null
  const bags = containers.every((c) => c.pkgs != null)
    ? containers.reduce((s, c) => s + c.pkgs, 0)
    : parseNumber(headerTot ? t.match(/CONTAINER:\s*(\d{3,5})\s+\dX40/i)?.[1] : null)
  const marks = t.match(/MARCAS:\s*([\s\S]{0,280}?)(?=OCEAN FREIGHT|SHIPPER'S LOAD|-{10,}|$)/i)?.[1]
    || t.match(/MARKS\s+FDA:[\s\S]{0,280}?(?=-{10,}|OCEAN FREIGHT|$)/i)?.[0]
    || ''
  return finish({
    carrier: 'cosco',
    fileName,
    shipper,
    consignee,
    notify,
    bookingNo,
    blNo,
    vessel: vesselClean,
    voyage: voyageClean,
    portLoading,
    portDischarge,
    containers,
    marks: { text: marks, lote: refs.lote, lines: str(marks).split(/\n/).filter(Boolean) },
    totals: {
      bags: bags || null,
      netKg: totalNet && totalNet > 1000 ? totalNet : null,
      grossKg: totalGross,
      cbm: cbm || null,
    },
    refs,
  }, t)
}

function parseOneFromWords(words) {
  const shipperLbl = words.find((w) => /SHIPPER\/EXPORTER/i.test(str(w.str)) && w.x < 80)
  const consigneeLbl = words.find((w) => /^CONSIGNEE$/i.test(str(w.str)) && w.x < 80)
  const notifyLbl = words.find((w) => /NOTIFY PARTY/i.test(str(w.str)) && w.x < 80)
  const preLbl = words.find((w) => /PRE-CARRIAGE BY/i.test(str(w.str)) && w.x < 80)
  if (!shipperLbl || !consigneeLbl) return null
  const left = 330
  const shipper = splitParty(
    textIn(words, { x0: 20, x1: left, y0: shipperLbl.y + 6, y1: consigneeLbl.y - 4 })
      .filter((l) => !/SHIPPER|BOOKING NO|BILL OF LADING|EXPORT REFERENCES/i.test(l)),
  )
  const notifyY = notifyLbl?.y ?? (consigneeLbl.y + 70)
  const consignee = splitParty(
    textIn(words, { x0: 20, x1: left, y0: consigneeLbl.y + 6, y1: notifyY - 4 })
      .filter((l) => !/^CONSIGNEE$|FMC NO|FORWARDING AGENT|RECEIVED by/i.test(l)),
  )
  const notify = splitParty(
    textIn(words, { x0: 20, x1: left, y0: notifyY + 8, y1: (preLbl?.y ?? notifyY + 70) - 2 })
      .filter((l) => !/NOTIFY PARTY|RECEIVED by|PRE-CARRIAGE/i.test(l)),
  )
  const bookingLbl = words.find((w) => /BOOKING NO/i.test(str(w.str)))
  const blLbl = words.find((w) => /BILL OF LADING NO/i.test(str(w.str)))
  const bookingNo = bookingLbl
    ? extractBooking(
      words
        .filter((w) => w.y > bookingLbl.y && w.y < bookingLbl.y + 28 && w.x > 330)
        .map((w) => w.str)
        .join(' '),
    )
    : ''
  const blNo = blLbl
    ? (words
      .filter((w) => w.y > blLbl.y && w.y < blLbl.y + 28 && w.x > 430)
      .map((w) => str(w.str).toUpperCase())
      .join(' ')
      .match(/ONEY[A-Z0-9]{10,}/)?.[0] || '')
    : ''
  const vesLbl = words.find((w) => /OCEAN VESSEL VOYAGE/i.test(str(w.str)))
  let vessel = ''
  let voyage = ''
  let portLoading = ''
  if (vesLbl) {
    const line = words
      .filter((w) => w.y > vesLbl.y + 4 && w.y < vesLbl.y + 22 && w.x < 330)
      .sort((a, b) => a.x - b.x)
      .map((w) => str(w.str))
      .join(' ')
    const split = splitVesselVoyagePort(line)
    vessel = split.vessel
    voyage = split.voyage
    portLoading = split.portLoading
    if (!portLoading) {
      portLoading = words
        .filter((w) => Math.abs(w.y - (vesLbl.y + 8)) < 16 && w.x > 170 && w.x < 340)
        .map((w) => str(w.str))
        .join(' ')
    }
  }
  const podLbl = words.find((w) => /^PORT OF DISCHARGE$/i.test(str(w.str)) && w.x < 80)
  const portDischarge = podLbl
    ? words
      .filter((w) => w.y > podLbl.y + 4 && w.y < podLbl.y + 22 && w.x < 180)
      .map((w) => str(w.str))
      .join(' ')
    : ''
  return { shipper, consignee, notify, bookingNo, blNo, vessel, voyage, portLoading, portDischarge }
}

function parseOne(text, fileName, words) {
  const t = str(text)
  const fromWords = words?.length ? parseOneFromWords(words) : null
  const blNo = fromWords?.blNo || t.toUpperCase().match(/ONEY[A-Z0-9]{10,}/)?.[0] || ''
  const bookingNo = fromWords?.bookingNo || t.toUpperCase().match(/GYEG\d{8,}/)?.[0] || extractBooking(t)
  const vv = t.match(/VESSEL\s+VOYAGE:\s*([A-Z0-9 ]+?)\s+(\d{3,4}[NSEW])/i)
  const split = splitVesselVoyagePort(t.match(/OCEAN VESSEL VOYAGE NO\. FLAG[\s\S]{0,8}([A-Z0-9 ]+?\s+\d{3,4}[NSEW])/i)?.[1] || vv?.[0] || '')
  const vessel = fromWords?.vessel || split.vessel || str(vv?.[1])
  const voyage = fromWords?.voyage || split.voyage || str(vv?.[2]) || findVoyage(t)
  const portLoading = fromWords?.portLoading || t.match(/PORT OF LOADING[\s\S]{0,40}?(GUAYAQUIL|POSORJA|MANTA)/i)?.[1] || ''
  const portDischarge = fromWords?.portDischarge
    || t.match(/PORT OF DISCHARGE[\s\S]{0,40}?(BUENAVENTURA|NEW YORK|PHILADELPHIA|SAVANNAH)/i)?.[1]
    || ''
  const shipper = fromWords?.shipper?.name
    ? fromWords.shipper
    : partyFromText(captureAfter(t, /SHIPPER\/EXPORTER/i, /\*\*|PRE-CARRIAGE|PORT OF LOADING|CONSIGNEE\b/i))
  const consignee = fromWords?.consignee?.name
    ? fromWords.consignee
    : partyFromText(
      t.match(/(SUDESPENSA BARRAGAN[\s\S]{0,220}?(?:COLOMBIA|TELEFONO:[^\n]+))/i)?.[1]
        || captureAfter(t, /CONSIGNEE/i, /NOTIFY PARTY|FORWARDING AGENT|PRE-CARRIAGE/i),
    )
  const notify = fromWords?.notify?.name ? fromWords.notify : consignee
  const containers = parseOneContainers(t)
  const refs = parseRefs(t)
  let totalNet = parseNumber(t.match(/TOTAL PESO NETO:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/PESO NETO:\s*([\d.,]+)/i)?.[1])
  let totalGross = parseNumber(t.match(/TOTAL PESO BRUTO:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/PESO BRUTO:\s*([\d.,]+)/i)?.[1])
    || parseNumber(t.match(/([\d.]+)\s*KGS\s+[\d.]+\s*CBM/i)?.[1])
  let cbm = parseNumber(t.match(/([\d.]+)\s*CBM/i)?.[1])
    || containers.reduce((s, c) => s + (c.cbm || 0), 0)
    || null
  const sumGross = containers.reduce((s, c) => s + (c.grossKg || 0), 0)
  const sumNet = containers.reduce((s, c) => s + (c.netKg || 0), 0)
  const sumCbm = containers.reduce((s, c) => s + (c.cbm || 0), 0)
  if (containers.length > 1 && totalGross && sumGross > totalGross * 1.4) totalGross = sumGross
  if (!totalGross && sumGross) totalGross = sumGross
  if (!totalNet && sumNet) totalNet = sumNet
  if (containers.length > 1 && cbm && sumCbm > cbm * 1.4) cbm = sumCbm
  if (!cbm && sumCbm) cbm = sumCbm
  const bags = containers.every((c) => c.pkgs != null)
    ? containers.reduce((s, c) => s + c.pkgs, 0)
    : null
  return finish({
    carrier: 'one',
    fileName,
    shipper,
    consignee,
    notify,
    bookingNo,
    blNo,
    vessel,
    voyage,
    portLoading,
    portDischarge,
    containers,
    marks: { text: t.match(/\bN\/M\b/i)?.[0] || '', lote: refs.lote, lines: [] },
    totals: { bags, netKg: totalNet, grossKg: totalGross, cbm: cbm || null },
    refs,
  }, t)
}

function finish(doc, text) {
  const ruc = str(text).match(/RUC:?\s*([0-9]{10,13})/i)?.[1] || ''
  if (ruc && doc.shipper) doc.shipper.ruc = ruc
  const shared = doc.containers.map((c) => c.description).find(Boolean) || ''
  doc.containers.forEach((c) => {
    if (!c.description) c.description = shared
  })
  if (doc.totals.netKg != null && doc.totals.netKg < 1000) doc.totals.netKg = null
  if (doc.totals.grossKg != null && doc.totals.grossKg < 1000) doc.totals.grossKg = null
  doc.kind = 'mbl'
  doc.extras = {
    ruc,
    freightCollect: /FREIGHT COLLECT/i.test(text),
    shippedOnBoard: /SHIPPED ON BOARD/i.test(text),
    hqLine: text.match(/\d+\s*X\s*\d+\s*(?:ST|HQ|GP|DRY)\b[^\n]{0,80}/i)?.[0] || '',
  }
  return doc
}

export function parseMblFromPlainText(text, fileName, page1Words = []) {
  const carrier = detectCarrier(fileName, text) || 'unknown'
  if (carrier === 'one') return parseOne(text, fileName, page1Words)
  if (carrier === 'cosco') return parseCosco(text, fileName)
  if (carrier === 'zim') return parseZim(text, fileName, page1Words)
  if (/COSU\d{10}|COSCO SHIPPING/i.test(text)) return parseCosco(text, fileName)
  if (/ONEY[A-Z0-9]{10,}|OCEAN NETWORK EXPRESS/i.test(text)) return parseOne(text, fileName, page1Words)
  if (/ZIMU[A-Z]{2,5}\d+/i.test(text)) return parseZim(text, fileName)
  return parseCosco(text, fileName)
}

export function parseMblFromPdfPages(pages, fileName) {
  const text = pages.map((p) => p.text).join('\n')
  return parseMblFromPlainText(text, fileName, pages[0]?.words || [])
}
