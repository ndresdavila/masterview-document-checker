import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'node:test'
import { compareHblSwb } from './compare.js'
import { finalizeSwb, parseSwbArrayBuffer, parseSwbFromGrid, parseSwbFromPdfPages } from './parseSwb.js'

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
  if (description) grid[66][4] = description
  grid[67][4] = 'NET WEIGHT: 151,200.00 KGS'
  return grid
}

function grossItems(result) {
  return result.items.filter((item) => item.id === 'gross' || item.id.startsWith('swb-gross'))
}

function pdfWords(lines) {
  const words = [
    { str: 'SEA', x: 40, y: 40 },
    { str: 'WAYBILL', x: 80, y: 40 },
  ]
  for (const line of lines) {
    let x = line.x
    for (const token of line.tokens) {
      words.push({ str: token, x, y: line.y })
      x += 40
    }
  }
  return words
}

describe('SWB gross weight box and description', () => {
  it('keeps the box and the description when they disagree (ULGO26US00393)', () => {
    const buf = fs.readFileSync(FIXTURE)
    const swb = parseSwbArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'ULGO26US00393 SWB.xlsx')
    assert.equal(swb.totals.grossKgBox, 151280)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 151280)
    assert.equal(swb.totals.netKg, 151200)

    const result = compareHblSwb(hblWithGross(152280), swb)
    const intra = result.items.find((item) => item.id === 'swb-gross-sources')
    const box = result.items.find((item) => item.id === 'swb-gross-box')
    const line = result.items.find((item) => item.id === 'swb-gross-line')
    assert.equal(intra.status, 'mismatch')
    assert.equal(intra.label, 'SWB peso bruto: casilla vs descripción')
    assert.equal(intra.proforma, '151,280')
    assert.equal(intra.hbl, '152,280')
    assert.equal(intra.detail, 'Casilla 151,280 vs descripción 152,280')
    assert.deepEqual(intra.captions, { left: 'Casilla', right: 'Descripción' })
    assert.equal(box.status, 'mismatch')
    assert.equal(box.label, 'Peso bruto (SWB casilla)')
    assert.equal(box.proforma, '152,280')
    assert.equal(box.hbl, '151,280')
    assert.equal(box.detail, 'HBL 152,280 vs SWB casilla 151,280')
    assert.equal(line.status, 'match')
    assert.equal(line.label, 'Peso bruto (SWB descripción)')
    assert.equal(line.hbl, '152,280')
    assert.equal(result.items.some((item) => item.id === 'gross'), false)
    assert.equal(result.items.some((item) => item.id === 'prepaid' || item.id === 'on-board' || item.id === 'shipped-on-board'), false)
  })

  it('keeps one peso bruto row when the box and the description agree', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: '152,280.00 KG',
      description: 'GROSS WEIGHT: 152,280.00 KGS',
    }), 'agree.xlsx')
    assert.equal(swb.totals.grossKgBox, 152280)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 152280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].id, 'gross')
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla y descripción)')
    assert.equal(gross[0].hbl, 'Casilla: 152,280\nDescripción: 152,280')
    assert.equal(result.items.some((item) => item.id === 'swb-gross-sources'), false)
  })

  it('penalizes a shared SWB figure once when it differs from the HBL', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: '151,280.00 KG',
      description: 'GROSS WEIGHT: 151,280.00 KGS',
    }), 'same-diff.xlsx')
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].status, 'mismatch')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla y descripción)')
    assert.equal(gross[0].detail, 'HBL 152,280 vs SWB casilla y descripción 151,280')
    const peso = result.items.filter((item) => item.group === 'Totales y referencias' && /peso bruto/i.test(item.label) && item.status === 'mismatch')
    assert.equal(peso.length, 1)
  })

  it('reads only the description when the Gross Weight box is missing', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: null,
      description: 'GROSS WEIGHT: 152,280.00 KGS',
    }), 'no-box.xlsx')
    assert.equal(swb.totals.grossKgBox, null)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 152280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].id, 'swb-gross-line')
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB descripción)')
    assert.equal(result.items.some((item) => item.id === 'swb-gross-sources'), false)
  })

  it('reads only the box when the description has no shipment total', () => {
    const swb = parseSwbFromGrid(swbGrid({
      box: '151,280.00 KG',
      description: null,
    }), 'no-desc.xlsx')
    assert.equal(swb.totals.grossKgBox, 151280)
    assert.equal(swb.totals.grossKgDescription, null)
    assert.equal(swb.totals.grossKg, 151280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].id, 'swb-gross-box')
    assert.equal(gross[0].status, 'mismatch')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla)')
    assert.equal(gross[0].hbl, '151,280')
    assert.equal(result.items.some((item) => item.id === 'swb-gross-sources'), false)
  })

  it('reads both PDF figures and does not copy one into the other', () => {
    const words = pdfWords([
      { y: 320, x: 430, tokens: ['Gross', 'Weight'] },
      { y: 340, x: 430, tokens: ['151,280.00', 'KG'] },
      { y: 500, x: 180, tokens: ['GROSS', 'WEIGHT:', '152,280.00', 'KGS'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb.pdf')
    assert.equal(swb.totals.grossKgBox, 151280)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 151280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    assert.equal(result.items.find((item) => item.id === 'swb-gross-sources').status, 'mismatch')
    assert.equal(result.items.find((item) => item.id === 'swb-gross-box').status, 'mismatch')
    assert.equal(result.items.find((item) => item.id === 'swb-gross-line').status, 'match')
  })

  it('keeps one PDF row when the column and the description agree', () => {
    const words = pdfWords([
      { y: 320, x: 430, tokens: ['Gross', 'Weight'] },
      { y: 340, x: 430, tokens: ['152,280.00', 'KG'] },
      { y: 500, x: 180, tokens: ['GROSS', 'WEIGHT:', '152,280.00', 'KGS'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb-agree.pdf')
    assert.equal(swb.totals.grossKgBox, 152280)
    assert.equal(swb.totals.grossKgDescription, 152280)
    const result = compareHblSwb(hblWithGross(152280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla y descripción)')
  })

  it('keeps the PDF description total when there is no Gross Weight column', () => {
    const words = pdfWords([
      { y: 500, x: 180, tokens: ['GROSS', 'WEIGHT:', '152,280.00', 'KGS'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb-desc.pdf')
    assert.equal(swb.totals.grossKgBox, null)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 152280)
    const result = compareHblSwb(hblWithGross(151280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].id, 'swb-gross-line')
    assert.equal(gross[0].status, 'mismatch')
    assert.equal(gross[0].detail, 'HBL 151,280 vs SWB descripción 152,280')
  })

  it('keeps a Word SWB figure as the description and leaves the box empty', () => {
    const swb = finalizeSwb({
      totals: { bags: 2160, netKg: 151200, grossKg: 152280, cbm: 360 },
      shipper: { name: 'A', lines: ['A'] },
      consignee: { name: 'B', lines: ['B'] },
      notify: { name: 'C', lines: ['C'] },
      secondNotify: { name: '', lines: [] },
      marks: { text: '' },
      extras: {},
    }, 'notice swb.docx')
    assert.equal(swb.totals.grossKgBox, null)
    assert.equal(swb.totals.grossKgDescription, 152280)
    assert.equal(swb.totals.grossKg, 152280)
    const result = compareHblSwb(hblWithGross(151280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].label, 'Peso bruto (SWB descripción)')
    assert.equal(gross[0].status, 'mismatch')
  })

  it('reads GROSS WEIGHT without a colon (ULGO26US00296)', () => {
    const words = pdfWords([
      { y: 480, x: 160, tokens: ['GROSS', 'WEIGHT', '50,457.00', 'KGS'] },
      { y: 500, x: 160, tokens: ['NET', 'WEIGHT', '50,025.00', 'KGS'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'ULGO26US00296.pdf')
    assert.equal(swb.totals.grossKgDescription, 50457)
    assert.equal(swb.totals.grossKg, 50457)
    assert.equal(swb.totals.grossKgBox, null)
    const result = compareHblSwb(hblWithGross(50457), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB descripción)')
  })

  it('reads a PDF Gross Weight column total beside CBM (ULGO26US00309)', () => {
    const words = pdfWords([
      { y: 320, x: 430, tokens: ['Gross', 'Weight'] },
      { y: 360, x: 430, tokens: ['25,213.50', 'KG'] },
      { y: 640, x: 430, tokens: ['252,285.00', 'KG', '600.00', 'CBM'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'ULGO26US00309.pdf')
    assert.equal(swb.totals.grossKgBox, 252285)
    assert.equal(swb.totals.grossKg, 252285)
    assert.equal(swb.totals.grossKgDescription, null)
    const result = compareHblSwb(hblWithGross(252285), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla)')
  })

  it('reads only the PDF Gross Weight column when the description is absent', () => {
    const words = pdfWords([
      { y: 320, x: 430, tokens: ['Gross', 'Weight'] },
      { y: 340, x: 430, tokens: ['151,280.00', 'KG'] },
    ])
    const swb = parseSwbFromPdfPages([{ words, text: words.map((w) => w.str).join(' ') }], 'swb-box.pdf')
    assert.equal(swb.totals.grossKgBox, 151280)
    assert.equal(swb.totals.grossKgDescription, null)
    assert.equal(swb.totals.grossKg, 151280)
    const result = compareHblSwb(hblWithGross(151280), swb)
    const gross = grossItems(result)
    assert.equal(gross.length, 1)
    assert.equal(gross[0].id, 'swb-gross-box')
    assert.equal(gross[0].status, 'match')
    assert.equal(gross[0].label, 'Peso bruto (SWB casilla)')
  })
})
