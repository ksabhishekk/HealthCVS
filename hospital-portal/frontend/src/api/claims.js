import api from './client'

export const getClaims = (params) => api.get('/claims', { params })
export const getClaimStats = () => api.get('/claims/stats')
export const getClaim = (id) => api.get(`/claims/${id}`)
export const submitClaim = (data) => api.post('/claims/submit', data)
export const authenticateClaim = (id) => api.post(`/claims/${id}/authenticate`)
export const verifyPolicy = (data) => api.post('/insurance/verify-policy', data)
// TX4-TX7 (fraud scoring, adjudication, insurer review, settlement) are insurer-only
// actions — the hospital wallet doesn't hold those on-chain roles. See insurance-portal's
// api/claims.js for those.
