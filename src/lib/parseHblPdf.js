import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import { parseHblFromPdfWords, parseHblFromPlainText } from './parseHbl.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function parseHblPdf(buffer, fileName) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  let page1Words = []
  const extra = []
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const words = content.items
      .filter((it) => it.str != null)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: viewport.height - it.transform[5],
      }))
    if (n === 1) page1Words = words
    else extra.push(words.map((w) => w.str).join(' '))
  }
  return parseHblFromPdfWords(page1Words, fileName, extra.join('\n'))
}

export async function parseHblDocx(buffer, fileName) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return parseHblFromPlainText(result.value, fileName)
}
