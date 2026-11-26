import assert from 'node:assert/strict'
import test from 'node:test'
import { compareHblSwb } from './compare.js'
import { parseSwbFromPdfPages } from './parseSwb.js'
import { joinPositionedChunks, loteCanon, lotesMatch, sealTokens } from './normalize.js'

// SWB ZIMUGYL811957: el PDF pinta LOTE#SGE3902026, pero el texto sale en dos
// trozos de fuentes distintas que se tocan (hueco de 0.03pt).
const SWB_MARKS = [
  { str: 'SAN GERARDO', x: 22.8, y: 454.68, width: 41.11 },
  { str: 'PRODUCT OF ECUADOR', x: 22.8, y: 464.4, width: 66.05 },
  { str: 'GRADE 3', x: 22.8, y: 474.12, width: 24.32 },
  { str: '64.50 K.N', x: 22.8, y: 483.84, width: 25.46 },
  { str: '65.00 K.B.', x: 22.8, y: 493.56, width: 25.9 },
  { str: 'LOTE#SGE39', x: 22.8, y: 503.28, width: 34.55 },
  { str: '02026', x: 57.38, y: 503.28, width: 16.5 },
  { str: 'NEW YORK', x: 22.8, y: 513, width: 30.39 },
  { str: 'UNITED STATES', x: 22.8, y: 522.72, width: 42.71 },
]

function hblFor811957() {
  return {
    shipper: { lines: ['SAN GERARDO DEL ECUADOR S.A.'] },
    consignee: { lines: ['BUYER'] },
    notify: { lines: ['NOTIFY'] },
    secondNotify: { lines: [] },
    bookingNo: 'ZIMUGYL811957',
    blNo: 'ULGO26US00395',
    vessel: 'SL FALCON',
    voyage: '119N',
    portLoading: 'GUAYAQUIL',
    portDischarge: 'NEW YORK',
    containers: [],
    marks: {
      text: 'SAN GERARDO\nPRODUCT OF ECUADOR\nGRADE 3\n64.50 K.N\n65.00 K.B.\nLOTE#SGE3902026\nNEW YORK\nUNITED STATES',
      lote: 'SGE3902026',
      lines: [],
    },
    totals: {},
    refs: {},
    extras: {},
  }
}

test('el lote del SWB ZIMUGYL811957 se lee SGE3902026 aunque el PDF lo parta', () => {
  const swb = parseSwbFromPdfPages([{ words: SWB_MARKS, text: '' }], 'HBL ULGO26US00395 - SWB (1).pdf')
  assert.equal(swb.marks.lote, 'SGE3902026')
  assert.equal(swb.marks.text.includes('LOTE#SGE3902026'), true)
  assert.equal(swb.marks.text.includes('SGE39 02026'), false)

  const result = compareHblSwb(hblFor811957(), swb)
  const lote = result.items.find((item) => item.id === 'lote')
  const marks = result.items.find((item) => item.id === 'marks')
  assert.equal(lote.status, 'match')
  assert.equal(lote.hbl, 'SGE3902026')
  assert.equal(lote.proforma, 'SGE3902026')
  assert.equal(marks.status, 'match')
  assert.equal(marks.hbl.includes('02026'), false)
  assert.equal(marks.proforma, 'SAN GERARDO')
  assert.equal(marks.hbl, 'SAN GERARDO')
})

test('un lote partido por un espacio sigue coincidiendo, y uno distinto no', () => {
  assert.equal(loteCanon('SGE39 02026'), 'SGE3902026')
  assert.equal(loteCanon('LOTE#SGE39 02026'), 'SGE3902026')
  assert.equal(lotesMatch('SGE3902026', 'SGE39 02026'), true)
  assert.equal(lotesMatch('SGE39 02026', '02026'), false)
  assert.equal(lotesMatch('SGE3902026', '02026'), false)
  assert.equal(lotesMatch('2608262', '2608263'), false)
  assert.equal(lotesMatch('047', '47'), true)
  assert.equal(loteCanon('LOTE#123 LOTE#456'), '123')
  assert.equal(loteCanon('047 SOMETHING'), '047')
  assert.equal(lotesMatch('047', '047 SOMETHING'), true)
})

test('los trozos que se tocan se pegan y un hueco de verdad no junta sello, peso ni contenedor', () => {
  assert.equal(joinPositionedChunks([
    { str: 'LOTE#SGE39', x: 22.8, y: 503.28, width: 34.55 },
    { str: '02026', x: 57.38, y: 503.28, width: 16.5 },
  ]), 'LOTE#SGE3902026')

  // Sin ancho se conserva el espacio, como en las líneas armadas a mano.
  assert.equal(joinPositionedChunks([
    { str: 'LOTE#SGE39', x: 22.8, y: 503.28 },
    { str: '02026', x: 23, y: 503.28 },
  ]), 'LOTE#SGE39 02026')

  const sealLine = joinPositionedChunks([
    { str: 'A4251051930', x: 20, y: 400, width: 55 },
    { str: '25,228.50', x: 78, y: 400, width: 40 },
    { str: 'KG', x: 121, y: 400, width: 10 },
  ])
  assert.equal(sealLine, 'A4251051930 25,228.50 KG')
  assert.deepEqual(sealTokens(sealLine), ['A4251051930'])

  assert.equal(joinPositionedChunks([
    { str: 'JXLU6135410', x: 20, y: 420, width: 60 },
    { str: '390', x: 88, y: 420, width: 15 },
  ]), 'JXLU6135410 390')

  // 1.5pt ya es un hueco, no un corte de fuente.
  assert.equal(joinPositionedChunks([
    { str: 'SEAL', x: 10, y: 430, width: 20 },
    { str: '1234567', x: 31.5, y: 430, width: 30 },
  ]), 'SEAL 1234567')
})
