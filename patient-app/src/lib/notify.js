// Tells the patient when a claim moves on. There is no push server, so this
// works while the app is open (in a tab or installed), checking every 20 s.
const KEY = 'hcvs_patient_statuses'

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window
export const notificationsOn = () => notificationsSupported() && Notification.permission === 'granted'

export async function enableNotifications() {
  if (!notificationsSupported()) return false
  return (await Notification.requestPermission()) === 'granted'
}

// Returns the claims whose status changed since the last check.
export function diffStatuses(claims) {
  let previous = null
  try { previous = JSON.parse(localStorage.getItem(KEY)) } catch { /* none yet */ }
  const now = Object.fromEntries(claims.map((c) => [c.claimId, c.status]))
  try { localStorage.setItem(KEY, JSON.stringify(now)) } catch { /* private mode */ }
  if (!previous) return []
  return claims.filter((c) => previous[c.claimId] !== undefined && previous[c.claimId] !== c.status)
}

export async function showNotification(title, body, url) {
  if (!notificationsOn()) return
  const options = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url }, tag: url }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return reg.showNotification(title, options)
  } catch { /* fall through */ }
  new Notification(title, options)
}
