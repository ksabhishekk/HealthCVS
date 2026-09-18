import api from './client'

export const getHospitals   = ()         => api.get('/hospitals')
export const addHospital    = (data)     => api.post('/hospitals', data)
export const updateHospital = (id, data) => api.patch(`/hospitals/${id}`, data)
