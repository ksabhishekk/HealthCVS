import api from './client'

export const sendConsentOtp = (data) => api.post('/consent/send', data)
export const verifyConsentOtp = (data) => api.post('/consent/verify', data)
