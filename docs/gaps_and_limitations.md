# HealthCVS: Gaps and Limitations

HealthCVS is a working prototype. This document says plainly what it does not do, why it is built that way, and what
a real deployment would need instead. Each item follows the same shape: **what it is → why it's this way → production path.**

---

## 1. AI and machine-learning limitations

### 1.1 The tabular fraud model is trained on synthetic labels
The XGBoost fraud-scoring model is trained on 2,000 synthetically generated claims, where the "fraud" label comes from
a hand-written logistic formula over the same features the model later scores. No real, labelled Indian
health-insurance fraud dataset is public, and building one needs an insurer's historical claims.

**What this shows:** the right *architecture*: feature engineering, an explainable model (SHAP) and a hybrid
supervised/unsupervised ensemble (see 1.5). **What it doesn't show:** real-world predictive accuracy, because the model
has learned to recover its own formula, not real fraud patterns. The explanations the portal shows carry a
synthetic-label caveat for the same reason.

**Production path:** train or fine-tune on real historical claims from a participating insurer, with real fraud and
rejection outcomes as labels.

### 1.2 The forgery model is small, and a vision LLM backs it up
The EfficientNet-B3 forgery detector was trained on roughly 300–380 images (150+ genuine and 150+ tampered for
training, 40+ of each for validation), sourced from Kaggle plus manually edited bills. The method is sound (two-phase
fine-tuning, class weighting, augmentation, Grad-CAM); the limit is data volume. It will likely do well on images
similar to its training set and much less reliably on real hospital bill formats, phone-camera photos or scanner
artifacts it has never seen.

Because of this, an independent tamper estimate from Google Gemini Flash is also requested. When the API key is
configured, **that estimate replaces the trained model's score**; if the call fails for any reason, the system falls
back to the trained model and never crashes the scoring pipeline. The trade-offs: the bill image is sent to an
external service, and the estimate comes from a general-purpose model with no calibration against hospital documents.

**A more fundamental limit, independent of dataset size:** the model detects *edited* documents (a real bill, then
digitally altered). It has no power against a document *fabricated from scratch*, which carries none of the
compression or pixel artifacts it looks for. This is why forgery detection is not the primary defence against
fraudulent documents (see 3.3).

**Production path:** a much larger and more diverse training set, ideally from a hospital's document system with
confirmed tampering incidents, plus validation of the vision-LLM estimate against it.

### 1.3 The NLP similarity threshold is the least-validated number in the system
The prescription-consistency check compares the OCR'd prescription text with the ICD-10 diagnosis description using a
biomedical sentence-transformer (S-PubMedBERT). The match threshold of 0.86 was calibrated on 8 hand-built example
pairs, because no labelled dataset of (diagnosis, prescription, is-consistent) exists. On that set, confirmed matches
score 0.883–0.904 and confirmed mismatches 0.828–0.848, a margin of about 0.035. That is typical of biomedical BERT
embeddings, which compress similarity into a narrow high range for in-domain text. It is not a bug, but the threshold
deserves revalidation once real data exists.

**Mitigating factor:** it is a 20%-weight soft signal in the ensemble, never a hard rejection, so a miscalibrated
threshold degrades scoring quality rather than deciding a claim on its own.

**Production path:** re-run `ai-service/calibrate_semantic_threshold.py` on real OCR'd prescriptions and real ICD codes.

### 1.4 OCR and keyword checks degrade on poor input
Text extraction uses Tesseract OCR and the checks built on it (bill reconciliation, medical-term detection, supporting
documents) rely on printed, legible text. Handwriting, low-resolution photos and skewed scans reduce accuracy. The
design limits the damage: a field that cannot be read is reported as "not checked", never as a discrepancy, and an
unreadable document sets a minimum score but is not treated as evidence of fraud.

**Production path:** a handwriting-capable OCR model and a document-quality gate at upload.

### 1.5 Why a hybrid model, not a bigger supervised one
Given 1.1–1.3, the tabular score combines a supervised model (XGBoost, 70%) with an unsupervised anomaly detector
(IsolationForest, 30%) that needs no labels: it learns what a "normal" claim looks like and flags statistical
outliers. This is standard practice in real fraud systems, where confirmed fraud labels are scarce. It is a deliberate
response to 1.1, not a workaround.

---

## 2. Blockchain and architecture limitations

### 2.1 The package-rate card covers 15 procedures, not about 1,900
`config/procedure_rates.json` holds 15 procedures modelled on the PM-JAY Health Benefit Package list;
`scripts/deploy.js` loads it into `AutoAdjudication.sol` with `setProcedureRates()`. The real catalog has roughly
1,900 packages. The card is a sample. Every billed procedure is checked against its own ceiling, but only for
procedures in the card.

**Production path:** load the full catalog through the same admin function, or keep it off-chain with an on-chain hash
commitment for gas efficiency at scale.

### 2.2 One wallet per portal holds multiple on-chain roles
Per `scripts/deploy.js`, the hospital backend's wallet holds both `HOSPITAL_CLERK_ROLE` and `DOCTOR_ROLE`; the
insurer backend's wallet holds `INSURER_ROLE` and the oracle key. This is a demo simplification. In production each
clerk and doctor would sign with their own wallet, making TX2 and TX3 distinct, non-repudiable signers. As built, the
audit trail proves "the hospital's system attests to this", not "this specific doctor personally signed this".

### 2.3 A single oracle writes the fraud score
TX4 is written by one oracle wallet, held by the insurer's backend. The score is advisory: a person at the insurer
decides at TX6, and the contract applies its own rules at TX5. Still, the chain records that the oracle wrote a score,
not that the score was computed correctly. The explanation pinned to IPFS makes the reasoning inspectable after the
fact.

**Production path:** multiple independent oracles, or verifiable computation for the scoring step.

### 2.4 Settlement is fully simulated
TX7 (`settleClaim()`) sets the claim's status to `Settled` and records the approved amount. It does not transfer any
real or test currency to the hospital. This is intentional for the prototype, and it will not move value in its
current form.

### 2.5 The chain is local
The contracts run on a local Ganache network. That makes demos free and repeatable, but nothing is deployed to a
public network, and the role wallets are keys held by the backends. A public or consortium deployment needs real key
management (hardware or managed signing) and an operator model for who runs the nodes.

### 2.6 External services are required
Several checks depend on third parties: the live NMC doctor register (queried through an Apify actor, taking 1–5
minutes for a new doctor; results are cached for 30 days), Pinata for IPFS pinning, the NIH ICD-10 API for diagnosis
descriptions, and Gemini for the tamper estimate. The system degrades rather than fails when the vision-LLM or an
IPFS pin is unavailable, but a doctor who cannot be verified raises the fraud score to its 75 floor.

**Production path:** a licensed or direct feed of the NMC register, and pinning to infrastructure the network controls.

---

## 3. Identity and consent limitations

### 3.1 No patient-facing app and no government-backed identity check
A patient app with DigiLocker verification (Phase 2) is not built. Members are enrolled by their insurer when the
policy is issued, and a hospital clerk types the patient's 12-digit Aadhaar number, which is checksum-validated
(Verhoeff) and hashed; only the hash goes on-chain. The insurer then compares the name, date of birth and sex entered
by the hospital with its own enrolment record.

**Consequence:** a claim can only be filed for someone the insurer enrolled, but nothing proves that the person at the
hospital is that member, only that the number and details match.

**Production path:** UIDAI e-KYC or DigiLocker verification, and the patient app.

### 3.2 Hospital–patient collusion is partially mitigated, not eliminated
Before a claim can be submitted, the patient must confirm it with a one-time password. The OTP goes to the contact
the *insurer* holds for that member (hospital staff never see it; a number typed at the hospital is used only when the
insurer holds none). This adds the patient as a fourth attesting party alongside the clerk, doctor and insurer, at
effectively zero infrastructure cost. The oracle also looks for patterns that suggest collusion, such as a consent
contact reused across other policies, a duplicate episode for the same patient and procedure within three days, and a
doctor's record in past human reviews.

**What this does and doesn't solve:** it shows that *someone with access to that phone number* confirmed the claim. It
does not prove the person who received the OTP is the actual patient, and it does not stop a scenario where the
patient is complicit in the fraud. A full solution needs verified identity (see 3.1). The OTP step and cross-claim
signals are a genuine, low-cost improvement, not a complete solution.

### 3.3 Signature and seal authenticity is deliberately not the primary defence
This is a design decision. An image model trained to detect *edited* signatures has no power against a signature
*fabricated fresh* (see 1.2), and ink-on-paper authenticity is spoofable in a way a cryptographic signature is not.
The system relies on cryptographic attestation wherever an actor can be identified: role-gated on-chain signing for
doctor authentication (TX3), IPFS content-addressing for tamper evidence after upload, live NMC lookups for doctor
identity, and OTP for patient consent. The forgery model remains a secondary signal for *lazy* tampering (a changed
digit, a pasted-in seal). It should not be described as detecting forged signatures.

### 3.4 Nothing proves the treatment happened
HealthCVS verifies documents, identities and rules. It cannot confirm that care was actually delivered. A fabricated
but internally consistent claim from a genuine hospital with a verified doctor would pass the document checks.

**Production path:** cross-checks against hospital admission systems, pre-authorisation records and field audits.

---

## 4. Policy-model limitations

### 4.1 Holder identifiers are checked offline
GSTIN check characters, PAN structure and holder type (an individual's PAN has `P` as its 4th character), and the
formats of PM-JAY IDs, ABHA numbers and ration-card numbers are validated in software. Nothing is checked against GSTN,
the Income Tax Department, NHA's beneficiary database or ABDM, because none offer a student project API access.

### 4.2 Only the 30-day initial waiting period is modelled
Real retail policies also carry pre-existing-disease and specific-disease waiting periods, room-rent and disease-wise
sub-limits, no-claim bonuses and restore benefits. HealthCVS models the features that decide whether and how much a
claim pays in the demo scenarios: membership, cover period, suspension, shared or individual sum insured,
co-payment and the initial waiting period. Premiums and underwriting are out of scope; issuing a policy records cover
only.

### 4.3 PM-JAY is modelled in insurance mode
States run PM-JAY through an insurer, a state health agency trust, or a mix. HealthCVS models the insurance mode: the
insurer enrols the eligible family and pays at package rates. Real beneficiary identification happens in NHA's own
systems.

### 4.4 Corporate exits are manual
When an employee leaves, the insurer suspends them and their dependants lose cover on-chain immediately. In practice
this would come from the employer's HR system; here an insurer user makes the change.

### 4.5 One insurer runs in the demo
Claims are routed by policy number to the insurer that issued the policy, and each policy is bound on-chain to that
insurer's wallet. A second insurer needs its own portal deployment, a wallet with `INSURER_ROLE`, and an entry in the
hospital's `INSURER_NETWORK`. The demo runs one.

---

## 5. Summary

| Area            | Gap                                                              | Severity                     | Status                |
| --------------- | ---------------------------------------------------------------- | ---------------------------- | --------------------- |
| Tabular model   | Synthetic training labels                                        | Medium: accuracy unproven    | Known limitation      |
| Forgery model   | Small dataset (~350 images); detects edits, not fabrication      | Medium                       | Known limitation; vision-LLM estimate added |
| NLP threshold   | Calibrated on 8 hand-built pairs                                 | Low (soft signal only)       | Known limitation      |
| OCR             | Degrades on handwriting and poor scans                           | Low–Medium                   | Known limitation      |
| Rate card       | 15 of ~1,900 procedures                                          | Low (a sample)               | Known limitation      |
| Wallet roles    | One wallet, multiple roles per portal                            | Low (demo simplification)    | Known limitation      |
| Oracle          | Single oracle wallet writes TX4                                  | Low–Medium                   | Mitigated by human review at TX6 |
| Settlement      | Fully simulated, no transfer                                     | Low                          | Intentional           |
| Network         | Local chain only; backend-held keys                              | Medium for deployment        | Known limitation      |
| External services | NMC, Pinata, ICD-10 API and Gemini are third-party dependencies | Low–Medium                   | Degrades gracefully   |
| Patient identity | No DigiLocker/e-KYC or patient app                              | Medium: structural           | Partially mitigated (OTP) |
| Collusion       | No ID-backed consent                                             | Medium: structural           | Partially mitigated (OTP, cross-claim signals) |
| Signatures      | Not the primary fraud defence                                    | n/a: design choice           | Intentional           |
| Treatment       | Nothing proves care was delivered                                | Medium: structural           | Known limitation      |
| Holder IDs      | GSTIN, PAN, PM-JAY, ABHA checked offline                         | Low                          | Known limitation      |
| Policy features | Initial waiting period only; no PED waiting, sub-limits, premiums | Low–Medium                   | Known limitation      |
| Network of insurers | One insurer in the demo; more by configuration               | Low                          | Known limitation      |