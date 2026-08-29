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
      {children}
    </div>
  )
}

function Grid({ children }) {
  return <dl className="grid grid-cols-2 gap-3">{children}</dl>
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

  const totalAmount = (medical?.procedures || []).reduce((s, p) => s + (Number(p.claimedAmount) || 0), 0)
  const primaryProcedure = (medical?.procedures || []).reduce(
    (max, p) => Number(p.claimedAmount) > Number(max?.claimedAmount || 0) ? p : max,
    null
  )

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        Review all details carefully. Once submitted, this claim is recorded immutably on the blockchain and cannot be modified.
      </div>

      <Section title="Patient & Admission">
        <Grid>
          <Row label="Patient Name" value={patient?.name} />
          <Row label="Aadhaar" value={patient?.aadhaarLast4 ? `xxxx-xxxx-${patient.aadhaarLast4}` : '—'} />
          <Row label="DOB" value={fmtDate(patient?.dateOfBirth)} />
          <Row label="Gender" value={patient?.gender} />
          <Row label="Admission Date" value={fmtDate(admission?.admissionDate)} />
          <Row label="Discharge Date" value={fmtDate(admission?.dischargeDate)} />
          <Row label="Contact No." value={admission?.contactNumber} />
        </Grid>
      </Section>

      <Section title="Insurance">
        <Grid>
          <Row label="Company" value={insurance?.company} />
          <Row label="Policy Number" value={insurance?.policyNumber} />
          <Row label="Policy Type" value={insurance?.policyType} />
          {insurance?._verified && <Row label="Coverage" value={fmt(insurance._coverageAmount)} />}
          {insurance?.isProposerDifferent && <>
            <Row label="Proposer" value={insurance?.proposerName} />
            <Row label="Proposer PAN" value={insurance?.proposerPan} />
          </>}
          {insurance?.policyType === 'corporate' && <>
            <Row label="Employee ID" value={insurance?.employeeId} />
            <Row label="Employer" value={insurance?.employerName} />
          </>}
        </Grid>
        {insurance?._verified && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> Policy verified with insurer
          </div>
        )}
        {!insurance?._verified && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600">
            <AlertCircle className="w-3.5 h-3.5" /> Policy not verified — proceeding without confirmation
          </div>
        )}
      </Section>

      <Section title="Medical">
        {/* Doctors */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Treating Doctors</div>
          {(medical?.doctors || []).length === 0 ? (
            <span className="text-sm text-gray-400 italic">—</span>
          ) : (
            <ul className="space-y-1">
              {(medical.doctors).map((d, i) => (
                <li key={i} className="text-sm font-medium text-gray-900">
                  {d.name} <span className="text-gray-500 font-normal">— {d.department}{d.specialization ? ` (${d.specialization})` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Grid>
          <Row label="Diagnosis" value={medical?.diagnosis} />
          <Row label="ICD Code" value={medical?.icdCode} />
          {medical?.isTransferCase && <Row label="Transferred From" value={medical?.transferHospitalName} />}
          {medical?.isPlannedSurgery && <Row label="Note" value="Planned Surgery" />}
        </Grid>

        {/* Procedures table */}
        {(medical?.procedures || []).length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Procedures / Treatments</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b">
                  <th className="text-left pb-1.5">Code</th>
                  <th className="text-left pb-1.5">Procedure</th>
                  <th className="text-right pb-1.5">Amount</th>
                  <th className="text-right pb-1.5 text-xs text-blue-500">On-chain?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(medical.procedures).map((p, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-mono text-xs text-gray-600">{p.code}</td>
                    <td className="py-1.5 text-gray-900">{p.name}</td>
                    <td className="py-1.5 text-right font-medium">{fmt(p.claimedAmount)}</td>
                    <td className="py-1.5 text-right text-xs text-gray-400">
                      {p.code === primaryProcedure?.code ? '✓ primary' : 'IPFS only'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t">
                  <td colSpan={2} className="pt-2 text-xs text-gray-500">Total claimed on-chain</td>
                  <td colSpan={2} className="pt-2 text-right font-bold text-gray-900">{fmt(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
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
            <><Loader2 className="w-4 h-4 animate-spin" /> Submitting to Blockchain…</>
          ) : (
            <><FileText className="w-4 h-4" /> Submit Claim (TX2)</>
          )}
        </button>
      </div>

      {submitting && (
        <div className="text-xs text-gray-500 text-center space-y-1">
          <p>1. Uploading claim metadata to IPFS…</p>
          <p>2. Signing & broadcasting transaction to blockchain…</p>
          <p>3. Waiting for block confirmation…</p>
        </div>
      )}
    </div>
  )
}
