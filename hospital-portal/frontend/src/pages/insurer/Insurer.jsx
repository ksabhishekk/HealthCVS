import { ShieldCheck, CheckCircle2, MapPin, Phone, Mail, Globe, Clock, Wifi, FileText, Building2, Star } from 'lucide-react'

const INSURER = {
  name: 'Star Health Insurance',
  code: 'SHI001',
  tagline: 'Empanelled Insurance Partner',
  address: '1, New Tank Street, Valluvarkottam High Road, Nungambakkam, Chennai – 600034, Tamil Nadu',
  phone: '+91 44 2828 8800',
  toll_free: '1800 425 2255',
  email: 'info@starhealth.in',
  claimsEmail: 'claims@starhealth.in',
  website: 'www.starhealth.in',
  operatingHours: '24 × 7 — Claims & Customer Care',
  established: 2006,
  type: 'Standalone Health Insurer',
  regNumber: 'IRDAI Reg. No. 129',
  tpaCode: 'CGH-SHI-2023',
  partnerSince: '1 April 2023',
  partnerUntil: 'No expiry',
  status: 'active',
  products: [
    'Star Comprehensive Insurance Policy',
    'Star Family Health Optima',
    'Star Senior Citizens Red Carpet',
    'Star Super Surplus (Floater)',
    'Medi-Classic Insurance Policy',
    'Star Critical Illness Multipay',
    'PM-JAY / Ayushman Bharat (Govt. Scheme)',
    'Group Health Insurance (Corporate)',
  ],
  wallets: [
    '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
  ],
  cashlessLimit: '₹5,00,000',
  settlementSLA: '7 working days (cashless pre-auth: 1–2 hrs)',
  irdaiReg: '129',
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

export default function Insurer() {
  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Insurance Partner</h1>
        <p className="text-sm text-gray-500 mt-1">
          City General Hospital is exclusively empanelled with one insurer for the HealthCVS claim verification system.
        </p>
      </div>

      {/* Hero banner */}
      <div className="card overflow-hidden mb-6">
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 px-8 py-10 text-white relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white/5" />
          <div className="absolute -bottom-12 -right-4 w-64 h-64 rounded-full bg-white/5" />
          <div className="absolute top-4 right-40 w-24 h-24 rounded-full bg-white/5" />

          <div className="relative z-10 flex items-start gap-6">
            <div className="w-20 h-20 bg-white/15 rounded-2xl flex items-center justify-center shrink-0 backdrop-blur-sm border border-white/25">
              <ShieldCheck className="w-10 h-10 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h2 className="text-3xl font-bold">{INSURER.name}</h2>
                <span className="flex items-center gap-1.5 bg-white/20 text-white text-xs px-3 py-1 rounded-full font-semibold backdrop-blur-sm">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
                <span className="flex items-center gap-1.5 bg-blue-400/30 text-white text-xs px-3 py-1 rounded-full font-semibold">
                  <Star className="w-3 h-3" /> IRDAI Reg. {INSURER.irdaiReg}
                </span>
              </div>
              <p className="text-blue-100 text-sm flex items-center gap-1.5 mb-3">
                <MapPin className="w-4 h-4 shrink-0" />
                {INSURER.address}
              </p>
              <div className="flex gap-6 text-sm text-blue-100 flex-wrap">
                <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> {INSURER.type}</span>
                <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Est. {INSURER.established}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">

        {/* Left column: Contact & Partnership */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Contact Information</h3>
            <div className="space-y-4">
              <InfoRow icon={Phone} label="Head Office" value={INSURER.phone} />
              <InfoRow icon={Phone} label="Toll-Free" value={INSURER.toll_free} />
              <InfoRow icon={Mail} label="General Enquiry" value={INSURER.email} />
              <InfoRow icon={Mail} label="Claims Desk" value={INSURER.claimsEmail} />
              <InfoRow icon={Globe} label="Website" value={INSURER.website} />
              <InfoRow icon={Clock} label="Hours" value={INSURER.operatingHours} />
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Partnership Status</h3>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">Current Status</div>
                <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-sm font-semibold px-3 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
              </div>
              <InfoRow icon={ShieldCheck} label="Insurer Code" value={INSURER.code} mono />
              <InfoRow icon={FileText} label="TPA Code" value={INSURER.tpaCode} mono />
              <InfoRow icon={Clock} label="Partner Since" value={INSURER.partnerSince} />
              <InfoRow icon={Clock} label="Valid Until" value={INSURER.partnerUntil} />
            </div>
          </div>
        </div>

        {/* Middle column: Products */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Insurance Products</h3>
            <div className="space-y-2">
              {INSURER.products.map(p => (
                <div key={p} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span className="text-sm text-gray-700">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Claims config & Blockchain */}
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Claims Configuration</h3>
            <div className="space-y-4">
              <InfoRow icon={Mail} label="Claims Email" value={INSURER.claimsEmail} />
              <div>
                <div className="text-xs text-gray-400 mb-1">Cashless Claim Limit</div>
                <div className="text-2xl font-bold text-blue-600">{INSURER.cashlessLimit}</div>
                <div className="text-xs text-gray-400 mt-0.5">per policy, per annum</div>
              </div>
              <InfoRow icon={Clock} label="Settlement SLA" value={INSURER.settlementSLA} />
              <InfoRow icon={FileText} label="IRDAI Reg. No." value={INSURER.regNumber} mono />
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Blockchain Identity</h3>
            <p className="text-xs text-gray-500 mb-4">
              Claim approvals (TX3) from the insurer must be signed by one of the authorized wallets below. This prevents any forged approvals.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Authorized Signing Wallets</span>
            </div>
            {INSURER.wallets.map((w, i) => (
              <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-2">
                <div className="font-mono text-xs text-gray-700 break-all">{w}</div>
              </div>
            ))}
            <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
              Verified on Blockchain
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
