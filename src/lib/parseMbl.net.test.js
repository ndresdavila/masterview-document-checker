import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareHblMbl } from './compare.js'
import { parseMblFromPlainText } from './parseMbl.js'

const FILE = 'Final_BL_ZIMUGYL811744.pdf'

function zimBill(lines) {
  return [
    'BILL OF LADING',
    'ZIM INTEGRATED SHIPPING SERVICES LTD.',
    'Booking No. ZIMUGYL811744',
    ...lines,
  ].join('\n')
}

function containerBlock(n, netLine = 'NET WEIGHT: 25,200.00 KGS') {
  return [
    '360 BAGS OF ECUADORIAN COCOA BEANS GRADE 1',
    netLine,
    'GROSS WEIGHT: 25,380.00 KG',
    `CONT: ZCSU${1000000 + n}`,
    `SEAL: SL${1000 + n}`,
    '/HC40 (CY/CY)',
  ].join('\n')
}

function sixContainers(netLine) {
  return Array.from({ length: 6 }, (_, i) => containerBlock(i + 1, netLine)).join('\n')
}

function hblNet(netKg) {
  return {
    shipper: { name: 'MASTERVIEW', lines: ['MASTERVIEW'] },
    consignee: { name: 'BUYER', lines: ['BUYER'] },
    notify: { name: 'NOTIFY', lines: ['NOTIFY'] },
    bookingNo: 'ZIMUGYL811744',
    blNo: 'ULGO26US00393',
    vessel: 'CONTSHIP CUP',
    voyage: '55N',
    portLoading: 'GUAYAQUIL',
    portDischarge: 'NEW YORK',
    containers: [],
    marks: { text: '', lote: '' },
    totals: { bags: 2160, netKg, grossKg: 152280, cbm: 360 },
    refs: {},
  }
}

describe('ZIM final B/L shipment net weight', () => {
  it('reads NET WEIGHT: 151,200.00 KGS and leaves each container at 25,200', () => {
    const doc = parseMblFromPlainText(zimBill([
      sixContainers(),
      'NET WEIGHT: 151,200.00 KGS',
      'GROSS WEIGHT: 152,280.00 KGS',
    ]), FILE)
    assert.equal(doc.carrier, 'zim')
    assert.equal(doc.containers.length, 6)
    assert.deepEqual(doc.containers.map((c) => c.netKg), [25200, 25200, 25200, 25200, 25200, 25200])
    assert.equal(doc.totals.netKg, 151200)

    const net = compareHblMbl(hblNet(151200), doc).items.find((item) => item.id === 'net')
    assert.equal(net.label, 'Peso neto')
    assert.equal(net.status, 'match')
    assert.equal(net.hbl, '151,200')
  })

  it('reads the shipment line with or without a colon, KG or KGS, and thousands separators', () => {
    const lines = [
      'NET WEIGHT: 151,200.00 KGS',
      'NET WEIGHT 151,200.00 KGS',
      'NET WEIGHT: 151200.00 KG',
      'NET WEIGHT: 151,200 KG',
      'NET WEIGHT : 151,200.00 KGS',
      'net weight: 151,200.00 kgs',
      'NET WEIGHT (KGS): 151,200.00',
      'NET WEIGHT: 151.200,00 KGS',
    ]
    for (const totalLine of lines) {
      const doc = parseMblFromPlainText(zimBill([
        sixContainers('NET WEIGHT: 25,200.00 KG'),
        totalLine,
      ]), FILE)
      assert.equal(doc.totals.netKg, 151200, totalLine)
      assert.deepEqual(doc.containers.map((c) => c.netKg), [25200, 25200, 25200, 25200, 25200, 25200], totalLine)
    }
  })

  it('prefers the shipment NET WEIGHT line over the sum of the containers', () => {
    const doc = parseMblFromPlainText(zimBill([
      sixContainers('NET WEIGHT: 25,000.00 KG'),
      'NET WEIGHT: 151,200.00 KGS',
    ]), FILE)
    assert.deepEqual(doc.containers.map((c) => c.netKg), [25000, 25000, 25000, 25000, 25000, 25000])
    assert.equal(doc.totals.netKg, 151200)
  })

  it('sums per-container nets when the ZIM bill has no shipment total', () => {
    const doc = parseMblFromPlainText(zimBill([sixContainers()]), FILE)
    assert.equal(doc.containers.length, 6)
    assert.deepEqual(doc.containers.map((c) => c.netKg), [25200, 25200, 25200, 25200, 25200, 25200])
    assert.equal(doc.totals.netKg, 151200)

    const uneven = parseMblFromPlainText(zimBill([
      containerBlock(1, 'NET WEIGHT: 25,000.00 KG'),
      containerBlock(2, 'NET WEIGHT: 26,000.00 KG'),
    ]), FILE)
    assert.deepEqual(uneven.containers.map((c) => c.netKg), [25000, 26000])
    assert.equal(uneven.totals.netKg, 51000)

    const net = compareHblMbl(hblNet(151200), doc).items.find((item) => item.id === 'net')
    assert.equal(net.status, 'match')
    assert.equal(net.hbl, '151,200')
  })

  it('does not treat a per-container NET WEIGHT line as the shipment total', () => {
    const loose = parseMblFromPlainText(zimBill([
      'NET WEIGHT: 25,200.00 KGS',
      'NET WEIGHT: 25,200.00 KGS',
      'NET WEIGHT: 25,200.00 KGS',
      'NET WEIGHT: 25,200.00 KGS',
      'NET WEIGHT: 25,200.00 KGS',
      'NET WEIGHT: 25,200.00 KGS',
    ]), FILE)
    assert.equal(loose.containers.length, 0)
    assert.equal(loose.totals.netKg, null)

    const parsed = parseMblFromPlainText(zimBill([sixContainers()]), FILE)
    assert.notEqual(parsed.totals.netKg, 25200)
  })
})

describe('net weights main already extracts', () => {
  it('keeps TOTAL NET WEIGHT and N.W. on a ZIM bill', () => {
    const total = parseMblFromPlainText(zimBill([
      sixContainers(),
      'TOTAL NET WEIGHT: 120,000.00 KGS',
      'NET WEIGHT: 151,200.00 KGS',
    ]), FILE)
    assert.equal(total.totals.netKg, 120000)

    const nw = parseMblFromPlainText(zimBill([
      sixContainers(),
      'N.W.: 140,000.00 KGS',
      'NET WEIGHT: 151,200.00 KGS',
    ]), FILE)
    assert.equal(nw.totals.netKg, 140000)
  })

  it('keeps a COSCO NW total and a ONE peso neto', () => {
    const cosco = parseMblFromPlainText([
      'BILL OF LADING',
      'COSCO SHIPPING LINES',
      'COSU6401234567',
      'NW: 100,500.00',
      'NET WEIGHT: 151,200.00 KGS',
    ].join('\n'), 'Draft_BL_COSU6401234567.pdf')
    assert.equal(cosco.carrier, 'cosco')
    assert.equal(cosco.totals.netKg, 100500)

    const one = parseMblFromPlainText([
      'BILL OF LADING',
      'OCEAN NETWORK EXPRESS',
      'ONEYGYEG12345678',
      'TEMU1234567 / SL100 / 360 BAGS',
      'PESO NETO: 48,000.50',
      'NET WEIGHT: 151,200.00 KGS',
    ].join('\n'), 'Draft_BL_ONEYGYEG12345678.pdf')
    assert.equal(one.carrier, 'one')
    assert.equal(one.totals.netKg, 48000.5)

    const summed = parseMblFromPlainText([
      'BILL OF LADING',
      'COSCO SHIPPING LINES',
      'COSU6401234567',
      'CONTAINER: CSGU7159320',
      '360 BAGS OF ECUADORIAN COCOA BEANS',
      'NET WEIGHT: 25,047.00 KG GROSS WEIGHT: 25,228.50 KG',
      'CONTAINER: CSGU7159321',
      '360 BAGS OF ECUADORIAN COCOA BEANS',
      'NET WEIGHT: 25,047.00 KG GROSS WEIGHT: 25,228.50 KG',
      'NET WEIGHT: 151,200.00 KGS',
    ].join('\n'), 'Draft_BL_COSU6401234567.pdf')
    assert.equal(summed.carrier, 'cosco')
    assert.deepEqual(summed.containers.map((c) => c.netKg), [25047, 25047])
    assert.equal(summed.totals.netKg, 50094)
  })
})
