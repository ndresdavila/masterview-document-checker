import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  isArrivalNoticeName,
  isArrivalNoticeText,
  looksLikeMblName,
  selectMblCandidate,
} from './carrier.js'

const NOTICE = 'AF3_118_S_ZIMUGYL811371-1.pdf'
const FINAL = 'Final_BL_ZIMUGYL811371.pdf'
const FOLDER = 'Semana 43/SL FALCON/GLOBAL COCOA/ZIMUGYL811371/5 BL NAVIERA'

const ZIM_BILL = [
  'BILL OF LADING',
  'ZIM INTEGRATED SHIPPING SERVICES LTD.',
  'Booking No. ZIMUGYL811371',
  'The Carrier is not obliged to give notice of the arrival of the Goods',
  'and no responsibility shall attach for not giving such notice of the arrival of the Goods.',
].join('\n')

const ZIM_NOTICE = [
  'NOTICE OF ARRIVAL',
  'B/L Number: ZIMUGYL811371',
  'BILL OF LADING No. ZIMUGYL811371',
].join('\n')

describe('ZIMUGYL811371 folder 5 BL NAVIERA', () => {
  const noticePath = `${FOLDER}/${NOTICE}`
  const finalPath = `${FOLDER}/${FINAL}`

  it('drops the notice from MBL name candidates and selects the Final B/L', () => {
    assert.equal(looksLikeMblName(NOTICE), false)
    assert.equal(looksLikeMblName(FINAL), true)
    assert.equal(isArrivalNoticeName(NOTICE), true)
    assert.equal(isArrivalNoticeName(FINAL), false)
    assert.equal(selectMblCandidate([noticePath, finalPath]), finalPath)
    assert.equal(selectMblCandidate([finalPath, noticePath]), finalPath)
  })

  it('still selects the Final B/L when the notice text is supplied', () => {
    assert.equal(isArrivalNoticeText(ZIM_NOTICE), true)
    assert.equal(isArrivalNoticeText(ZIM_BILL), false)
    assert.equal(selectMblCandidate([
      { name: noticePath, text: ZIM_NOTICE },
      { name: finalPath, text: ZIM_BILL },
    ]), finalPath)
  })

  it('matches the ZIM notice export in any case, not a Final/Draft name', () => {
    assert.equal(isArrivalNoticeName('af3_118_s_zimugyl811371-1.pdf'), true)
    assert.equal(isArrivalNoticeName('AF3-118-S-ZIMUGYL811371-1.pdf'), true)
    assert.equal(isArrivalNoticeName('final_bl_zimugyl811371.pdf'), false)
    assert.equal(isArrivalNoticeName('Draft_BL_ZIMUGYL811371.pdf'), false)
  })
})

describe('ambiguous names', () => {
  it('prefers a bare carrier B/L over a name that only says NOTICE', () => {
    assert.equal(isArrivalNoticeName('NOTICE_ZIMUGYL811371.pdf'), false)
    assert.equal(selectMblCandidate([
      'NOTICE_ZIMUGYL811371.pdf',
      'ZIMUGYL811371.pdf',
    ]), 'ZIMUGYL811371.pdf')
    assert.equal(selectMblCandidate([
      'ZIMUGYL811371-NOTICE.pdf',
      'Final_BL_ZIMUGYL811371.pdf',
    ]), 'Final_BL_ZIMUGYL811371.pdf')
  })

  it('does not treat a BL-number filename as an arrival notice', () => {
    assert.equal(isArrivalNoticeName('BL6466180070.PDF'), false)
    assert.equal(looksLikeMblName('BL6466180070.PDF'), false)
    assert.equal(selectMblCandidate([
      'BL6466180070.PDF',
      'foto.pdf',
    ]), 'BL6466180070.PDF')
  })

  it('uses the document text when the filename is only the BL number', () => {
    const coscoNotice = 'ARRIVAL NOTICE\nB/L Number: COSU6466180070\nCNTR SIZE / TYPE 40HQ'
    assert.equal(isArrivalNoticeText(coscoNotice), true)
    assert.equal(selectMblCandidate([
      { name: 'BL6466180070.PDF', text: coscoNotice },
      { name: 'Draft_BL_6466180070.pdf', text: 'BILL OF LADING\nCOSU6466180070' },
    ]), 'Draft_BL_6466180070.pdf')
  })

  it('keeps a carrier B/L whose clauses mention notice of the arrival', () => {
    assert.equal(selectMblCandidate([
      { name: 'ZIMUGYL811371.pdf', text: ZIM_BILL },
      { name: NOTICE, text: ZIM_NOTICE },
    ]), 'ZIMUGYL811371.pdf')
  })

  it('does not drop a notice-form name when the PDF is actually a bill of lading', () => {
    assert.equal(selectMblCandidate([
      { name: NOTICE, text: ZIM_BILL },
    ]), NOTICE)
    assert.equal(selectMblCandidate([
      { name: NOTICE, text: ZIM_BILL },
      { name: FINAL, text: ZIM_BILL },
    ]), FINAL)
  })

  it('keeps Final/Draft ahead of a filename that says both bill and notice', () => {
    assert.equal(isArrivalNoticeName('NOTICE_OF_ARRIVAL_BILL_OF_LADING_ZIMUGYL811371.pdf'), true)
    assert.equal(isArrivalNoticeName('Final_BL_NOTICE_ZIMUGYL811371.pdf'), false)
    assert.equal(selectMblCandidate([
      'NOTICE_OF_ARRIVAL_BILL_OF_LADING_ZIMUGYL811371.pdf',
      'Final_BL_NOTICE_ZIMUGYL811371.pdf',
    ]), 'Final_BL_NOTICE_ZIMUGYL811371.pdf')
  })
})

describe('identified arrival notices are never the MBL', () => {
  it('returns no candidate when the notice is the only file', () => {
    assert.equal(selectMblCandidate([NOTICE]), null)
    assert.equal(selectMblCandidate([NOTICE, 'factura.pdf']), null)
    assert.equal(selectMblCandidate(['AN_6509430830.pdf']), null)
    assert.equal(selectMblCandidate([
      'AN_BL_ZIMUGYL811371.pdf',
      NOTICE,
      'AVISO DE LLEGADA ZIMUGYL811371.pdf',
    ]), null)
    assert.equal(selectMblCandidate([
      'Final_BL_ZIMUGYL811371.docx',
      NOTICE,
    ]), null)
  })

  it('does not let a Final or Draft filename override NOTICE OF ARRIVAL content', () => {
    assert.equal(isArrivalNoticeText(ZIM_NOTICE), true)
    assert.equal(selectMblCandidate([{ name: FINAL, text: ZIM_NOTICE }]), null)
    assert.equal(selectMblCandidate([{ name: 'Draft_BL_ZIMUGYL811371.pdf', text: ZIM_NOTICE }]), null)
    assert.equal(isArrivalNoticeName('Final_BL_NOTICE_OF_ARRIVAL_ZIMUGYL811371.pdf'), true)
    assert.equal(selectMblCandidate(['Final_BL_NOTICE_OF_ARRIVAL_ZIMUGYL811371.pdf']), null)
    const titled = 'NOTICE OF ARRIVAL\nSee the BILL OF LADING for ZIMUGYL811371'
    assert.equal(isArrivalNoticeText(titled), true)
    assert.equal(selectMblCandidate([{ name: FINAL, text: titled }]), null)
    assert.equal(selectMblCandidate([
      { name: 'Draft_BL_ZIMUGYL811371.pdf', text: ZIM_NOTICE },
      { name: 'ZIMUGYL811371.pdf', text: ZIM_BILL },
    ]), 'ZIMUGYL811371.pdf')
  })

  it('keeps an ambiguous name that is not an identified notice', () => {
    assert.equal(isArrivalNoticeName('NOTICE_ZIMUGYL811371.pdf'), false)
    assert.equal(selectMblCandidate(['NOTICE_ZIMUGYL811371.pdf']), 'NOTICE_ZIMUGYL811371.pdf')
  })

  it('falls back to a single bare BL number and refuses to guess between two', () => {
    assert.equal(selectMblCandidate(['6466180070.pdf']), '6466180070.pdf')
    assert.equal(selectMblCandidate([
      'BL1111111111.PDF',
      'BL2222222222.PDF',
    ]), null)
    assert.equal(selectMblCandidate([]), null)
    assert.equal(selectMblCandidate(['factura.pdf', 'foto.pdf']), null)
    assert.equal(selectMblCandidate(['HBL DRAFT ULGO26.pdf']), null)
    assert.equal(selectMblCandidate(['Sea Waybill.pdf']), null)
  })
})

describe('valid carrier B/Ls stay eligible', () => {
  it('prefers Final over Draft over a bare booking, and all of them over a notice', () => {
    assert.equal(selectMblCandidate([
      'Draft_BL_ZIMUGYL811371.pdf',
      NOTICE,
      FINAL,
      'ZIMUGYL811371.pdf',
    ]), FINAL)
    assert.equal(selectMblCandidate([
      NOTICE,
      'Draft_BL_ZIMUGYL811371.pdf',
      'ZIMUGYL811371.pdf',
    ]), 'Draft_BL_ZIMUGYL811371.pdf')
    assert.equal(selectMblCandidate([
      'AN_COSU1234567890.pdf',
      'COSU1234567890.pdf',
    ]), 'COSU1234567890.pdf')
    assert.equal(selectMblCandidate([
      'ARRIVAL_NOTICE_ONEYGYEG12345678.pdf',
      'ONEYGYEG12345678.pdf',
    ]), 'ONEYGYEG12345678.pdf')
  })

  it('accepts a Draft filename with a space and a COSCO AN_ prefix as the notice', () => {
    assert.equal(isArrivalNoticeName('AN_6509430830.pdf'), true)
    assert.equal(isArrivalNoticeName('AN_COSU6509430830.pdf'), true)
    assert.equal(isArrivalNoticeName('AN-BL-6466180070.pdf'), true)
    assert.equal(isArrivalNoticeName('AND_BL_ZIMUGYL811371.pdf'), false)
    assert.equal(selectMblCandidate([
      'AN_6509430830.pdf',
      'Draft_BL 6509430830.pdf',
    ]), 'Draft_BL 6509430830.pdf')
    assert.equal(selectMblCandidate(['AN_6509430830.pdf']), null)
  })

  it('does not demote a Draft whose text is the bill, clauses included', () => {
    assert.equal(isArrivalNoticeText(ZIM_BILL), false)
    assert.equal(selectMblCandidate([
      { name: 'Draft_BL_ZIMUGYL811371.pdf', text: ZIM_BILL },
    ]), 'Draft_BL_ZIMUGYL811371.pdf')
    assert.equal(selectMblCandidate([
      { name: 'Draft_BL_ZIMUGYL811371.pdf', text: ZIM_BILL },
      { name: NOTICE, text: ZIM_NOTICE },
    ]), 'Draft_BL_ZIMUGYL811371.pdf')
  })
})

describe('production MBL selection', () => {
  it('calls selectMblCandidate from the drop path, not looksLikeMblName', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../components/DropPanel.jsx', import.meta.url), 'utf8')
    const files = readFileSync(new URL('./files.js', import.meta.url), 'utf8')
    assert.match(files, /export async function chooseDroppedMbl/)
    assert.match(files, /selectMblCandidate\(/)
    assert.match(app, /chooseDroppedMbl\(/)
    assert.doesNotMatch(app, /looksLikeMblName/)
    assert.match(panel, /multiple=\{side === 'mbl'\}/)
    assert.match(panel, /onFiles\(list\)/)
    assert.match(app, /onFiles=\{\(files\) => takeMblFiles\(files\)\}/)
  })
})
