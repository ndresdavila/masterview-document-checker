import {
  str,
  canon,
  softenAddress,
  similar,
  numbersClose,
  formatNumber,
  joinLines,
  vesselsMatch,
  voyagesMatch,
  portsMatch,
  joinersConflict,
  contractsMatch,
  commoditiesMatch,
  hsMatch,
  lotesMatch,
  sealsMatch,
  bookingsMatch,
} from './normalize.js'

function bagsTotal(doc) {
  const labeled = doc?.totals?.bags
  if (labeled != null && labeled > 0) return labeled
  const pkgs = (doc?.containers || []).map((c) => c.pkgs).filter((n) => n != null)
  if (pkgs.length && pkgs.length === (doc.containers || []).length) {
    const sum = pkgs.reduce((s, n) => s + n, 0)
    return sum > 0 ? sum : null
  }
  return null
}

function partyText(party) {
  if (!party) return ''
  return joinLines(party.lines?.length ? party.lines : [party.name, party.address])
}

function splitPartyBlocks(party) {
  const lines = (party?.lines || []).map(str).filter(Boolean)
  const startRe = /^(721\s+LOGISTICS|BLOMMER|MACQUARIE|ITOCHU|DEPENDABLE|SUDESPENSA|BRAUNER)/i
  const blocks = []
  let cur = []
  for (const l of lines) {
    if (cur.length && startRe.test(l)) {
      blocks.push(cur)
      cur = [l]
    } else {
      cur.push(l)
    }
  }
  if (cur.length) blocks.push(cur)
  return blocks
}

function display(value) {
  if (value == null || value === '') return '—'
  return str(value)
}

function cleanMarks(text) {
  return str(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^(marks?|marcas):?\s*/i, '').replace(/^sps\s+/i, '').trim())
    .filter((l) => {
      if (!l) return false
      if (/^(container|contenedor|seals?):/i.test(l)) return false
      if (/^[A-Z]{4}\d{6,8}$/i.test(l)) return false
      if (/^\d{7,8}$/.test(l)) return false
      if (/containers nos/i.test(l)) return false
      if (/^sps$/i.test(l)) return false
      if (/^sps\d/i.test(l)) return false
      if (/\d+[.,]\d+\s*K\.?\s*[NB]\b/i.test(l)) return false
      if (/^product of ecuador$/i.test(l)) return false
      if (/total bags|total net|total gross|^hs code|^dae|^freight collect|freight\s*&\s*charges/i.test(l)) return false
      if (/if no value|declared liability|clause \d|received by carrier|freight payable|shippers declared|in witness|place and date of issue|your cargo/i.test(l)) return false
      if (/^naviera:|^shipper:|^p\.a\s*:/i.test(l)) return false
      return true
    })
    .join(' ')
    .replace(/^\s*SPS\s+/i, '')
    .replace(/\b(?:PRODUCT\s+)?OF ECUADOR\b/gi, ' ')
    .replace(/\b(?:CERTIFIED\s+)?(?:TYPE\s+)?GRADE\s+\d(?:\s+RFA)?/gi, ' ')
    .replace(/\bDAE:?\s*[\d-]+/gi, ' ')
    .replace(/\b028-\d{4}-\d{2}-\d+/g, ' ')
    .replace(/\bLOTE#?\s*[A-Z0-9-]+/gi, ' ')
    .replace(/\b(?:NEW YORK|PHILADELPHIA|OAKLAND|UNITED STATES|USA)\b/gi, ' ')
    .replace(/\bSUSTAINABLE ORIGINS MASS BALANCE\b/gi, ' ')
    .replace(/\bCACAO EN GRANO ECUATORIANO\b/gi, ' ')
    .replace(/\bMARCAS:?\b/gi, ' ')
    .replace(/\bCV:?\s*[\d-]+(?:\s+[\d-]+)*/gi, ' ')
    .replace(/\d+[.,]\d+\s*K\.?\s*[NB]\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compareText({ id, group, label, a, b, mode = 'text', note }) {
  const pa = display(a)
  const pb = display(b)
  const emptyA = pa === '—'
  const emptyB = pb === '—'

  if (emptyA && emptyB) {
    return { id, group, label, proforma: pa, hbl: pb, status: 'skip', detail: note }
  }

  if (!emptyA && !emptyB && mode !== 'number' && mode !== 'seal' && mode !== 'hs' && joinersConflict(a, b)) {
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: 'mismatch',
      detail: 'Guion vs coma: no son equivalentes',
    }
  }

  if (mode === 'number') {
    if (emptyA || emptyB) {
      return {
        id, group, label, proforma: pa, hbl: pb,
        status: emptyA && !emptyB ? 'extra' : 'mismatch',
        detail: emptyA ? 'Solo aparece en el HBL' : 'Falta en el HBL',
      }
    }
    const ok = numbersClose(a, b)
    return {
      id, group, label,
      proforma: formatNumber(a),
      hbl: formatNumber(b),
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Coincide' : `Proforma ${formatNumber(a)} vs HBL ${formatNumber(b)}`,
    }
  }

  if (mode === 'port') {
    const ok = portsMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Equivalente' : 'Puertos distintos',
    }
  }

  if (mode === 'vessel') {
    if (emptyA && !emptyB) {
      return {
        id, group, label, proforma: pa, hbl: pb,
        status: 'warning',
        detail: 'El HBL trae buque; la celda Vessel de la proforma está vacía',
      }
    }
    const ok = vesselsMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Mismo buque' : 'Buques distintos',
    }
  }

  if (mode === 'commodity') {
    const ok = commoditiesMatch(a, b)
    return {
      id, group, label,
      proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Misma mercancía' : 'Mercancía distinta',
    }
  }

  if (mode === 'contract') {
    if (!emptyA && emptyB) {
      return { id, group, label, proforma: pa, hbl: pb, status: 'warning', detail: 'No aparece en la carátula del HBL' }
    }
    const ok = contractsMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Coincide' : 'Valores distintos',
    }
  }

  if (mode === 'ref') {
    if (!emptyA && emptyB) {
      return { id, group, label, proforma: pa, hbl: pb, status: 'warning', detail: 'No aparece en la carátula del HBL' }
    }
  }

  if (mode === 'hs') {
    if (!emptyA && emptyB) {
      return { id, group, label, proforma: pa, hbl: pb, status: 'warning', detail: 'No aparece en la carátula del HBL' }
    }
    const ok = hsMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Mismo código' : 'HS distintos',
    }
  }

  if (mode === 'lote') {
    if (!emptyA && emptyB) {
      return { id, group, label, proforma: pa, hbl: pb, status: 'warning', detail: 'No aparece en la carátula del HBL' }
    }
    const ok = lotesMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Coincide' : 'Lotes distintos',
    }
  }

  if (mode === 'seal') {
    if (emptyA || emptyB) {
      return {
        id, group, label, proforma: pa, hbl: pb,
        status: emptyA && !emptyB ? 'extra' : 'mismatch',
        detail: emptyA ? 'Solo aparece en el HBL' : 'Falta en el HBL',
      }
    }
    const ok = sealsMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Mismo sello' : 'Sellos distintos',
    }
  }

  if (mode === 'voyage') {
    if (emptyA && emptyB) {
      return { id, group, label, proforma: pa, hbl: pb, status: 'skip', detail: note }
    }
    if (emptyA && !emptyB) {
      return {
        id, group, label, proforma: pa, hbl: pb,
        status: 'warning',
        detail: 'El HBL trae voyage; la celda de la proforma está vacía',
      }
    }
    const ok = voyagesMatch(a, b)
    return {
      id, group, label, proforma: pa, hbl: pb,
      status: ok ? 'match' : 'mismatch',
      detail: ok ? 'Coincide' : 'Valores distintos',
    }
  }

  if (mode === 'address') {
    if (emptyA || emptyB) {
      if (id === 'marks' && !emptyA && emptyB) {
        return { id, group, label, proforma: pa, hbl: pb, status: 'warning', detail: 'No se ve el bloque de marcas en la carátula' }
      }
      return { id, group, label, proforma: pa, hbl: pb, status: 'mismatch', detail: 'Falta el bloque' }
    }
    const exact = canon(a) === canon(b)
    const soft = softenAddress(a) === softenAddress(b) || similar(softenAddress(a), softenAddress(b)) >= 0.9
    const contained = (() => {
      const sa = softenAddress(a)
      const sb = softenAddress(b)
      if (sa.length < 18 || sb.length < 18) return false
      return sa.includes(sb) || sb.includes(sa)
    })()
    const marksClose = id === 'marks' && similar(a, b) >= 0.62
    const close = similar(a, b) >= 0.78
    let status = 'mismatch'
    let detail = 'No coincide'
    if (exact) { status = 'match'; detail = 'Coincide' }
    else if (soft || contained || marksClose) { status = 'match'; detail = 'Misma información, redacción equivalente' }
    else if (close) { status = 'warning'; detail = 'Texto similar' }
    return { id, group, label, proforma: pa, hbl: pb, status, detail }
  }

  if (emptyA && !emptyB) {
    return { id, group, label, proforma: pa, hbl: pb, status: 'extra', detail: note || 'Dato asignado en el HBL' }
  }
  if (!emptyA && emptyB) {
    return { id, group, label, proforma: pa, hbl: pb, status: 'mismatch', detail: 'Falta en el HBL' }
  }
  const ok = canon(a) === canon(b)
  return {
    id, group, label, proforma: pa, hbl: pb,
    status: ok ? 'match' : 'mismatch',
    detail: ok ? 'Coincide' : 'Valores distintos',
  }
}

function matchContainers(proformaList = [], hblList = []) {
  const items = []
  const used = new Set()
  proformaList.forEach((p, idx) => {
    let hit = hblList.findIndex((h, i) => !used.has(i) && canon(h.id) === canon(p.id))
    if (hit < 0) {
      hit = hblList.findIndex((h, i) => {
        if (used.has(i)) return false
        const A = canon(p.id).replace(/\s+/g, '')
        const B = canon(h.id).replace(/\s+/g, '')
        if (A.slice(0, 4) !== B.slice(0, 4) || A.length < 10 || B.length < 10) return false
        return similar(A, B) >= 0.8
      })
    }
    if (hit < 0) {
      hit = hblList.findIndex((h, i) => !used.has(i) && p.id && h.id && similar(h.id, p.id) >= 0.88)
    }
    const h = hit >= 0 ? hblList[hit] : null
    if (hit >= 0) used.add(hit)
    const tag = p.id || `cont-${idx + 1}`
    items.push(
      compareText({
        id: `ctr-${tag}-id`,
        group: 'Contenedores',
        label: 'Contenedor',
        a: p.id,
        b: h?.id,
      }),
      compareText({
        id: `ctr-${tag}-seal`,
        group: 'Contenedores',
        label: `${tag} · sello`,
        a: p.seal,
        b: h?.seal,
        mode: 'seal',
      }),
      compareText({
        id: `ctr-${tag}-pkgs`,
        group: 'Contenedores',
        label: `${tag} · bultos`,
        a: p.pkgs,
        b: h?.pkgs,
        mode: 'number',
      }),
      compareText({
        id: `ctr-${tag}-desc`,
        group: 'Contenedores',
        label: `${tag} · mercancía`,
        a: p.description,
        b: h?.description,
        mode: 'commodity',
      }),
      compareText({
        id: `ctr-${tag}-net`,
        group: 'Contenedores',
        label: `${tag} · neto kg`,
        a: p.netKg,
        b: h?.netKg,
        mode: 'number',
      }),
      compareText({
        id: `ctr-${tag}-gross`,
        group: 'Contenedores',
        label: `${tag} · bruto kg`,
        a: p.grossKg,
        b: h?.grossKg,
        mode: 'number',
      }),
    )
    if (!h) {
      items[items.length - 6].status = 'mismatch'
      items[items.length - 6].detail = 'No está en el HBL'
    }
  })

  hblList.forEach((h, i) => {
    if (used.has(i)) return
    items.push({
      id: `ctr-extra-${h.id}`,
      group: 'Contenedores',
      label: 'Contenedor extra en HBL',
      proforma: '—',
      hbl: h.id,
      status: 'mismatch',
      detail: 'Aparece en el HBL y no en la proforma',
    })
  })
  return items
}

export function compareDocs(proforma, hbl) {
  const items = []

  items.push(
    compareText({
      id: 'shipper',
      group: 'Partes',
      label: 'Shipper',
      a: partyText(proforma.shipper),
      b: partyText(hbl.shipper),
      mode: 'address',
    }),
    compareText({
      id: 'consignee',
      group: 'Partes',
      label: 'Consignee',
      a: partyText(proforma.consignee),
      b: partyText(hbl.consignee),
      mode: 'address',
    }),
    compareText({
      id: 'notify',
      group: 'Partes',
      label: 'Notify party',
      a: partyText(proforma.notify),
      b: partyText(hbl.notify),
      mode: 'address',
    }),
  )

  const notifyItem = items[items.length - 1]
  let secondFromProforma = partyText(proforma.secondNotify)
  if ((notifyItem.status === 'mismatch' || notifyItem.proforma === '—') && secondFromProforma && partyText(hbl.notify)) {
    const blocks = splitPartyBlocks(proforma.secondNotify)
    const firstBlock = blocks[0] ? joinLines(blocks[0]) : secondFromProforma
    const fromSecond = compareText({
      id: 'notify',
      group: 'Partes',
      label: 'Notify party',
      a: firstBlock,
      b: partyText(hbl.notify),
      mode: 'address',
    })
    if (fromSecond.status === 'match' || fromSecond.status === 'warning') {
      notifyItem.status = 'relocated'
      notifyItem.proforma = fromSecond.proforma
      notifyItem.hbl = fromSecond.hbl
      notifyItem.detail = 'En la proforma iba en Second Notify; en el HBL está en Notify. Correcto.'
      secondFromProforma = blocks.length > 1 ? joinLines(blocks.slice(1).flat()) : ''
    }
  }

  const second = compareText({
    id: 'second-notify',
    group: 'Ajustes esperados',
    label: 'Second notify',
    a: notifyItem.status === 'relocated' ? secondFromProforma : partyText(proforma.secondNotify),
    b: partyText(hbl.secondNotify),
    mode: 'address',
  })
  if (second.status === 'match') {
    second.status = 'relocated'
    second.detail = 'En la proforma iba en la descripción; en el HBL pasó a su casilla. Correcto.'
  } else if (second.proforma === '—' && second.hbl !== '—') {
    second.status = 'extra'
    second.detail = 'El HBL trae Second Notify; en esta proforma no venía en descripción.'
  }
  items.push(second)

  items.push(
    compareText({
      id: 'booking',
      group: 'Transporte',
      label: 'Booking',
      a: proforma.bookingNo,
      b: hbl.bookingNo,
    }),
    compareText({
      id: 'bl',
      group: 'Transporte',
      label: 'Bill of lading',
      a: proforma.blNo,
      b: hbl.blNo,
      note: 'El HBL asigna el número; no está en la proforma',
    }),
    compareText({
      id: 'vessel',
      group: 'Transporte',
      label: 'Buque',
      a: proforma.vessel,
      b: hbl.vessel,
      mode: 'vessel',
    }),
    compareText({
      id: 'voyage',
      group: 'Transporte',
      label: 'Voyage',
      a: proforma.voyage,
      b: hbl.voyage,
      mode: 'voyage',
    }),
    compareText({
      id: 'pol',
      group: 'Transporte',
      label: 'Puerto de carga',
      a: proforma.portLoading,
      b: hbl.portLoading,
      mode: 'port',
    }),
    compareText({
      id: 'pod',
      group: 'Transporte',
      label: 'Puerto de descarga',
      a: proforma.portDischarge,
      b: hbl.portDischarge,
      mode: 'port',
    }),
    compareText({
      id: 'lote',
      group: 'Carga y marcas',
      label: 'Lote',
      a: proforma.marks?.lote,
      b: hbl.marks?.lote,
      mode: 'lote',
    }),
    compareText({
      id: 'marks',
      group: 'Carga y marcas',
      label: 'Marcas',
      a: cleanMarks(proforma.marks?.text),
      b: cleanMarks(hbl.marks?.text),
      mode: 'address',
    }),
  )

  items.push(...matchContainers(proforma.containers, hbl.containers))

  items.push(
    compareText({
      id: 'bags',
      group: 'Totales y referencias',
      label: 'Total bags',
      a: bagsTotal(proforma),
      b: bagsTotal(hbl),
      mode: 'number',
    }),
    compareText({
      id: 'net',
      group: 'Totales y referencias',
      label: 'Peso neto',
      a: proforma.totals?.netKg,
      b: hbl.totals?.netKg,
      mode: 'number',
    }),
    compareText({
      id: 'gross',
      group: 'Totales y referencias',
      label: 'Peso bruto',
      a: proforma.totals?.grossKg,
      b: hbl.totals?.grossKg,
      mode: 'number',
    }),
    compareText({
      id: 'cbm',
      group: 'Totales y referencias',
      label: 'Medida CBM',
      a: proforma.totals?.cbm,
      b: hbl.totals?.cbm,
      mode: 'number',
    }),
    compareText({
      id: 'hs',
      group: 'Totales y referencias',
      label: 'HS code',
      a: proforma.refs?.hsCode,
      b: hbl.refs?.hsCode,
      mode: 'hs',
    }),
    compareText({
      id: 'fda',
      group: 'Totales y referencias',
      label: 'FDA',
      a: proforma.refs?.fda,
      b: hbl.refs?.fda,
      mode: 'ref',
    }),
    compareText({
      id: 'dae',
      group: 'Totales y referencias',
      label: 'DAE',
      a: proforma.refs?.dae,
      b: hbl.refs?.dae,
      mode: 'ref',
    }),
    compareText({
      id: 'contract',
      group: 'Totales y referencias',
      label: 'Contract',
      a: proforma.refs?.contract,
      b: hbl.refs?.contract,
      mode: 'contract',
    }),
  )

  const proformaRuc = proforma.shipper?.ruc || proforma.extras?.ruc || ''
  const hblRuc = hbl.shipper?.ruc || hbl.extras?.ruc || ''
  if (proformaRuc || hblRuc) {
    items.push(
      compareText({
        id: 'ruc',
        group: proformaRuc && hblRuc ? 'Partes' : 'Ajustes esperados',
        label: 'RUC del shipper',
        a: proformaRuc,
        b: hblRuc,
        note: 'El HBL añade el RUC; no forma parte de la proforma',
      }),
    )
  }

  const freightBits = [hbl.extras?.freightCollect && 'FREIGHT COLLECT', hbl.extras?.shippedOnBoard && 'SHIPPED ON BOARD']
    .filter(Boolean)
  items.push({
    id: 'freight-collect',
    group: 'Ajustes esperados',
    label: 'FREIGHT COLLECT / SHIPPED ON BOARD',
    proforma: 'No va en la proforma',
    hbl: freightBits.join('\n') || '—',
    status: freightBits.length ? (freightBits.length === 2 ? 'relocated' : 'extra') : 'warning',
    detail: freightBits.length
      ? 'Frases propias del HBL. No se contrastan contra la proforma.'
      : 'No consta en el HBL.',
  })

  if (hbl.extras?.hqLine) {
    items.push({
      id: 'hq',
      group: 'Ajustes esperados',
      label: 'Tipo de equipo',
      proforma: '—',
      hbl: hbl.extras.hqLine,
      status: 'extra',
      detail: 'Línea de equipo (Nx40HQ STC) que el HBL agrega a la descripción',
    })
  }

  const visible = items.filter((i) => i.status !== 'skip')
  const mismatches = visible.filter((i) => i.status === 'mismatch')
  const warnings = visible.filter((i) => i.status === 'warning')
  const matches = visible.filter((i) => i.status === 'match')
  const expected = visible.filter((i) => i.status === 'relocated' || i.status === 'extra')
  const scored = visible.filter((i) => ['match', 'mismatch', 'warning', 'relocated'].includes(i.status))
  const good = scored.filter((i) => i.status === 'match' || i.status === 'relocated').length
  const score = scored.length ? Math.round((good / scored.length) * 100) : 0

  return {
    score,
    items: visible,
    counts: {
      match: matches.length,
      mismatch: mismatches.length,
      warning: warnings.length,
      expected: expected.length,
    },
  }
}

function isNvoccParty(party) {
  const t = partyText(party).toUpperCase()
  return /MASTERVIEW|UCC LOGISTICS|UCC AMERICA|UCCLOG/.test(t)
}

function isHouseBl(value) {
  return /^ULGO/i.test(str(value))
}

function isMasterBl(value) {
  return /^(ZIMU|ONEY|COSU)/i.test(str(value))
}

function partyPlain(party) {
  return partyText(party)
    .replace(/RUC:?\s*\d+/gi, ' ')
    .replace(/\bCORABASOS\b/g, 'CORABASTOS')
    .replace(/\bCORABATOS\b/g, 'CORABASTOS')
    .replace(/[-,]/g, ' ')
    .replace(/\bSH>\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function partyCompare(id, label, left, right) {
  const item = compareText({
    id,
    group: 'Partes',
    label,
    a: partyPlain(left),
    b: partyPlain(right),
    mode: 'address',
  })
  if (item.status === 'mismatch' && isNvoccParty(right) && !isNvoccParty(left)) {
    item.status = 'relocated'
    item.detail = 'El MBL lleva a Masterview / UCC (master); el HBL lleva al exportador o comprador. Correcto.'
  }
  if (item.status === 'mismatch') {
    const sa = softenAddress(partyPlain(left))
    const sb = softenAddress(partyPlain(right))
    if (sa && sb && similar(sa, sb) >= 0.82) {
      item.status = 'match'
      item.detail = 'Misma parte, redacción equivalente'
    } else if (/SUDESPENSA/i.test(sa) && /SUDESPENSA/i.test(sb)) {
      item.status = 'match'
      item.detail = 'Misma parte, redacción equivalente'
    }
  }
  if (item.status === 'mismatch' && isNvoccParty(left) && isNvoccParty(right)) {
    const ok = similar(softenAddress(partyText(left)), softenAddress(partyText(right))) >= 0.62
    if (ok) {
      item.status = 'match'
      item.detail = 'Misma parte NVOCC, redacción equivalente'
    }
  }
  return item
}

export function compareHblMbl(hbl, mbl) {
  const items = []
  const wordingRight = 'MBL'

  items.push(
    partyCompare('shipper', 'Shipper', hbl.shipper, mbl.shipper),
    partyCompare('consignee', 'Consignee', hbl.consignee, mbl.consignee),
    partyCompare('notify', 'Notify party', hbl.notify, mbl.notify),
  )

  const booking = compareText({
    id: 'booking',
    group: 'Transporte',
    label: 'Booking',
    a: hbl.bookingNo,
    b: mbl.bookingNo,
  })
  if (booking.proforma !== '—' && booking.hbl !== '—' && bookingsMatch(hbl.bookingNo, mbl.bookingNo)) {
    booking.status = 'match'
    booking.detail = 'Mismo booking'
  }
  items.push(booking)

  const bl = compareText({
    id: 'bl',
    group: 'Transporte',
    label: 'Bill of lading',
    a: hbl.blNo,
    b: mbl.blNo,
    note: 'El MBL usa el número de la naviera',
  })
  if (bl.proforma !== '—' && bl.hbl !== '—') {
    if (canon(hbl.blNo) === canon(mbl.blNo) || bookingsMatch(hbl.blNo, mbl.blNo)) {
      bl.status = 'match'
      bl.detail = 'Coincide'
    } else if (isHouseBl(hbl.blNo) && isMasterBl(mbl.blNo)) {
      bl.status = 'relocated'
      bl.detail = 'House vs master: numeración distinta por diseño.'
    }
  }
  items.push(bl)

  items.push(
    compareText({
      id: 'vessel',
      group: 'Transporte',
      label: 'Buque',
      a: hbl.vessel,
      b: mbl.vessel,
      mode: 'vessel',
    }),
    compareText({
      id: 'voyage',
      group: 'Transporte',
      label: 'Voyage',
      a: hbl.voyage,
      b: mbl.voyage,
      mode: 'voyage',
    }),
    compareText({
      id: 'pol',
      group: 'Transporte',
      label: 'Puerto de carga',
      a: hbl.portLoading,
      b: mbl.portLoading,
      mode: 'port',
    }),
    compareText({
      id: 'pod',
      group: 'Transporte',
      label: 'Puerto de descarga',
      a: hbl.portDischarge,
      b: mbl.portDischarge,
      mode: 'port',
    }),
    compareText({
      id: 'lote',
      group: 'Carga y marcas',
      label: 'Lote',
      a: hbl.marks?.lote,
      b: mbl.marks?.lote,
      mode: 'lote',
    }),
  )

  const marks = compareText({
    id: 'marks',
    group: 'Carga y marcas',
    label: 'Marcas',
    a: cleanMarks(hbl.marks?.text),
    b: cleanMarks(mbl.marks?.text),
    mode: 'address',
  })
  const mblMarks = str(mbl.marks?.text)
  const hblMarksEmpty = marks.proforma === '—'
  const mblMarksEmpty = marks.hbl === '—' || /^N\/M$/i.test(mblMarks) || /^N\/M$/i.test(cleanMarks(mbl.marks?.text))
  if (hblMarksEmpty && mblMarksEmpty) {
    marks.status = 'skip'
  } else if (marks.status === 'mismatch' && !hblMarksEmpty && mblMarksEmpty) {
    marks.status = 'warning'
    marks.detail = 'El MBL no detalla marcas (N/M o casilla de naviera)'
  } else if (marks.status === 'mismatch' && hblMarksEmpty && !mblMarksEmpty) {
    marks.status = 'extra'
    marks.detail = 'Solo aparece en el MBL'
  }
  items.push(marks)

  const containerItems = matchContainers(hbl.containers, mbl.containers)
  containerItems.forEach((item) => {
    if (item.detail === 'No está en el HBL') item.detail = `No está en el ${wordingRight}`
    if (item.detail === 'Aparece en el HBL y no en la proforma') {
      item.label = `Contenedor extra en el ${wordingRight}`
      item.detail = `Aparece en el ${wordingRight} y no en el HBL`
    }
    if (item.detail === 'Falta en el HBL') item.detail = `Falta en el ${wordingRight}`
    if (item.detail === 'Solo aparece en el HBL') item.detail = `Solo aparece en el ${wordingRight}`
  })
  items.push(...containerItems)

  items.push(
    compareText({
      id: 'bags',
      group: 'Totales y referencias',
      label: 'Total bultos',
      a: bagsTotal(hbl),
      b: bagsTotal(mbl),
      mode: 'number',
    }),
    compareText({
      id: 'net',
      group: 'Totales y referencias',
      label: 'Peso neto',
      a: hbl.totals?.netKg,
      b: mbl.totals?.netKg,
      mode: 'number',
    }),
    compareText({
      id: 'gross',
      group: 'Totales y referencias',
      label: 'Peso bruto',
      a: hbl.totals?.grossKg,
      b: mbl.totals?.grossKg,
      mode: 'number',
    }),
    compareText({
      id: 'cbm',
      group: 'Totales y referencias',
      label: 'Medida CBM',
      a: hbl.totals?.cbm,
      b: mbl.totals?.cbm,
      mode: 'number',
    }),
    compareText({
      id: 'hs',
      group: 'Totales y referencias',
      label: 'HS code',
      a: hbl.refs?.hsCode,
      b: mbl.refs?.hsCode,
      mode: 'hs',
    }),
    compareText({
      id: 'fda',
      group: 'Totales y referencias',
      label: 'FDA',
      a: hbl.refs?.fda,
      b: mbl.refs?.fda,
      mode: 'ref',
    }),
    compareText({
      id: 'dae',
      group: 'Totales y referencias',
      label: 'DAE',
      a: hbl.refs?.dae,
      b: mbl.refs?.dae,
      mode: 'ref',
    }),
    compareText({
      id: 'contract',
      group: 'Totales y referencias',
      label: 'Contract',
      a: hbl.refs?.contract,
      b: mbl.refs?.contract,
      mode: 'contract',
    }),
  )

  items.forEach((item) => {
    if (['contract', 'hs', 'fda', 'dae'].includes(item.id) && item.proforma === '—' && item.hbl !== '—' && item.status === 'mismatch') {
      item.status = 'extra'
      item.detail = 'Solo aparece en el MBL'
    }
    if (item.id?.includes('-desc') && item.status === 'mismatch') {
      const left = cleanMarks(item.proforma)
      const right = str(item.hbl)
      if ((!left || left === '—') && right) {
        item.status = 'extra'
        item.detail = 'Descripción detallada en el MBL'
      } else if (/COCOA|BEANS|CACAO/i.test(left) && /COCOA|BEANS|CACAO/i.test(right)) {
        item.status = 'match'
        item.detail = 'Misma mercancía'
      } else if (left && /(?:BOXES|CARTONS|BAGS)/i.test(right) && /COCOA|ATUN|PESCADO|CONSERVAS|BEANS|CAJAS|LOMITOS/i.test(left)) {
        item.status = 'match'
        item.detail = 'Misma mercancía'
      }
    }
    if ((item.id === 'pol' || item.id === 'pod') && item.status === 'mismatch') {
      const cities = /GUAYAQUIL|BUENAVENTURA|NEW YORK|OAKLAND|HALIFAX|SAVANNAH|PHILADELPHIA|POSORJA|MANTA/
      const A = String(item.proforma).toUpperCase()
      const B = String(item.hbl).toUpperCase()
      const hit = A.match(cities)?.[0]
      if (hit && B.includes(hit)) {
        item.status = 'match'
        item.detail = 'Equivalente'
      }
    }
    if (['net', 'cbm'].includes(item.id) && item.status === 'mismatch' && item.hbl === '—') {
      item.status = 'warning'
      item.detail = 'No aparece en el MBL'
    }
    if (item.id === 'dae' && item.status === 'mismatch' && item.proforma !== '—' && item.hbl !== '—') {
      const A = str(hbl.refs?.dae).replace(/\s/g, '')
      const B = str(mbl.refs?.dae).replace(/\s/g, '')
      if (A && B && (A.startsWith(B) || B.startsWith(A))) {
        item.status = 'match'
        item.detail = 'Mismo DAE'
      }
    }
    if (item.id?.includes('-net') && item.status === 'mismatch' && item.hbl === '—') {
      item.status = 'warning'
      item.detail = 'El MBL no desglosa el neto de este contenedor'
    }
    if (item.detail === 'Falta en el HBL') item.detail = `Falta en el ${wordingRight}`
    if (item.detail === 'Solo aparece en el HBL') item.detail = `Solo aparece en el ${wordingRight}`
    if (item.detail === 'Dato asignado en el HBL') item.detail = `Dato asignado en el ${wordingRight}`
    if (item.detail === 'El HBL trae buque; la celda Vessel de la proforma está vacía') {
      item.detail = 'El MBL trae buque; el HBL no'
    }
    if (item.detail === 'El HBL trae voyage; la celda de la proforma está vacía') {
      item.detail = 'El MBL trae voyage; el HBL no'
    }
    if (item.detail === 'No aparece en la carátula del HBL') {
      item.detail = `No aparece en el ${wordingRight}`
    }
  })

  const freightBits = [mbl.extras?.freightCollect && 'FREIGHT COLLECT', mbl.extras?.shippedOnBoard && 'SHIPPED ON BOARD']
    .filter(Boolean)
  items.push({
    id: 'freight-collect',
    group: 'Ajustes esperados',
    label: 'FREIGHT COLLECT / SHIPPED ON BOARD',
    proforma: 'Propio del HBL / MBL',
    hbl: freightBits.join('\n') || '—',
    status: freightBits.length ? 'extra' : 'skip',
    detail: 'Frases de la naviera. No se contrastan como incongruencia.',
  })

  const visible = items.filter((i) => i.status !== 'skip')
  const mismatches = visible.filter((i) => i.status === 'mismatch')
  const warnings = visible.filter((i) => i.status === 'warning')
  const matches = visible.filter((i) => i.status === 'match')
  const expected = visible.filter((i) => i.status === 'relocated' || i.status === 'extra')
  const scored = visible.filter((i) => ['match', 'mismatch', 'warning', 'relocated'].includes(i.status))
  const good = scored.filter((i) => i.status === 'match' || i.status === 'relocated').length
  const score = scored.length ? Math.round((good / scored.length) * 100) : 0

  return {
    score,
    items: visible,
    carrier: mbl.carrier || '',
    pair: 'hbl-mbl',
    counts: {
      match: matches.length,
      mismatch: mismatches.length,
      warning: warnings.length,
      expected: expected.length,
    },
  }
}

export const GROUPS = [
  'Partes',
  'Transporte',
  'Contenedores',
  'Carga y marcas',
  'Totales y referencias',
  'Ajustes esperados',
]
