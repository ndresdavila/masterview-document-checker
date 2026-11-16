import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import { compareHblSwb } from './compare.js'
import { parseSwbArrayBuffer, parseSwbFromGrid, parseSwbFromPdfPages } from './parseSwb.js'

const FIXTURE = new URL('./fixtures/swb-ulgo26us00393-gross.xlsx', import.meta.url)

function hblWithGross(grossKg) {
  return {
    shipper: { name: 'MASTERVIEW', lines: ['MASTERVIEW'] },
    consignee: { name: 'BUYER', lines: ['BUYER'] },
    notify: { name: 'NOTIFY', lines: ['NOTIFY'] },
    secondNotify: { name: '', lines: [] },
    bookingNo: 'ZIMUGYL811744',
    blNo: 'ULGO26US00393',
    vessel: 'CONTSHIP CUP',
    voyage: '55N',
    portLoading: 'GUAYAQUIL',
    portDischarge: 'NEW YORK',
    containers: [],
    marks: { text: '', lote: '' },
    totals: { bags: 2160, netKg: 151200, grossKg, cbm: 360 },
    refs: {},
  }
}

function swbGrid({ box, description }) {
  const grid = Array.from({ length: 70 }, () => Array(8).fill(''))
  grid[0][0] = 'SEA WAYBILL'
  grid[24][1] = 'Containers & Seals'
  grid[24][2] = 'No. of Pkgs'
  grid[24][4] = 'Description of Goods & Pkgs.'
  grid[24][7] = 'Measurement'
  grid[25][1] = 'CONTAINER:'
  grid[25][2] = '2160'
  grid[25][4] = '6X40HQ CONTAINERS STC'
  grid[25][7] = '360.00 CBM'
  if (box != null) {
    grid[24][6] = 'Gross Weight'
    grid[25][6] = box
  }
  grid[28][4] = 'GROSS WEIGHT: 25,380.00 KG'
  grid[66][4] = description
  grid[67][4] = 'NET WEIGHT: 151,200.00 KGS'
  return grid
}

describe('SWB gross weight box', () => {
  it('uses the Gross Weight box when it disagrees with the description (ULGO26US00393)', () => {
    const buf = fs.readFileSync(FIXTURE)
    const swb = parseSwbArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'ULGO26US00393 SWB.xlsx')
    assert.equal(swb.totals.grossKg, 151280)
    assert.equal(swb.totals.netKg, 151200)
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = result.items.find((item) => item.id === 'gross')
    assert.equal(gross.status, 'mismatch')
    assert.equal(gross.proforma, '152,280')
    assert.equal(gross.hbl, '151,280')
  })

  it('keeps the shared figure when the box and the description agree', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: '152,280.00 KG',
      description: 'GROSS WEIGHT: 152,280.00 KGS',
    }), 'agree.xlsx')
    assert.equal(swb.totals.grossKg, 152280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    assert.equal(result.items.find((item) => item.id === 'gross').status, 'match')
  })

  it('falls back to the description when the Gross Weight box is missing', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: null,
      description: 'GROSS WEIGHT: 152,280.00 KGS',
    }), 'no-box.xlsx')
    assert.equal(swb.totals.grossKg, 152280)
  })

  it('reads the PDF Gross Weight column and ignores GROSS WEIGHT: in the description', () => {
    const words = [
      { str: 'SEA', x: 40, y: 40 },
      { str: 'WAYBILL', x: 80, y: 40 },
      { str: 'Gross', x: 430, y: 320 },
      { str: 'Weight', x: 470, y: 320 },
      { str: '151,280.00', x: 430, y: 340 },
      { str: 'KG', x: 500, y: 340 },
      { str: 'GROSS', x: 180, y: 500 },
      { str: 'WEIGHT:', x: 230, y: 500 },
      { str: '152,280.00', x: 310, y: 500 },
      { str: 'KGS', x: 390, y: 500 },
    ]
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb.pdf')
    assert.equal(swb.totals.grossKg, 151280)
  })

  it('keeps the PDF description total when there is no Gross Weight column', () => {
    const words = [
      { str: 'SEA', x: 40, y: 40 },
      { str: 'WAYBILL', x: 80, y: 40 },
      { str: 'GROSS', x: 180, y: 500 },
      { str: 'WEIGHT:', x: 230, y: 500 },
      { str: '152,280.00', x: 310, y: 500 },
      { str: 'KGS', x: 390, y: 500 },
    ]
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb-desc.pdf')
    assert.equal(swb.totals.grossKg, 152280)
  })
})
