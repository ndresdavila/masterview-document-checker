import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHblFromPlainText } from './parseHbl.js'
import { sealTokens, sealsMatch } from './normalize.js'

test('el DAE no entra en la lista de sellos', () => {
  const doc = parseHblFromPlainText(`
CONTAINER: ZCSU7574058
SEALS:
A4251035146
SPS185598
DAE:028-2026-40-02099786
TOTAL BAGS: 2160 BAGS OF COCOA
`, 'swb.pdf')
  assert.equal(doc.containers[0].seal, 'A4251035146, SPS185598')
  assert.deepEqual(
    sealTokens('A4251035146, SPS185598, DAE:028-2026-40-02099786'),
    ['A4251035146', 'SPS185598'],
  )
})

test('los sellos coinciden solo si la lista es la misma', () => {
  assert.equal(sealsMatch('A4251035146, SPS185598', 'SPS185598, A4251035146'), true)
  assert.equal(sealsMatch('A4251035146, SPS185598', 'A4251035146, SPS185598, 02099786'), false)
  assert.equal(sealsMatch('A4251035146, SPS185580', 'A4251035146, SPS185543'), false)
  assert.equal(sealsMatch('FELP315882', 'FELP315883'), false)
})
