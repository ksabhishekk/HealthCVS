import { useState } from 'react'
import { Upload, CheckCircle2, X, ExternalLink, AlertCircle } from 'lucide-react'
import { uploadDocument } from '../../../api/documents'

const GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud'

// All 9 Indian health insurance document requirements
const REQUIRED_DOCS = [
  { type: 'insurance_card',        label: 'Insurance Card / Policy Copy (current year)', required: true, always: true },
  { type: 'patient_kyc',           label: 'Patient Aadhaar Card & PAN Card', required: true, always: true },
  { type: 'consultation_papers',   label: 'Doctor\'s Consultation Papers (all OPD prescriptions)', required: true, always: true },
  { type: 'investigation_reports', label: 'Investigation Reports (lab/radiology)', required: true, always: true },
  { type: 'employee_id',           label: 'Employee PAN & Aadhaar Card (corporate policy)', required: false, showWhen: 'corporate' },
  { type: 'proposer_id',           label: 'Proposer PAN & Aadhaar Card (if patient ≠ proposer)', required: false, showWhen: 'proposer' },
  { type: 'transfer_summary',      label: '1st Consultation / Transfer Summary (if transfer case)', required: false, showWhen: 'transfer' },
  { type: 'estimate',              label: 'Surgery Estimate Copy (if planned surgery)', required: false, showWhen: 'surgery' },
]

function DocSlot({ doc, uploaded, onUpload, onRemove }) {
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    setProgress(0)
    try {
      const { data } = await uploadDocument(file, (p) => setProgress(p))
      onUpload({ type: doc.type, cid: data.cid, fileName: data.fileName, fileSize: data.fileSize, url: data.url })
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className={`border rounded-lg p-4 transition-colors ${uploaded ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-800 leading-tight">{doc.label}</span>
            {doc.required && <span className="badge bg-red-100 text-red-600 text-xs">Required</span>}
          </div>

          {uploaded ? (
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-xs text-green-700 font-mono truncate">{uploaded.fileName}</span>
              <a href={`https://${GATEWAY}/ipfs/${uploaded.cid}`} target="_blank" rel="noreferrer"
                className="text-blue-600 hover:text-blue-700 shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button onClick={onRemove} className="text-gray-400 hover:text-red-500 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              className="mt-2 border-2 border-dashed border-gray-200 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => document.getElementById(`file-${doc.type}`).click()}
            >
              <input
                id={`file-${doc.type}`}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={e => handleFile(e.target.files?.[0])}
              />
              {loading ? (
                <div className="text-xs text-blue-600">
                  <div className="w-full bg-blue-100 rounded-full h-1.5 mb-1">
                    <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  Uploading to IPFS… {progress}%
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Upload className="w-3.5 h-3.5" />
                  Drop PDF/image or click — uploads to IPFS
                </div>
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
        </div>
      </div>
    </div>
  )
}

export default function Step4Documents({ data, update, onNext, onBack }) {
  const { documents, medical, insurance } = data

  const getUploaded = (type) => documents.find(d => d.type === type)
  const handleUpload = (docData) => {
    update({ documents: [...documents.filter(d => d.type !== docData.type), docData] })
  }
  const handleRemove = (type) => {
    update({ documents: documents.filter(d => d.type !== type) })
  }

  // Determine which docs are applicable
  const applicableDocs = REQUIRED_DOCS.filter(doc => {
    if (doc.always) return true
    if (doc.showWhen === 'corporate' && insurance?.policyType === 'corporate') return true
    if (doc.showWhen === 'proposer' && insurance?.isProposerDifferent) return true
    if (doc.showWhen === 'transfer' && medical?.isTransferCase) return true
    if (doc.showWhen === 'surgery' && medical?.isPlannedSurgery) return true
    return false
  })

  const requiredDocs = applicableDocs.filter(d => d.required)
  const requiredUploaded = requiredDocs.every(d => getUploaded(d.type))

  return (
    <div className="max-w-2xl space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        All documents are uploaded to IPFS (Pinata). CIDs are stored immutably on the blockchain with the claim.
      </div>

      <div className="space-y-3">
        {applicableDocs.map(doc => (
          <DocSlot
            key={doc.type}
            doc={doc}
            uploaded={getUploaded(doc.type)}
            onUpload={handleUpload}
            onRemove={() => handleRemove(doc.type)}
          />
        ))}
      </div>

      {!requiredUploaded && (
        <p className="text-sm text-amber-600 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Please upload all required documents before proceeding.
        </p>
      )}

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={!requiredUploaded}>
          Review & Submit
        </button>
      </div>
    </div>
  )
}
