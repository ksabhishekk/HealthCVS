# HealthCVS

Blockchain-anchored health insurance claim verification with explainable AI fraud detection — a shared claims network
between hospitals and insurers, in the model of NHA's National Health Claims Exchange.

```
Hospital portal ──TX2/TX3──┐                 ┌── Insurer portal (TX1, TX5–TX7)
  (React + Express)         ▼                 ▼     (React + Express + AI oracle)
                     Ethereum contracts (Ganache locally)
                     RoleManager · PatientRegistry · ClaimSubmission · AutoAdjudication
                            ▲                              │
              IPFS (Pinata): documents, claim metadata,    └── AI service (FastAPI): forgery CNN,
              AI explanations — content-addressed              OCR, XGBoost + IsolationForest, PubMedBERT,
                                                               NMC doctor registry
```

## The seven on-chain steps

| TX | Who | What |
|----|-----|------|
| 1 | Insurer | Registers a policy and each insured member (only the Aadhaar hash goes on-chain) |
| 2 | Hospital | Files a claim under a policy — refused unless the patient was a covered member on the admission date |
| 3 | Doctor | Authenticates the treatment; this event wakes the insurer's AI oracle |
| 4 | Oracle | Writes the AI fraud score (0–100) |
| 5 | Contract | Applies package rates, co-payment and the remaining sum insured; flags scores ≥ 75 |
| 6 | Insurer | Human review — approval drawn from the member's sum insured, never beyond it |
| 7 | Insurer | Settlement of the approved amount |

Every claim is bound to the insurer that issued its policy; only that insurer can act on it at TX5–TX7.

## Policy types

| Type | Who shares a sum insured | Notes |
|------|--------------------------|-------|
| Individual | each insured person | 30-day initial waiting period for illness |
| Family floater | the whole family | dependent children up to 25 |
| Corporate (employer group) | each employee's family | waiting periods waived; dependants lose cover when the employee leaves |
| Group (non-employer) | each member | associations, bank customers; member IDs |
| Government (AB PM-JAY) | the whole family | ₹5 lakh per family per year, no waiting period, package rates binding |

Sum-insured pools, member status and cover periods are enforced by `contracts/PatientRegistry.sol`; enrolment rules
(relationships, ages, holder identifiers) by `insurance-portal/backend/src/services/policyRules.js`.

## Running locally

Prerequisites: Node 20+, Python 3.10+ with `ai-service/venv`, Ganache GUI on port 8545, MongoDB, and in the `.env`
files (see each `.env.example`): a Pinata JWT, an Apify token for NMC doctor lookups, SMTP or Twilio for consent OTPs.
Commands are PowerShell, from the repository root.

```powershell
npm install
npx hardhat test          # 36 contract tests
.\start-local.ps1         # deploy to Ganache, load the rate card, grant roles, write addresses into both .env files
```

Claim IDs restart at 1 on a fresh deployment, so after redeploying move the insurer's old claim records aside
(they are copied to `claims_archive`, not deleted):

```powershell
cd insurance-portal\backend; node scripts\archiveStaleClaims.js --apply
```

Then start each service in its own terminal:

```powershell
cd ai-service; .\venv\Scripts\python -m uvicorn main:app --port 8000
cd insurance-portal\backend; npm run dev     # :5001, also runs the AI oracle
cd hospital-portal\backend; npm run dev      # :5000
cd insurance-portal\frontend; npm run dev    # :5174
cd hospital-portal\frontend; npm run dev     # :5173
```

First-time data (staff logins, the network-hospital entry, the hospital's doctors and procedure catalog):

```powershell
cd insurance-portal\backend; npm run seed; npm run seed:hospitals
cd hospital-portal\backend; npm run seed; node scripts\seedCatalog.js
```

## Demo data

`config/demo_scenarios.json` defines six policies (one of each type, plus a person holding two policies) and twelve
claims covering clean, partial and fraudulent cases.

```powershell
cd insurance-portal\backend; node scripts\seedDemoPolicies.js --email you@gmail.com   # issue the policies on-chain
.\ai-service\venv\Scripts\python scripts\generate_demo_documents.py           # documents → notes\demo_documents\
```

Consent OTPs go to plus-addresses of the e-mail given (`you+mehta@gmail.com`, …), so one inbox receives them all.
`notes\demo_documents\DEMO_CLAIMS.txt` lists every value to enter.

The demo doctor (NMC 5002) is checked against the live NMC register, which takes 1–5 minutes; a result is cached for
30 days. Warm the cache before presenting, with the AI service running:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/verify-doctor -ContentType application/json -Body '{"doctor_reg_no":"5002, 15002"}'
```

## More

- `docs/gaps_and_limitations.md` — what the prototype does not do, and why
- `docs/architecture_diagrams.html` — architecture diagrams
- `config/procedure_rates.json` — the package-rate card loaded on-chain at deployment
