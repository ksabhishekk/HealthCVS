# HealthCVS — Acknowledged Gaps & Limitations

**Purpose of this document:** every project has gaps. The difference between a strong final-year evaluation and a shaky one is usually not whether gaps exist — it's whether *you* name them before the evaluator finds them. This document is written so sections of it can be lifted directly into the project report (e.g. under "Limitations" or "Future Work") and so you have honest, rehearsed language ready if asked about any of these live.

Each item follows the same structure: **what it is → why it's this way → what real-world deployment would need instead.**

---

## 1. AI / Machine Learning data limitations

### 1.1 Tabular fraud model trained on synthetic labels
The XGBoost fraud-scoring model is trained on 2,000 synthetically generated claims, where the "fraud" label is produced by a hand-written logistic formula over the same features the model later scores. No real, labeled Indian health-insurance fraud dataset exists publicly, and building one would require an actual insurer's historical claims — not obtainable for a student project.

**What this demonstrates:** the correct *architecture* — feature engineering, an explainable model (SHAP), a hybrid supervised/unsupervised ensemble (see 1.4). **What it doesn't demonstrate:** real-world predictive accuracy, since the model has learned to recover the formula it was trained on, not real fraud patterns.

**Production path:** train (or fine-tune) on real historical claims data from a participating insurer, with real fraud/rejection outcomes as labels.

### 1.2 Forgery-detection model trained on a small dataset
The EfficientNet-B3 forgery detector was trained on roughly 300–380 images (150+ genuine / 150+ tampered for training, 40+/40+ for validation), sourced from Kaggle plus manually edited bills. The training methodology itself is sound (two-phase fine-tuning, class weighting, augmentation, Grad-CAM) — the limitation is purely data volume.

**What this means in practice:** the model will likely perform well on images similar to its training set, and much less reliably on real hospital bill formats, phone-camera photos, or scanner artifacts it has never seen.

**A more fundamental limitation, independent of dataset size:** the model is trained to detect *edited* documents (a real bill, then digitally altered). It has no power against a document *fabricated from scratch* to look genuine — a freshly typed fake bill was never "edited," so it carries none of the compression/pixel artifacts the model looks for. This is why the system's design deliberately does not lean on forgery detection as the primary defense against fraudulent documents (see Section 3).

**Production path:** a much larger, more diverse training set; ideally sourced from a real hospital's document management system with confirmed tampering incidents.

### 1.3 NLP semantic-match threshold is the least-validated number in the system
The prescription-consistency check (does the OCR'd prescription text match the ICD-10 diagnosis?) uses a biomedical sentence-transformer model, with a similarity threshold of 0.86 calibrated against 8 hand-built example pairs — because no real labeled dataset of (diagnosis, prescription text, is-actually-consistent) triples exists. The margin between confirmed matches (0.883–0.904) and confirmed mismatches (0.828–0.848) on this small test set is narrow (~0.035), a known property of biomedical BERT-style embeddings compressing similarity into a tight high range for in-domain medical text — not a bug, but a sign the threshold deserves revalidation once real data exists.

**Mitigating factor:** this is only a 20%-weight soft signal in the overall ensemble, not a hard auto-reject — so a miscalibrated threshold degrades scoring quality, it doesn't single-handedly reject or approve a claim.

**Production path:** re-run the calibration script (`ai-service/calibrate_semantic_threshold.py`) against real OCR'd prescriptions and real ICD codes once claim volume accumulates.

### 1.4 Why a hybrid model, not a bigger supervised one
Given 1.1–1.3, the tabular fraud score combines a supervised model (XGBoost, 70% weight) with an unsupervised anomaly detector (IsolationForest, 30% weight) that needs no labels at all — it learns what a "normal" claim's numbers look like and flags statistical outliers. This is standard practice in real fraud systems, where confirmed fraud labels are always scarce. It's a deliberate design response to 1.1, not a workaround.

---

## 2. Blockchain / architecture limitations

### 2.1 PM-JAY catalog covers 10 procedures, not ~1,900
`AutoAdjudication.sol` ships with 10 hardcoded PM-JAY Health Benefit Package procedure codes and ceiling rates. The real PM-JAY HBP catalog has roughly 1,900 packages. The contract's own code comment already calls this a "sample catalog" — this was never presented as complete.

**Production path:** load the full HBP catalog via `addProcedureRate()` (already exposed, admin-only) or migrate the catalog to an off-chain reference with an on-chain hash commitment for gas efficiency at scale.

### 2.2 Known bug: ceiling check compares total claim amount to a single procedure's ceiling
`adjudicateClaim()` compares the claim's **total** claimed amount (summed across every procedure on the claim) against the ceiling of only the **primary** (highest-value) procedure. This can false-flag legitimate multi-procedure claims, and could under-flag amount-padding on secondary procedures. Identified but not yet fixed — the fix requires a contract change and redeployment, currently blocked on the team finishing a local Hardhat chain (to avoid spending scarce Amoy testnet gas on iteration).

### 2.3 One wallet per portal holds multiple on-chain roles
Per `scripts/grantRoles.js`, the hospital backend's signing wallet holds both `HOSPITAL_CLERK_ROLE` and `DOCTOR_ROLE`; the insurance backend's wallet holds `INSURER_ROLE`. This is a practical demo simplification — in production, each individual clerk and doctor would sign with their own wallet (e.g., via MetaMask in the browser), making TX2 and TX3 genuinely distinct, non-repudiable signers rather than the same backend-held key. As currently built, the audit trail proves "the hospital's system attests to this," not "this specific individual doctor personally signed this."

### 2.4 Settlement is fully simulated
TX7 (`settleClaim()`) flips the claim's status to `Settled` — it does not transfer any real or test currency to the hospital. This matches the original project plan's stated intent ("simulating the payment"), but it's worth being precise with evaluators: this will never move real value in its current form, it's not "not wired up yet."

---

## 3. Identity & consent limitations

### 3.1 No patient-facing application, no DigiLocker integration
The original project plan specified a React Native patient app with DigiLocker OAuth for real government-backed Aadhaar verification. Neither was built. In the current system, a hospital clerk manually types in a 12-digit number, which is hashed before being stored — `PatientRegistry.sol`'s own code comment explicitly labels this a "DigiLocker simulation," so this was never presented as real identity verification.

**Consequence:** there is no cryptographic proof that the patient described in a claim is a real, consenting individual — only that *some* 12-digit number was entered and hashed.

### 3.2 Hospital–patient collusion — partially mitigated, not eliminated
This was the system's largest blind spot until 2026-08-25: nothing in the pipeline ever asked the patient anything before a claim was filed in their name. The fix implemented is an OTP sent to the patient's own on-file mobile number, which must be verified before a claim can be submitted — adding the patient as a fourth attesting party alongside the clerk, doctor, and insurer, at effectively zero infrastructure cost (no gas, no redeploy, no app).

**What this does and doesn't solve:** it proves *someone with access to that phone number* confirmed the claim at submission time. It does not provide biometric or government-ID-backed proof that the person who received the OTP is the actual patient, and it does not prevent a scenario where the patient themself is complicit in the fraud (the exact "collusion" case). A full solution would need the originally-planned patient app with DigiLocker-verified identity. The OTP step is a genuine, low-cost improvement over "zero coverage," not a complete solution.

### 3.3 Signature/forgery authenticity is deliberately not the primary defense
This is a design decision, not an oversight, and worth stating as such: image-based signature or seal verification was considered and deliberately not pursued as a load-bearing fraud check. A model trained to detect *edited* signatures has no power against a signature *fabricated fresh* (see 1.2), and ink-on-paper authenticity is inherently spoofable in a way a cryptographic signature is not. The system instead leans on cryptographic attestation wherever an actor can be identified: MetaMask wallet signing for doctor authentication (TX3), IPFS content-addressing for post-upload tamper evidence, live NMC registry lookups for doctor identity, and OTP for patient consent. The CV/Grad-CAM forgery model is retained as a secondary, genuinely useful signal for catching *lazy* tampering (a digit changed, a seal pasted in) — but should not be described to evaluators as "we detect forged signatures," since that overstates what it actually does.

---

## 4. Summary table (for a slide)

| Area | Gap | Severity | Status |
|---|---|---|---|
| Tabular model | Synthetic training labels | Medium — architecture is sound, accuracy claims aren't | Disclosed by design |
| Forgery model | Small dataset (~350 images) | Medium | Disclosed by design |
| NLP threshold | Calibrated on 8 hand-built pairs | Low (soft signal only) | Disclosed by design |
| PM-JAY catalog | 10 of ~1,900 procedures | Low (labeled "sample" in code) | Disclosed by design |
| Ceiling math | Total vs. primary-procedure bug | Medium — real logic bug | **Open, fix pending local chain** |
| Wallet roles | One wallet, multiple roles per portal | Low (demo simplification) | Disclosed by design |
| Settlement | Fully simulated, no real transfer | Low (matches original plan) | Disclosed by design |
| Patient identity | No DigiLocker/patient app | Medium — structural gap | Partially mitigated (OTP) |
| Collusion | No biometric/ID-backed consent | Medium — structural gap | Partially mitigated (OTP) |
| Signatures | Not used as primary fraud defense | N/A — deliberate design choice | Disclosed by design |
