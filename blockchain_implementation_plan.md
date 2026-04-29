# HealthCVS: Blockchain Implementation Plan

This plan outlines the architecture and development phases for the HealthCVS blockchain layer, ensuring it meets the unique requirements of your project (zero off-chain DB, granular audit trails, India-specific context, and cost efficiency).

## 1. Core Technology Stack
*   **Blockchain Network:** Polygon Amoy Testnet. *(Note: Polygon Mumbai was deprecated in April 2024. Amoy is the official replacement, offering the same free, fast, and low-gas environment).*
*   **Smart Contract Development:** Hardhat (Solidity).
*   **Web3 Library:** web3.js.
*   **Frontend Web:** React (Vite) + Material UI.
*   **Frontend Mobile (Patient):** React Native.
*   **Storage:** IPFS via Pinata.
*   **Identity:** MetaMask (for hospital/insurer staff signing) and DigiLocker API (for patient Aadhaar verification).

## 2. Smart Contract Architecture (Modular)
Since we have no off-chain database, the smart contracts are the sole source of truth and state. A modular architecture is best practice for upgradeability and managing complex logic.

*   `RoleManager.sol`: Handles Role-Based Access Control (RBAC). Defines who is an Admin, Insurer, Hospital Clerk, or Doctor.
*   `PatientRegistry.sol`: Maps a hashed Aadhaar number (verified via DigiLocker) to a wallet address and an active insurance policy ID.
*   `ClaimSubmission.sol`: The core data structure. Stores claim details, procedure codes, and the IPFS CIDs for attached documents.
*   `AutoAdjudication.sol`: The logic engine. Contains the rules comparing the claimed amount against the PM-JAY Health Benefit Package (HBP) catalog.

## 3. The 7-Step Transaction Audit Trail
This is your major differentiator. Instead of a simple "submit -> approve" flow, every stage of the real-world workflow is recorded immutably on-chain.

1.  **Patient Policy Registration (TX 1):** Insurer registers a patient, linking their hashed Aadhaar to a policy.
2.  **Claim Initialization (TX 2):** Hospital Clerk creates the claim. They upload documents to IPFS and store the resulting CIDs on-chain alongside the claimed amount and PM-JAY procedure code.
3.  **Doctor Authentication (TX 3):** The assigned Doctor logs in via MetaMask, reviews the claim, and submits a transaction to cryptographically sign off on the medical necessity.
4.  **AI Fraud Score Oracle Update (TX 4):** A dedicated transaction where an off-chain AI model (via an Oracle script) writes a fraud probability score to the claim record. *(We will implement this as a placeholder TX for now).*
5.  **Rule-Based Adjudication (TX 5):** The `AutoAdjudication` contract executes its logic, checking policy limits and the PM-JAY rate catalog.
6.  **Insurer Final Review (TX 6):** Insurer submits a transaction to confirm the automated decision or manually override a flagged claim.
7.  **Claim Settlement (TX 7):** A transaction simulating the payment (transferring mock tokens) to the hospital, officially closing the claim.

## 4. Data Storage Strategy (Strictly On-Chain + IPFS)
With no MongoDB or Postgres database, we split data for gas efficiency:

**IPFS (via Pinata):**
*   Images/PDFs of Bills, Prescriptions, and Discharge Summaries.
*   Lengthy JSON metadata (e.g., line-by-line itemized bill details) to avoid high gas costs.

**On-Chain (Polygon Amoy):**
*   IPFS CIDs (categorized explicitly: `cid_bill`, `cid_prescription`).
*   Patient ID (Aadhaar Hash).
*   Total Claimed Amount (uint256).
*   PM-JAY Procedure Code (string).
*   Current Status (Enum: Submitted, Authenticated, Adjudicated, Paid).
*   Wallet addresses (msg.sender) of the clerk and doctor for accountability.

## 5. PM-JAY Rate Benchmarking
The smart contract will contain a mapping of PM-JAY procedure codes to their ceiling rates.

*Sample Catalog (To be injected into the contract):*
*   `S030008` (Coronary Angiography) -> Limit: ₹10,000
*   `S060001` (Total Knee Replacement) -> Limit: ₹80,000

*On-Chain Fraud Detection Logic (Without AI):*
```solidity
if (claim.amount > pmjayRates[claim.procedureCode]) {
    claim.status = Status.Flagged;
    claim.flagReason = "Exceeds PM-JAY HBP Ceiling";
}
```

## 6. Frontend & Integration Flow
1.  **Patient App (React Native):** Uses the DigiLocker OAuth 2.0 API. The user logs in to DigiLocker, grants consent, and the app fetches their Aadhaar XML. The Aadhaar number is hashed locally and sent to the blockchain to act as their identity.
2.  **Hospital Portal (React/Vite):** Staff use MetaMask. The web app uses `web3.js` to read from the blockchain (populating the dashboard via contract events and view functions) and write to it (submitting claims, doctor authentication).

## 7. Next Steps for Implementation
If you approve this plan, we can begin coding immediately. I recommend tackling this in phases:

*   **Phase 1:** Setup the Hardhat project and write the Solidity Smart Contracts (`PatientRegistry`, `ClaimSubmission`, `AutoAdjudication`, `RoleManager`).
*   **Phase 2:** Write deployment scripts and deploy to Polygon Amoy Testnet.
*   **Phase 3:** Set up the Vite/React frontend and implement web3.js + MetaMask connection.
*   **Phase 4:** Build the IPFS (Pinata) upload logic and the UI for the 7-step transaction flow.
