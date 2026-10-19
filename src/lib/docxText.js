import mammoth from 'mammoth'

// Igual que mammoth.extractRawText, pero los saltos de línea (Shift+Enter, <w:br/>) salen como "\n".
// extractRawText los ignora y pega las líneas: "GRANDSOUTH S.A.VIA DURAN BOLICHE KM 20".
function toText(element) {
  if (element.type === 'text') return element.value
  if (element.type === 'tab') return '\t'
  if (element.type === 'break') return '\n'
  const tail = element.type === 'paragraph' ? '\n\n' : ''
  return (element.children || []).map(toText).join('') + tail
}

function cellLines(cell) {
  return toText(cell).split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n')
}

// La plantilla de proforma tiene dos columnas de notify: la de la izquierda es el notify y la de
// la derecha el second notify. La plantilla anterior titulaba ambas "NOTIFY PARTY"; la actual
// titula la derecha "SECOND NOTIFY". Devuelve el texto de ambas celdas.
function findNotifyCells(element) {
  if (element.type === 'table') {
    const rows = (element.children || []).filter((r) => r.type === 'tableRow')
    for (let i = 0; i + 1 < rows.length; i += 1) {
      const head = rows[i].children || []
      if (head.length >= 2 && /^\s*NOTIFY PARTY/i.test(toText(head[0])) && /^\s*(NOTIFY PARTY|SECOND NOTIFY)/i.test(toText(head[1]))) {
        const cells = rows[i + 1].children || []
        // Debajo va la fila "CONTACT:" de la plantilla, con el nombre en la misma celda
        // ("CONTACT: LUCAS") o en la celda siguiente ([CONTACT:] [LUCAS]). Va con su parte.
        const contacts = []
        const contactRow = rows[i + 2] && /^\s*CONTACT/i.test(toText(rows[i + 2])) ? rows[i + 2].children || [] : []
        contactRow.map(cellLines).forEach((s, k, all) => {
          if (!/^CONTACT/i.test(s)) return
          const value = s.replace(/^CONTACT:?\s*/i, '')
          const next = all[k + 1] || ''
          contacts.push(value ? `CONTACT: ${value}` : next && !/^CONTACT/i.test(next) ? `CONTACT: ${next}` : '')
        })
        const found = [0, 1].map((k) => [cellLines(cells[k] || {}), contacts[k] || ''].filter(Boolean).join('\n'))
        // Con el título "SECOND NOTIFY" (plantilla actual) cada celda es la suya, diga lo que diga el texto.
        found.secondLabeled = /^\s*SECOND NOTIFY/i.test(toText(head[1]))
        return found
      }
    }
  }
  for (const child of element.children || []) {
    const found = findNotifyCells(child)
    if (found) return found
  }
  return null
}

export async function docxContent(input) {
  let text = ''
  let notifyCells = null
  await mammoth.convertToHtml(input, {
    transformDocument: (doc) => {
      text = toText(doc)
      notifyCells = findNotifyCells(doc)
      return doc
    },
  })
  return { text, notifyCells }
}

export async function docxPlainText(input) {
  return (await docxContent(input)).text
}
