import api from './client'

export const getStaff = (params) => api.get('/staff', { params })
export const getStaffMember = (id) => api.get(`/staff/${id}`)
export const createStaff = (data) => api.post('/staff', data)
export const updateStaff = (id, data) => api.put(`/staff/${id}`, data)
export const resetPassword = (id, password) => api.patch(`/staff/${id}/password`, { password })
export const toggleActive = (id) => api.patch(`/staff/${id}/toggle-active`)
