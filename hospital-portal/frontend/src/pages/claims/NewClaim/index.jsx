import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowLeft } from 'lucide-react'
import { submitClaim } from '../../../api/claims'
import Step1Patient from './Step1Patient'
import Step2Insurance from './Step2Insurance'
import Step3Medical from './Step3Medical'
import Step4Documents from './Step4Documents'
import Step5Review from './Step5Review'

const STEPS = [
  { label: 'Patient' },
  { label: 'Insurance' },
  { label: 'Medical' },
  { label: 'Documents' },
  { label: 'Submit' },
]

const INITIAL = {
  // Step 1
  patient: null,           // { _id, name, aadhaarLast4, ... }
  aadhaarHash: '',
  admission: { admissionDate: '', dischargeDate: '', contactNumber: '' },

  // Step 2
  insurance: {
    company: '', policyNumber: '', policyType: '',
    isProposerDifferent: false, proposerName: '', proposerAadhaarLast4: '', proposerPan: '',
    employeeId: '', employerName: '',
  },

  // Step 3
  medical: {
    doctorName: '', department: '', diagnosis: '', icdCode: '',
    procedureCode: '', claimedAmount: '',
    isTransferCase: false, transferHospitalName: '',
    isPlannedSurgery: false,
  },

  // Step 4
  documents: [],   // [{ type, cid, fileName, fileSize }]
}

export default function NewClaim() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [data, setData] = useState(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (patch) => setData(d => ({ ...d, ...patch }))

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        aadhaarHash: data.aadhaarHash,
        patient: {
          name: data.patient?.name,
          aadhaarLast4: data.patient?.aadhaarLast4,
          panNumber: data.patient?.panNumber,
          dateOfBirth: data.patient?.dateOfBirth,
          gender: data.patient?.gender,
          bloodGroup: data.patient?.bloodGroup,
          contactNumber: data.admission.contactNumber || data.patient?.contactNumber,
          address: data.patient?.address,
        },
        admission: data.admission,
        insurance: data.insurance,
        medical: { ...data.medical, claimedAmount: Number(data.medical.claimedAmount) },
        documents: data.documents,
      }
      const { data: result } = await submitClaim(payload)
      navigate(`/claims/${result.blockchainClaimId}`, { state: { submitted: true, txHash: result.txHash } })
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed. Check console for details.')
      setSubmitting(false)
    }
  }

  const stepProps = { data, update, onNext: next, onBack: back }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/claims')} className="btn-secondary py-1.5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-xl font-bold text-gray-900">New Insurance Claim</h1>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < step ? 'bg-blue-600 border-blue-600 text-white'
                : i === step ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-gray-200 text-gray-400 bg-white'
              }`}>
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs mt-1 font-medium ${i === step ? 'text-blue-600' : i < step ? 'text-gray-700' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-16 mt-[-12px] mx-1 ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && <Step1Patient {...stepProps} />}
      {step === 1 && <Step2Insurance {...stepProps} />}
      {step === 2 && <Step3Medical {...stepProps} />}
      {step === 3 && <Step4Documents {...stepProps} />}
      {step === 4 && (
        <Step5Review
          {...stepProps}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
