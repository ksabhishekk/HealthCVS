import api from './client'

export const verifyKYC = (idType, idNumber) => api.post('/kyc/verify', { idType, idNumber })
