# HealthCVS: Blockchain Layer

How the blockchain layer is designed and built, and what is still open.

**Status (October 2026):** all four contracts and the full seven-transaction lifecycle are built and tested
(36 Hardhat tests) and run end to end on a local Ganache chain with demo data. For setup commands see the
[README](README.md).

---

## 1. Stack

| Layer               | Technology                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| Contracts           | Solidity 0.8.20, OpenZeppelin `AccessControl`                               |
| Dev and test        | Hardhat (36 contract tests)                                                 |
| Local chain         | Ganache                                                                     |
| Client library      | ethers.js                                                                   |
| Document storage    | IPFS through Pinata, referenced on-chain by content identifier (CID)        |
| Portals             | React 18 + Vite frontends, Express backends                                 |
| Oracle              | In-process worker inside the insurer backend, calling the FastAPI AI service |

---

## 2. Smart contracts

| Contract             | Responsibility                                                                                                      | TX     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| `RoleManager`        | Built on OpenZeppelin `AccessControl`. Defines the admin, insurer, hospital-clerk and doctor roles; every other contract checks permissions here | none |
| `PatientRegistry`    | Policies and insured members, keyed by Aadhaar hash; sum-insured pools, member status and cover periods            | TX1    |
| `ClaimSubmission`    | The claim record and its status machine (eight statuses), document CIDs, fraud score, and an event for every change | TX2–TX4 |
| `AutoAdjudication`   | The PM-JAY package-rate card, itemised adjudication, the fraud threshold, and recommended and approved amounts      | TX5–TX7 |

Contract sources are in [`contracts/`](contracts) and tests in [`test/`](test). Enrolment rules that are easier to
express off-chain (relationships, ages, holder identifiers) live in
`insurance-portal/backend/src/services/policyRules.js`; everything about money and membership status is enforced
on-chain.

---

## 3. The seven-transaction audit trail

Every stage of the real-world workflow is recorded as its own signed, timestamped transaction.

| TX | Stage                   | Signed by                    | What is written on-chain                                                                               |
| -- | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1  | Policy and enrolment    | Insurer                      | Policy and each insured member, keyed by the keccak-256 hash of the Aadhaar number                     |
| 2  | Claim submission        | Hospital clerk               | PM-JAY procedure code, total claimed amount, IPFS CIDs of bill, prescription and metadata; refused unless the patient was a covered member on the admission date |
| 3  | Doctor authentication   | Doctor role                  | Medical sign-off; emits the `DoctorAuthenticated` event that wakes the AI oracle                       |
| 4  | Fraud score             | Oracle wallet                | Score from 0 to 100; the explanation is pinned to IPFS and referenced by CID                           |
| 5  | Automated adjudication  | Insurer backend, contract logic | Every billed procedure checked against its ceiling; claims scoring 75 or more are flagged            |
| 6  | Insurer review          | Insurer reviewer             | Approve in full, approve a reduced amount, or reject; approval is drawn from the member's sum insured, never beyond it |
| 7  | Settlement              | Insurer (finance)            | Claim marked Settled and the approved amount recorded; simulated, no funds move                          |

Every claim is bound to the insurer that issued its policy; only that insurer can act on it at TX5–TX7.

**Claim IDs.** They restart at 1 on a fresh deployment. After redeploying, run the stale-claim archive script
described in the README so old records do not collide with new ones.

---

## 4. From doctor sign-off to fraud score (TX3 to TX4)

TX4 is the only transaction fired automatically. The oracle worker reaches the same scoring pipeline by three routes
and guards against scoring a claim twice:

1. **Live event:** an ethers subscription fires the moment TX3 confirms.
2. **Startup catch-up scan:** on start, every claim still waiting for a score is picked up, which recovers events missed while offline.
3. **Manual re-run:** an admin can trigger scoring from the claim page.

The worker then loads the claim from the chain and its metadata from IPFS, calls the AI service for document
forensics, bill reconciliation, the tabular fraud model, medical-language checks and cross-claim checks, combines
them into one 0–100 score, pins the explanation to IPFS, and writes the score on-chain as TX4. The chain write
happens last, so the portal can briefly hold a score the chain does not yet have, but never the reverse. On failure
the worker retries three times with backoff, then marks the claim for the reviewer; a failed IPFS pin does not block
TX4.

How the score is computed is covered in the Level 2 diagram in [`docs/`](docs).

At TX5 the contract applies three checks before a claim can be auto-approved: fraud score below 75, every procedure
present in the rate catalog, and no claimed amount above its ceiling. A claim that fails any check goes to manual
review, and even auto-approved claims still pass through insurer review at TX6.

---

## 5. Where data lives

| Where                  | What                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| **On-chain**           | Aadhaar hash, policy and member status, procedure code, claimed amount, document CIDs, clerk address (who signed TX2), fraud score, claim status, approved amount, and an event for every change |
| **IPFS (Pinata)**      | Bill, prescription and discharge documents; the claim metadata bundle (itemised procedures, doctors, hospital, insurance and consent details); the AI explanation JSON |
| **MongoDB (per portal)** | Working data for the portals: staff logins, doctors, procedure catalogs, consent records, and the insurer's view of claims (scores, findings, reviews) |

Principles behind the split:

- **No personal data on-chain.** Only the Aadhaar hash is stored; large or sensitive documents stay on IPFS and the chain keeps only their content addresses, which also keeps gas costs low.
- **The chain is the record.** Claim state transitions, signers and timestamps are authoritative on-chain; MongoDB holds a working copy that can be rebuilt from the chain and IPFS.
- **Accountability by address.** The wallet that performed each step is recorded, so each action can be attributed to a role.

---

## 6. Rules the contracts enforce

- **Cover on the admission date.** A claim is refused at TX2 unless the patient was a covered member on that date.
- **Sum insured.** Approval is drawn from the member's (or family's) shared pool and can never exceed what remains.
- **Package rates.** Each billed procedure is checked against the PM-JAY rate card loaded on-chain at deployment
  (from [`config/procedure_rates.json`](config/procedure_rates.json)), and the government policy type makes those rates binding.
- **Fraud threshold.** A score of 75 or more flags the claim for human attention.
- **Insurer binding.** A claim can only be acted on at TX5–TX7 by the insurer that issued its policy.
- **Role separation.** Hospital staff, doctors, the oracle and insurer staff each hold distinct roles in `RoleManager`.

Policy types supported: individual, family floater, corporate (employer group), group (non-employer) and government
(AB PM-JAY).

---

## 7. Running it

Deployment is one script: `start-local.ps1` deploys the contracts to Ganache, loads the rate card, grants roles and
writes the contract addresses into both portal `.env` files. Full steps, prerequisites and demo data are in the
[README](README.md).

---

## 8. Known limitations and next steps

- **Aadhaar is checked for format and checksum only.** Full confirmation needs UIDAI e-KYC integration, which is the first next step. DigiLocker is not integrated.
- **Doctors do not sign with personal keys.** The hospital wallet signs TX3 on the doctor's behalf, so TX3 attests the portal action, not a personal signature.
- **Settlement is simulated.** TX7 records the claim as settled; it does not transfer any currency.
- **Nothing on-chain proves the treatment happened.** The system verifies documents and rules, not clinical reality.
- **The tabular fraud model learned from synthetic data;** real claim outcomes are needed before its scores can be trusted at scale.
- **The forgery model finds edits, not fabrication,** and OCR and keyword checks degrade on handwriting and poor scans.
- **Local chain only.** Moving to a public testnet such as Polygon Amoy is a deployment change plus key management, and is not part of the current build.
- **Patient mobile app** (React Native) is planned for Phase 2.

See [`docs/gaps_and_limitations.md`](docs/gaps_and_limitations.md) for the full list.