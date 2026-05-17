import api from './client'

export const getProcedures = () => api.get('/procedures')
export const createProcedure = (data) => api.post('/procedures', data)
export const updateProcedure = (id, data) => api.put(`/procedures/${id}`, data)
export const deactivateProcedure = (id) => api.delete(`/procedures/${id}`)
