import api from './client'

export const registerPatient = (data) => api.post('/patients/register', data)
export const checkPatient = (aadhaarNumber) => api.post('/patients/check', { aadhaarNumber })
export const getPatientStatus = (aadhaarHash) => api.get(`/patients/${aadhaarHash}/status`)
