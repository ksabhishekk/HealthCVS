import api from './client'

export const getClaims      = ()       => api.get('/claims')
export const getClaimStats  = ()       => api.get('/claims/stats')
export const getClaim       = (id)     => api.get(`/claims/${id}`)
export const getClaimXai    = (id)     => api.get(`/claims/${id}/xai`)

export const setFraudScore  = (id, fraudScore) =>
  api.post(`/claims/${id}/fraud-score`, { fraudScore })

export const adjudicateClaim = (id) =>
  api.post(`/claims/${id}/adjudicate`)

export const insurerReview   = (id, approve, notes = '', approvedAmount) =>
  api.post(`/claims/${id}/insurer-review`, { approve, reviewNotes: notes, approvedAmount })

export const requestInfo     = (id, message, requestedDocuments = []) =>
  api.post(`/claims/${id}/info-requests`, { message, requestedDocuments })

export const getSignalAnalytics = () =>
  api.get('/claims/analytics/signals')

export const settleClaim     = (id) =>
  api.post(`/claims/${id}/settle`)

export const triggerOracle   = (id) =>
  api.post(`/claims/${id}/oracle-trigger`)

