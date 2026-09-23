import { Building2, CheckCircle2, ShieldCheck, MapPin, Phone, Mail, Globe, Clock, Stethoscope, Users, Star, Wifi } from 'lucide-react'

const HOSPITAL = {
  name: 'City General Hospital',
  code: 'CGH001',
  tagline: 'Empanelled Partner Hospital',
  address: '14, Healthcare Avenue, Koramangala, Bengaluru – 560034, Karnataka',
  phone: '+91 80 2234 5678',
  emergency: '+91 80 2234 5600',
  email: 'admin@citygeneralhospital.in',
  website: 'www.citygeneralhospital.in',
  type: 'Multi-speciality',
  beds: 450,
  established: 2008,
  accreditation: 'NABH Accredited',
  operatingHours: '24 × 7 — Emergency & OPD',
  specialities: [
    'Cardiology & Cardiac Surgery',
    'Orthopaedics & Joint Replacement',
    'Oncology & Chemotherapy',
    'Neurology & Neurosurgery',
    'Nephrology & Dialysis',
    'Gastroenterology',
    'Pulmonology & Critical Care',
    'Obstetrics & Gynaecology',
  ],
  wallets: [
    '0x384aB8a0b0d3e5e490C93B33C613d1A5c074293bc',
  ],
  empanelledSince: '1 April 2023',
  empanelledUntil: 'No expiry',
  status: 'active',
  cashlessLimit: '₹5,00,000',
  tpaCode: 'CGH-SHI-2023',
  claimEmail: 'claims@citygeneralhospital.in',
}

const InfoRow = ({ icon: Icon, label, value, mono }) => (
  <div className="flex items-start gap-3">
    <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
      <Icon className="w-4 h-4 text-gray-500" />
    </div>
    <div>
      <div className="text-xs text-gray-400 font-medium">{label}</div>
      <div className={`text-sm text-gray-900 font-medium ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  </div>
)

export default function Hospitals() {
  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Partner Hospital</h1>
        <p className="text-sm text-gray-500 mt-1">
          Star Health Insurance is exclusively partnered with one empanelled hospital for the HealthCVS claim verification system.
        </p>
      </div>

      {/* Hero banner */}
      <div className="card overflow-hidden mb-6">
        <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 px-8 py-10 text-white relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white/5" />
          <div className="absolute -bottom-12 -right-4 w-64 h-64 rounded-full bg-white/5" />
          <div className="absolute top-4 right-40 w-24 h-24 rounded-full bg-white/5" />

          <div className="relative z-10 flex items-start gap-6">
            <div className="w-20 h-20 bg-white/15 rounded-2xl flex items-center justify-center shrink-0 backdrop-blur-sm border border-white/25">
              <Building2 className="w-10 h-10 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-3xl font-bold">{HOSPITAL.name}</h2>
                <span className="flex items-center gap-1.5 bg-white/20 text-white text-xs px-3 py-1 rounded-full font-semibold backdrop-blur-sm">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
                <span className="flex items-center gap-1.5 bg-emerald-400/30 text-white text-xs px-3 py-1 rounded-full font-semibold">
                  <Star className="w-3 h-3" /> NABH Accredited
                </span>
              </div>
              <p className="text-emerald-100 text-sm flex items-center gap-1.5 mb-3">
                <MapPin className="w-4 h-4 shrink-0" />
                {HOSPITAL.address}
              </p>
              <div className="flex gap-6 text-sm text-emerald-100 flex-wrap">
                <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {HOSPITAL.beds} Beds</span>
                <span className="flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> {HOSPITAL.type}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Est. {HOSPITAL.established}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">

        {/* Left column: Contact & General */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Contact Information</h3>
            <div className="space-y-4">
              <InfoRow icon={Phone} label="General Line" value={HOSPITAL.phone} />
              <InfoRow icon={Phone} label="Emergency" value={HOSPITAL.emergency} />
              <InfoRow icon={Mail} label="Administration" value={HOSPITAL.email} />
              <InfoRow icon={Globe} label="Website" value={HOSPITAL.website} />
              <InfoRow icon={Clock} label="Hours" value={HOSPITAL.operatingHours} />
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Empanelment Status</h3>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">Current Status</div>
                <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-sm font-semibold px-3 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
              </div>
              <InfoRow icon={Building2} label="Hospital Code" value={HOSPITAL.code} mono />
              <InfoRow icon={ShieldCheck} label="TPA Code" value={HOSPITAL.tpaCode} mono />
              <InfoRow icon={Clock} label="Empanelled Since" value={HOSPITAL.empanelledSince} />
              <InfoRow icon={Clock} label="Valid Until" value={HOSPITAL.empanelledUntil} />
            </div>
          </div>
        </div>

        {/* Middle column: Specialities */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Medical Specialities</h3>
            <div className="space-y-2">
              {HOSPITAL.specialities.map(s => (
                <div key={s} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-sm text-gray-700">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Blockchain & Claim info */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Claims Configuration</h3>
            <div className="space-y-4">
              <InfoRow icon={Mail} label="Claims Email" value={HOSPITAL.claimEmail} />
              <div>
                <div className="text-xs text-gray-400 mb-1">Cashless Claim Limit</div>
                <div className="text-2xl font-bold text-emerald-600">{HOSPITAL.cashlessLimit}</div>
                <div className="text-xs text-gray-400 mt-0.5">per policy, per annum</div>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Blockchain Identity</h3>
            <p className="text-xs text-gray-500 mb-4">
              Claims submitted on-chain (TX2) must be signed by one of the wallets below. This prevents any other party from submitting claims in the name of this hospital.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-semibold text-gray-700">Authorized Signing Wallets</span>
            </div>
            {HOSPITAL.wallets.map((w, i) => (
              <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-2">
                <div className="font-mono text-xs text-gray-700 break-all">{w}</div>
              </div>
            ))}
            <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Verified on Polygon Amoy testnet
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
