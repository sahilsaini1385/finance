// Document blob storage in IndexedDB (localStorage caps out ~5MB — too small for
// PDFs/scans). Metadata lives in the main store; blobs live here, keyed by doc id.
// Both stay entirely in the browser.

const DB_NAME = 'finance-files'
const STORE = 'files'
export const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB per document

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const store = t.objectStore(STORE)
      const req = fn(store)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export function putFile(id, blob) {
  if (blob.size > MAX_FILE_BYTES) {
    return Promise.reject(new Error('File is larger than 15MB — please compress it first.'))
  }
  return tx('readwrite', store => store.put(blob, id))
}

export function getFile(id) {
  return tx('readonly', store => store.get(id))
}

export function deleteFile(id) {
  return tx('readwrite', store => store.delete(id))
}

export async function openFile(id, name) {
  const blob = await getFile(id)
  if (!blob) throw new Error('File not found in this browser — it may have been uploaded on another device.')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  // PDFs and images open in a tab; everything else downloads with its name.
  if (!/^(application\/pdf|image\/)/.test(blob.type)) a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function wipeAllFiles() {
  return new Promise(resolve => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}

export function formatBytes(n) {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
