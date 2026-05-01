import { Loader2, AlertCircle, FileText, CheckCircle2 } from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const DOC_LABELS = {
  insurance_card: 'Insurance Card / Policy Copy',
  employee_id: 'Employee PAN & Aadhaar',
  proposer_id: 'Proposer PAN & Aadhaar',
  patient_kyc: 'Patient Aadhaar & PAN',
  consultation_papers: 'Consultation Papers',
  investigation_reports: 'Investigation Reports',
  transfer_summary: 'Transfer Summary',
  estimate: 'Surgery Estimate',
}

function Section({ title, children }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">{title}</h3>
      <dl className="grid grid-cols-2 gap-3">{children}</dl>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 mt-0.5">{value || <span className="text-gray-400 italic font-normal">—</span>}</dd>
    </div>
  )
}

export default function Step5Review({ data, onBack, onSubmit, submitting, error }) {
  const { patient, admission, insurance, medical, documents } = data

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        Review all details carefully. Once submitted, this claim is recorded immutably on the Polygon blockchain and cannot be modified.
      </div>

      <Section title="Patient & Admission">
        <Row label="Patient Name" value={patient?.name} />
        <Row label="Aadhaar" value={patient?.aadhaarLast4 ? `xxxx-xxxx-${patient.aadhaarLast4}` : '—'} />
        <Row label="DOB" value={fmtDate(patient?.dateOfBirth)} />
        <Row label="Gender" value={patient?.gender} />
        <Row label="Admission Date" value={fmtDate(admission?.admissionDate)} />
        <Row label="Discharge Date" value={fmtDate(admission?.dischargeDate)} />
        <Row label="Contact No." value={admission?.contactNumber} />
      </Section>

      <Section title="Insurance">
        <Row label="Company" value={insurance?.company} />
        <Row label="Policy Number" value={insurance?.policyNumber} />
        <Row label="Policy Type" value={insurance?.policyType} />
        {insurance?.isProposerDifferent && <>
          <Row label="Proposer" value={insurance?.proposerName} />
          <Row label="Proposer PAN" value={insurance?.proposerPan} />
        </>}
        {insurance?.policyType === 'corporate' && <>
          <Row label="Employee ID" value={insurance?.employeeId} />
          <Row label="Employer" value={insurance?.employerName} />
        </>}
      </Section>

      <Section title="Medical">
        <Row label="Doctor" value={medical?.doctorName} />
        <Row label="Department" value={medical?.department} />
        <Row label="Diagnosis" value={medical?.diagnosis} />
        <Row label="ICD Code" value={medical?.icdCode} />
        <Row label="Procedure Code" value={medical?.procedureCode} />
        <Row label="Claimed Amount" value={fmt(medical?.claimedAmount)} />
        {medical?.isTransferCase && <Row label="Transferred From" value={medical?.transferHospitalName} />}
        {medical?.isPlannedSurgery && <Row label="Note" value="Planned Surgery" />}
      </Section>

      {/* Documents */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-3 pb-2 border-b">Documents ({documents.length})</h3>
        {documents.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No documents uploaded.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-gray-700 font-medium">{DOC_LABELS[doc.type] || doc.type}</span>
                <span className="text-gray-400 font-mono text-xs truncate">{doc.fileName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <button className="btn-secondary" onClick={onBack} disabled={submitting}>Back</button>
        <button className="btn-primary" onClick={onSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting to Blockchain…
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              Submit Claim (TX2)
            </>
          )}
        </button>
      </div>

      {submitting && (
        <div className="text-xs text-gray-500 text-center space-y-1">
          <p>1. Uploading claim metadata to IPFS…</p>
          <p>2. Signing & broadcasting transaction to Polygon Amoy…</p>
          <p>3. Waiting for block confirmation…</p>
        </div>
      )}
    </div>
  )
}
