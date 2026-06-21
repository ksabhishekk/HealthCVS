import api from './client'

export const getDoctors = () => api.get('/doctors')
export const createDoctor = (data) => api.post('/doctors', data)
export const updateDoctor = (id, data) => api.put(`/doctors/${id}`, data)
export const deactivateDoctor = (id) => api.delete(`/doctors/${id}`)
