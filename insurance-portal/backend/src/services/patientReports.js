// What a patient can report about a claim from the patient app. Shared by the
// patient API (which records reports) and the oracle (which treats an open
// report as a confirmed finding).
const REPORT_REASONS = {
  not_treated: 'I did not receive this treatment',
  wrong_amount: 'The amount or treatment is wrong',
  no_consent: 'I did not approve this claim',
  other: 'Something else is wrong',
}

module.exports = { REPORT_REASONS }
