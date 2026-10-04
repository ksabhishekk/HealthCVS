import api from './client'

const enc = encodeURIComponent

export const getPolicyTypes  = ()                 => api.get('/policies/types')
export const getNextPolicyId = (type)             => api.get('/policies/next-id', { params: { type } })
export const getPolicies     = (params)           => api.get('/policies', { params })
export const getPolicy       = (policyId)         => api.get(`/policies/${enc(policyId)}`)
export const createPolicy    = (data)             => api.post('/policies', data)
export const addMembers      = (policyId, members, coverStart) => api.post(`/policies/${enc(policyId)}/members`, { members, coverStart })
export const updatePolicy    = (policyId, data)   => api.patch(`/policies/${enc(policyId)}`, data)
export const lookupPerson    = (aadhaarNumber)    => api.post('/policies/lookup', { aadhaarNumber })

// Member IDs look like "SHI-FFL-2026-000101/02".
export const updateMember = (memberId, data) => {
  const [policyId, memberNo] = memberId.split('/')
  return api.patch(`/policies/${enc(policyId)}/members/${enc(memberNo)}`, data)
}
