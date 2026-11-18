import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { compareDocs } from './compare.js'
import { sealTokens } from './normalize.js'
import { parseHblFromPlainText } from './parseHbl.js'
import { parseProformaArrayBuffer } from './parseProforma.js'

const RICE_HBL = `Shipper
PRODUCTOS DEL AGRO SYLVIA MARIA S.A.
AGROSYLMA SA
Booking No.
ZIMUGYL811990

MARCAS:
AGROSYLMA
PAIS ORIGEN
ECUADOR
LOTE#2608262
1776
PACKAGES

1X40HQ CONTAINER STC
1776 PACKAGES
1056 PACKAGES OF WELL-POLISHED WHITE RICE SYLVIA MARIA
NET WEIGHT: 11.975,05
GROSS WEIGHT: 12.355,20
440 PACKAGES BULKS OF WELL-POLISHED WHITE RICE SULTAN MACARENO
NET WEIGHT: 4.989,60
120 PACKAGES OF WELL-POLISHED WHITE RICE SYLVIA MARIA OF 1 KILO
NET WEIGHT: 3.000,00
120 PACKAGES OF WELL-POLISHED WHITE RICE SYLVIA MARIA OF 2 KILOS
NET WEIGHT: 2.880,00
40 PACKAGES OF WELL-POLISHED WHITE RICE SYLVIA MARIA OF 5 KILOS
NET WEIGHT: 1.000,00
TOTAL PACKAGES: 1776
TOTAL NET WEIGHT: 23844,65
TOTAL GROSS WEIGHT: 24725.20
HS CODE: 1006.30.00
`

test('el bloque MARCAS para antes de PACKAGES cuando la descripción no llega al HS CODE', () => {
  const doc = parseHblFromPlainText(RICE_HBL, 'BL FLETADO - ZIMUGYL811990.docx')
  assert.deepEqual(doc.marks.lines, [
    'MARCAS:',
    'AGROSYLMA',
    'PAIS ORIGEN',
    'ECUADOR',
    'LOTE#2608262',
  ])
  assert.equal(doc.marks.text.includes('PACKAGES'), false)
  assert.equal(doc.marks.text.includes('RICE'), false)
  assert.equal(doc.marks.lote, '2608262')

  const proforma = {
    shipper: { lines: [] },
    consignee: { lines: [] },
    notify: { lines: [] },
    secondNotify: { lines: [] },
    bookingNo: 'ZIMUGYL811990',
    blNo: '',
    vessel: '',
    voyage: '',
    portLoading: '',
    portDischarge: '',
    containers: [],
    marks: { text: 'AGROSYLMA\nPAIS ORIGEN\nECUADOR', lote: '2608262', lines: [] },
    totals: {},
    refs: {},
    extras: {},
  }
  const marks = compareDocs(proforma, doc).items.find((item) => item.id === 'marks')
  assert.equal(marks.status, 'match')
  assert.equal(marks.detail, 'Coincide')
})

test('un bloque de marcas que ya cortaba en BAGS no se acorta', () => {
  const stoppedAtBags = parseHblFromPlainText(`MARCAS:
BRANDX
PAIS ORIGEN
ECUADOR
360 BAGS OF RICE
PACKAGES OF SOMETHING THAT SHOULD STAY BECAUSE THE FIRST STOP IS BAGS
HS CODE: 1006
`, 'bags.docx')
  assert.deepEqual(stoppedAtBags.marks, {
    text: 'MARCAS:\nBRANDX\nPAIS\nORIGEN\nECUADOR\n',
    lote: '',
    lines: ['MARCAS:', 'BRANDX', 'PAIS ORIGEN', 'ECUADOR'],
  })

  const packagesBeforeBags = parseHblFromPlainText(`MARCAS:
BRANDX
100 PACKAGES OF RICE NOTE
360 BAGS OF COCOA
HS CODE: 1006.30
`, 'packages-then-bags.docx')
  assert.deepEqual(packagesBeforeBags.marks, {
    text: 'MARCAS:\nBRANDX\n100\nPACKAGES\nOF\nRICE\nNOTE\n',
    lote: '',
    lines: ['MARCAS:', 'BRANDX', '100 PACKAGES OF RICE NOTE'],
  })

  const knownBrand = parseHblFromPlainText(`MARCAS:
GLOBAL-COCOA
PAIS ORIGEN
ECUADOR
LOTE# 047
360 BAGS OF ECUADORIAN COCOA BEANS GRADE 1
NET WEIGHT: 25,200.00 KGS
HS CODE: 1801.00
`, 'cocoa.docx')
  assert.deepEqual(knownBrand.marks, {
    text: 'GLOBAL-COCOA\nPAIS\nORIGEN\nECUADOR\nLOTE#\n047',
    lote: '047',
    lines: ['GLOBAL-COCOA', 'PAIS ORIGEN', 'ECUADOR', 'LOTE# 047'],
  })
})

test('la etiqueta de lote no es un sello y una cifra de 7 dígitos sí', () => {
  for (const label of [
    'LOTE#2611102',
    'LOTE: 2611102',
    'LOTE:2611102',
    'LOTE # 2611102',
    'LOTE 2611102',
    'LOT NO 2611102',
    'LOT NO. 2611102',
    'LOT NUMBER 2611102',
    'LOT NUMBER: 2611102',
    'LOTE Nº 2611102',
    'LOTE N°2611102',
  ]) {
    assert.deepEqual(sealTokens(label), [], label)
  }
  assert.deepEqual(sealTokens('1234567'), ['1234567'])
  assert.deepEqual(sealTokens('A4251051930'), ['A4251051930'])
  assert.deepEqual(sealTokens('124763PV'), ['124763PV'])
  assert.deepEqual(sealTokens('LOT1234567'), ['LOT1234567'])
  assert.deepEqual(sealTokens('SEAL NO 1234567'), ['1234567'])
  assert.deepEqual(sealTokens('PILOT 1234567'), ['1234567'])
  assert.deepEqual(sealTokens('A4251051930 LOTE#2611102'), ['A4251051930'])
  assert.deepEqual(
    sealTokens('A4251035146, SPS185598, DAE:028-2026-40-02099786'),
    ['A4251035146', 'SPS185598'],
  )
})

test('la proforma no toma el lote de la columna A como sello y conserva el de 7 dígitos', () => {
  const rows = [
    ['MARKS AND NUMBERS'],
    ['CONTAINER NUMBERS'],
    ['CONTENEDOR:'],
    ['ZCSU6861048'],
    ['SEALS'],
    ['A4251051930'],
    ['1234567'],
    ['A4 25 1040506'],
    ['AGROSYLMA'],
    ['PAIS ORIGEN'],
    ['ECUADOR'],
    ['LOTE#2611102'],
    ['LOT NO 7654321'],
    ['LOTE: 1111111'],
    ['LOTE#047'],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Proforma')
  const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  const doc = parseProformaArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'proforma.xlsx')
  assert.equal(doc.containers.length, 1)
  assert.equal(doc.containers[0].id, 'ZCSU6861048')
  assert.equal(doc.containers[0].seal, 'A4251051930, 1234567, A4251040506')
  assert.equal(doc.marks.text.includes('2611102'), false)
  assert.equal(doc.marks.text.includes('7654321'), false)
  assert.equal(doc.marks.text.includes('1111111'), false)
  assert.ok(doc.marks.text.includes('AGROSYLMA'))
  assert.ok(doc.marks.text.includes('PAIS ORIGEN'))
  assert.ok(doc.marks.text.includes('ECUADOR'))
  assert.ok(doc.marks.text.includes('LOTE#047'))
})
