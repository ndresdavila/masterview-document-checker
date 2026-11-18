import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { parseHblFromPdfWords, parseHblFromPlainText } from './parseHbl.js'
import { parseMblFromPlainText } from './parseMbl.js'
import { parseProformaArrayBuffer } from './parseProforma.js'
import { parseSwbFromGrid } from './parseSwb.js'
import { sealTokens, sealsMatch } from './normalize.js'

test('sealTokens deja fuera peso, contrato, lote, DAE y booking', () => {
  assert.deepEqual(sealTokens('25228.50 KG'), [])
  assert.deepEqual(sealTokens('25159.00'), [])
  assert.deepEqual(sealTokens('25014.20 KG GROSS'), [])
  assert.deepEqual(sealTokens('25,228.50 KG'), [])
  assert.deepEqual(sealTokens('25,014.20 KG NET'), [])
  assert.deepEqual(sealTokens('25090 KGS'), [])
  assert.deepEqual(sealTokens('20039.000KGS'), [])
  assert.deepEqual(sealTokens('60.000M3'), [])
  assert.deepEqual(sealTokens('CONTRATO: SCS173388'), [])
  assert.deepEqual(sealTokens('CONTRACT#: P01313'), [])
  assert.deepEqual(sealTokens('SCS173388'), [])
  assert.deepEqual(sealTokens('CN SCS178319'), [])
  assert.deepEqual(sealTokens('DAE:028-2026-40-02099786'), [])
  assert.deepEqual(sealTokens('LOTE#IN0552026'), [])
  assert.deepEqual(sealTokens('LOTE SGE3832026'), [])
  assert.deepEqual(sealTokens('ZIMUGYL810537'), [])
  assert.deepEqual(sealTokens('GYEG04237300'), [])
  assert.deepEqual(sealTokens('ULGO26US00377'), [])
  assert.deepEqual(sealTokens('A42511221826'), ['A42511221826'])
  assert.deepEqual(sealTokens('A4251121826'), ['A4251121826'])
  assert.deepEqual(sealTokens('KM62378 KM64378'), ['KM62378', 'KM64378'])
  assert.deepEqual(sealTokens('SPS1539900'), ['SPS1539900'])
  assert.deepEqual(sealTokens('32862424'), ['32862424'])
  assert.deepEqual(sealTokens('W05926'), ['W05926'])
})

test('la lista de sellos sigue teniendo que ser la misma', () => {
  assert.equal(sealsMatch('A42511221826, 127761PV', 'A4251121826, 127761PV'), false)
  assert.equal(sealsMatch('KM64378', 'KM64378, KM62378'), false)
  assert.equal(sealsMatch('LAAB54214, RP0081314EC, 147175PV', '147175PV, LAAB54214, RP0081314EC'), true)
})

test('MBL ONE junta los sellos de las líneas siguientes', () => {
  const doc = parseMblFromPlainText(`
BILL OF LADING
OCEAN NETWORK EXPRESS
ONEYGYEG04237300
ONEU0519604 / LAAB54214 / 290 BAGS /FCL / FCL/40HQ/20039.000KGS/60.000M3
147175PV
RP0081314EC
ONEU1859506 / LAAB54218 RP0081318EC / 290 BAGS /FCL / FCL/40HQ/20039.000KGS/60.000M3
A4 25 1040506
FFAU6456080 / LAAG41055 / 290 BAGS /FCL / FCL/40HQ/20068.000KGS/49.000M3
R120730A
W03944
B210863
VESSEL VOYAGE: ONE SHINE 2626W B/L NO.: ONEYGYEG19549800
COPY NON NEGOTIABLE PAGE: 2 OF 4
RP0153155EC
FFAU6756615 / LAAG41027 / 290 BAGS /FCL / FCL/40HQ/20068.000KGS/49.000M3
W03995
B210869
`, 'ONEYGYEG04237300.pdf')
  const byId = Object.fromEntries(doc.containers.map((c) => [c.id, c.seal]))
  assert.equal(byId.ONEU0519604, 'LAAB54214, 147175PV, RP0081314EC')
  assert.equal(byId.ONEU1859506, 'LAAB54218, RP0081318EC, A4251040506')
  assert.equal(byId.FFAU6456080, 'LAAG41055, R120730A, W03944, B210863, RP0153155EC')
  assert.equal(byId.FFAU6756615, 'LAAG41027, W03995, B210869')
  assert.equal(byId.ONEU0519604.includes('20039'), false)
})

test('MBL ZIM junta cada SEAL, OTHER SEALS y los W/B/R', () => {
  const doc = parseMblFromPlainText(`
BILL OF LADING
ZIM INTEGRATED SHIPPING SERVICES
Booking No. ZIMUGYL810537
CONT:CICU6894270
1 CNT
SEAL: A4251040742
SEAL: R397161A
SEAL: W05926
SEAL: B211476/HC40
(CY/CY)
25,050.40
SHIPPER'S LOAD STOWAGE & COUNT
CONT:CAAU8725142
1 CNT
SEAL: Q223980
OTHER SEALS: 136108PV
/HC40 (CY/CY)
25228.50
SHIPPER'S LOAD STOWAGE & COUNT
CONT:JXLU6226084
SEAL: A4251040716 R397155A
W05861
B211536
/HC40 (CY/CY)
`, 'Final_BL_ZIMUGYL810537.pdf')
  const byId = Object.fromEntries(doc.containers.map((c) => [c.id, c.seal]))
  assert.equal(byId.CICU6894270, 'A4251040742, R397161A, W05926, B211476')
  assert.equal(byId.CAAU8725142, 'Q223980, 136108PV')
  assert.equal(byId.JXLU6226084, 'A4251040716, R397155A, W05861, B211536')
  assert.equal(JSON.stringify(byId).includes('25228'), false)
  assert.equal(JSON.stringify(byId).includes('25050'), false)
})

test('MBL COSCO no se queda con el primer sello del resumen', () => {
  const doc = parseMblFromPlainText(`
BILL OF LADING
COSCO SHIPPING LINES
COSU6401234567
CSGU7159320 / 32862424 AB123456 / 363 BAGS / FCL / 40HQ / 25228.5KGS
CONTAINER: CSGU7159320
SEAL: 32862424
SEAL: AB123456
SEAL: CD765432
360 BAGS OF ECUADORIAN COCOA BEANS
NET WEIGHT: 25,047.00 KG GROSS WEIGHT: 25,228.50 KG
`, 'Draft_BL_COSU6401234567.pdf')
  assert.equal(doc.carrier, 'cosco')
  assert.equal(doc.containers[0].id, 'CSGU7159320')
  assert.equal(doc.containers[0].seal, '32862424, AB123456, CD765432')
  assert.equal(doc.containers[0].seal.includes('25228'), false)
})

test('MBL Hapag junta cada SEAL del contenedor', () => {
  const doc = parseMblFromPlainText(`
BILL OF LADING
HAPAG-LLOYD
HLCUHAM1234567890
CONTAINER: HLXU1234567
SEAL: HLC998877
SEAL: W445566
SEAL W: B778899
290 BAGS OF ECUADOR COCOA BEANS
GROSS WEIGHT: 25,228.50 KG
`, 'HLCUHAM1234567890.pdf')
  assert.equal(doc.containers.length, 1)
  assert.equal(doc.containers[0].id, 'HLXU1234567')
  assert.equal(doc.containers[0].seal, 'HLC998877, W445566, B778899')
})

test('HBL junta sellos W/B/R y no el contrato ni el peso', () => {
  const doc = parseHblFromPlainText(`
CONTAINER: CICU6894270
SEAL:
A4251040742
R397161A
W05926
B211476
CONTAINER: JXLU6143020
SEALS:
A4241268010
SPS151780
CONTRATO: SCS173388
25228.50 KG
25,159.00 KB
LOTE 1494
8X40HQ CONTAINERS STC
290 BAGS OF ECUADOR COCOA BEANS
`, 'HBL.pdf')
  assert.equal(doc.containers[0].seal, 'A4251040742, R397161A, W05926, B211476')
  assert.equal(doc.containers[1].seal, 'A4241268010, SPS151780')
})

test('HBL del dashboard no corta los sellos en la primera línea en blanco', () => {
  const doc = parseHblFromPlainText(`
CONTAINER: CICU6894270

SEALS:

A4251040742

W05926

B211476

290

BAGS OF ECUADOR COCOA

TOTAL
200680 KG
`, 'HBL.pdf')
  assert.equal(doc.containers[0].seal, 'A4251040742, W05926, B211476')
})

test('la columna del HBL incluye los sellos que quedan debajo de y=700', () => {
  const words = []
  const add = (str, x, y) => words.push({ str, x, y })
  add('CONTAINER:', 26, 400)
  add('CICU6894270', 26, 418)
  add('SEALS:', 26, 436)
  add('A4251040742', 26, 454)
  add('R397161A', 26, 472)
  add('W05926', 26, 710)
  add('B211476', 26, 728)
  add('RECEIVED BY THE CARRIER', 26, 800)
  add('FAKE12345', 26, 818)
  const doc = parseHblFromPdfWords(words, 'HBL.pdf', '')
  assert.equal(doc.containers[0].seal, 'A4251040742, R397161A, W05926, B211476')
})

test('la proforma lee SPS1539900 y el sello de más, y no el peso', () => {
  const rows = [
    ['MARKS AND NUMBERS /', '', '', 'NO. OF', '', 'DESCRIPTION OF PACKAGES AND GOODS', '', '', 'GROSS WEIGHT', 'MEASUREMENT'],
    ['CONTAINER NUMBERS', '', '', 'PKGS'],
    ['CONTENEDOR:'],
    ['JXLU6124647', '', '', 360, '', 'BAGS OF ECUADOR COCOA BEANS TYPE GRADO 3', '', '', 25380, 60],
    ['A4241251107', '', '', '', '', 'NET WEIGHT: 25,200.00 KG', '', '', 'KGS'],
    ['SPS1539900'],
    ['CONTENEDOR:'],
    ['JXLU4585721', '', '', 362, '', 'BAGS OF ECUADOR COCOA BEANS', '', '', 25159, 60],
    ['KM64378'],
    ['KM62378'],
    [25228.5],
    ['25159.00'],
    ['25090 KGS'],
    ['SCS173388'],
    ['TOTAL BAGS'],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'BILL OF LADING ')
  const doc = parseProformaArrayBuffer(XLSX.write(wb, { type: 'array', bookType: 'xls' }), 'proforma.xls')
  const byId = Object.fromEntries(doc.containers.map((c) => [c.id, c.seal]))
  assert.equal(byId.JXLU6124647, 'A4241251107, SPS1539900')
  assert.equal(byId.JXLU4585721, 'KM64378, KM62378')
})

test('el SWB no toma el contrato SCS como sello', () => {
  const grid = [
    ['SHIPPER', '', '', '', 'BILL OF LADING NO'],
    ['MASTERVIEW S.A.'],
    ['CONSIGNEE'],
    ['BUYER LLC'],
    ['NOTIFY PARTY'],
    ['NOTIFY LLC'],
    ['CONTAINER:'],
    ['JXLU6143020'],
    ['SEALS: A4241268010'],
    ['SPS151780'],
    ['CONTRATO: SCS173388'],
    ['25228.50 KG'],
    ['TOTAL BAGS'],
  ].map((row) => {
    const full = Array(10).fill('')
    row.forEach((cell, i) => { full[i] = cell })
    return full
  })
  const doc = parseSwbFromGrid(grid, 'SWB_ZIMUGYL804813.pdf')
  const box = doc.containers.find((c) => c.id === 'JXLU6143020')
  assert.ok(box)
  assert.equal(box.seal, 'A4241268010, SPS151780')
})
