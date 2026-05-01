import api from './client'

export const getClaims = (params) => api.get('/claims', { params })
export const getClaimStats = () => api.get('/claims/stats')
export const getClaim = (id) => api.get(`/claims/${id}`)
export const submitClaim = (data) => api.post('/claims/submit', data)
export const authenticateClaim = (id) => api.post(`/claims/${id}/authenticate`)
