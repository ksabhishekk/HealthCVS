// Calls the patient API on the insurer backend (proxied at /api by Vite).
const TOKEN_KEY = 'hcvs_patient_token'
const CACHE_PREFIX = 'hcvs_patient_cache:'

const storage = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

export const getToken = () => storage.get(TOKEN_KEY)
export const setToken = (token) => (token ? storage.set(TOKEN_KEY, token) : storage.del(TOKEN_KEY))

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getToken()
  let res
  try {
    res = await fetch(`/api/patient${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('You are offline, or the insurer cannot be reached right now.', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && token) {
    signOut()
    window.dispatchEvent(new Event('hcvs:signed-out'))
  }
  if (!res.ok) throw new ApiError(data.error || `Something went wrong (${res.status})`, res.status)
  return data
}

// Last-known data, so the app still shows something offline. Removed on sign-out.
export const saveCache = (key, data) => storage.set(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
export const loadCache = (key) => {
  try { return JSON.parse(storage.get(CACHE_PREFIX + key)) } catch { return null }
}

export function signOut() {
  setToken(null)
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX) || k === 'hcvs_patient_statuses').forEach((k) => localStorage.removeItem(k))
  } catch { /* private mode */ }
}
