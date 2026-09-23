import api from './client'

export const registerPatient    = (data)                  => api.post('/patients/register', data)
export const checkPatient       = (aadhaarNumber)          => api.post('/patients/check', { aadhaarNumber })
export const getPatientStatus   = (aadhaarHash)            => api.get(`/patients/${aadhaarHash}/status`)
export const updatePatientContact = (aadhaarHash, data)   => api.patch(`/patients/${aadhaarHash}/contact`, data)
export const getPatients        = (params)                 => api.get('/patients', { params })
export const updatePatientPolicy = (aadhaarHash, data)    => api.patch(`/patients/${aadhaarHash}/policy`, data)
