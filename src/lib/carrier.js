export function looksLikeSwbName(name = '') {
  const n = String(name).toUpperCase()
  return /SEA\s*WAYBILL|\bSWB\b/.test(n)
}

export function looksLikeHblName(name = '') {
  const n = String(name).toUpperCase()
  if (looksLikeSwbName(name)) return false
  if (/HBL DRAFT|BL FLETADO/.test(n)) return true
  if (/\bULGO\d/.test(n) && !/DRAFT[_\s-]*BL/.test(n)) return true
  return false
}

export function looksLikeMblName(name = '') {
  const n = String(name).toUpperCase().replace(/\s+/g, ' ')
  if (looksLikeHblName(name)) return false
  if (/ZIMU|ZIMUGYL|ONEYGYEG|\bCOSU\d{10}|\bCOSCO\b/.test(n)) return true
  if (/DRAFT[_\s-]*BL|FINAL[_\s-]*BL/.test(n)) return true
  if (/DRAFT_BL_\d{10}|DRAFT_BL\s+\d{10}/.test(n.replace(/ /g, '_'))) return true
  return false
}

export function detectCarrier(name = '', text = '') {
  const t = `${name} ${text}`.toUpperCase()
  if (/COSCO SHIPPING|ELINES\.COSCOSHIPPING|\bCOSU\d{10}/.test(t)) return 'cosco'
  if (/OCEAN NETWORK EXPRESS|ONE-LINE\.COM|\bONEY[A-Z0-9]{10,}/.test(t)) return 'one'
  if (/\bZIMU|ZIMUGYL|ZIM INTEGRATED/.test(t)) return 'zim'
  if (/DRAFT_BL_\d{10}|BILL OF LADING NO\.?\s*COSU/.test(t)) return 'cosco'
  if (/\bGYEG\d{8,}/.test(t) && /OCEAN NETWORK|ONEY|ONE-LINE/.test(t)) return 'one'
  if (/\b\d{10}\b/.test(t) && /PROFORMA/.test(t) && /BILL OF LADING/.test(t)) return 'cosco'
  return ''
}
