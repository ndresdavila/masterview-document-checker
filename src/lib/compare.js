import {
  str,
  canon,
  softenAddress,
  similar,
  numbersClose,
  formatNumber,
  commodityCanon,
  joinLines,
  vesselsMatch,
  portsMatch,
  contractsMatch,
  commoditiesMatch,
  hsMatch,
  lotesMatch,
  sealsMatch,
} from './normalize.js'

function bagsTotal(doc) {
  if (doc?.totals?.bags != null) return doc.totals.bags
  const pkgs = (doc?.containers || []).map((c) => c.pkgs).filter((n) => n != null)
  if (pkgs.length && pkgs.length === (doc.containers || []).length) {
    return pkgs.reduce((sum, n) => sum + n, 0)
  }
  return null
}

function partyText(party) {
  if (!party) return ''
  return joinLines(party.lines?.length ? party.lines : [party.name, party.address])
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
    .replace(/\bPRODUCT OF ECUADOR\b/gi, ' ')
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
        a: commodityCanon(p.description),
        b: commodityCanon(h?.description),
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

  const second = compareText({
    id: 'second-notify',
    group: 'Ajustes esperados',
    label: 'Second notify',
    a: partyText(proforma.secondNotify),
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

  items.push({
    id: 'freight-collect',
    group: 'Ajustes esperados',
    label: 'FREIGHT COLLECT / SHIPPED ON BOARD',
    proforma: 'No va en la proforma',
    hbl: [hbl.extras?.freightCollect && 'FREIGHT COLLECT', hbl.extras?.shippedOnBoard && 'SHIPPED ON BOARD']
      .filter(Boolean)
      .join('\n') || '—',
    status: hbl.extras?.freightCollect && hbl.extras?.shippedOnBoard ? 'relocated' : 'warning',
    detail:
      hbl.extras?.freightCollect && hbl.extras?.shippedOnBoard
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
  const ok = mismatches.length === 0 && warnings.length === 0

  return {
    ok,
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

export const GROUPS = [
  'Partes',
  'Transporte',
  'Contenedores',
  'Carga y marcas',
  'Totales y referencias',
  'Ajustes esperados',
]
