import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import { parseHblFromPdfWords, parseHblFromPlainText, parseProformaFromPlainText } from './parseHbl.js'
import { parseMblFromPdfPages } from './parseMbl.js'
import { parseSwbFromPdfPages } from './parseSwb.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

async function extractPdfPages(buffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  const pages = []
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
    pages.push({
      words,
      text: words.map((w) => w.str).join(' '),
    })
  }
  return pages
}

export async function parseHblPdf(buffer, fileName) {
  const pages = await extractPdfPages(buffer)
  const extra = pages.slice(1).map((p) => p.text).join('\n')
  return parseHblFromPdfWords(pages[0]?.words || [], fileName, extra)
}

export async function parseSwbPdf(buffer, fileName) {
  const pages = await extractPdfPages(buffer)
  return parseSwbFromPdfPages(pages, fileName)
}

export async function parseMblPdf(buffer, fileName) {
  const pages = await extractPdfPages(buffer)
  return parseMblFromPdfPages(pages, fileName)
}

export async function parseHblDocx(buffer, fileName) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return parseHblFromPlainText(result.value, fileName)
}

export async function parseProformaDocx(buffer, fileName) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return parseProformaFromPlainText(result.value, fileName)
}
