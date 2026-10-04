"""
Renders the claim documents for every demo scenario in config/demo_scenarios.json.

    ai-service\\venv\\Scripts\\python.exe scripts\\generate_demo_documents.py

Writes one folder per claim to notes/demo_documents/ (git-ignored), named after
the claim ID, with the five documents the claim wizard asks for:

    1_hospital_bill.png  2_insurance_card.png  3_patient_id_SPECIMEN.png
    4_consultation_papers.png  5_investigation_report.png

plus DEMO_CLAIMS.txt with every value to type in.

Identity documents are marked SOFTWARE TEST SPECIMENS — plain text, no emblem,
photo, QR code or real card design — used only to exercise the OCR checks.
The Aadhaar numbers pass the Verhoeff checksum and belong to no one.
"""
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "notes", "demo_documents")
sys.path.insert(0, os.path.join(ROOT, "ai-service"))
from document_checks import is_valid_aadhaar  # noqa: E402

with open(os.path.join(ROOT, "config", "demo_scenarios.json"), encoding="utf-8") as f:
    DATA = json.load(f)


def insurer_name():
    env = os.path.join(ROOT, "insurance-portal", "backend", ".env")
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            if line.startswith("INSURER_NAME="):
                return line.split("=", 1)[1].strip()
    return "Star Health Insurance"


INSURER = insurer_name()
HOSPITAL = DATA["hospital"]
DOCTOR = DATA["doctor"]
POLICIES = {p["key"]: p for p in DATA["policies"]}
DIAGNOSES = DATA["diagnoses"]
RELATION = {"self": "Self", "spouse": "Spouse", "son": "Son", "daughter": "Daughter", "father": "Father", "mother": "Mother"}


def member_ids(policy):
    """Member IDs as the insurer assigns them: proposer/employees first, then the rest, in order."""
    selves = [m for m in policy["members"] if m["relationship"] == "self" and not m.get("joinedMidTerm")]
    others = [m for m in policy["members"] if m["relationship"] != "self" and not m.get("joinedMidTerm")]
    late = [m for m in policy["members"] if m.get("joinedMidTerm")]
    return {m["key"]: f'{policy["policyId"]}/{i:02d}' for i, m in enumerate(selves + others + late, 1)}


def member(policy, key):
    return next(m for m in policy["members"] if m["key"] == key)


def age_on(dob, on):
    y, m, d = map(int, dob.split("-"))
    oy, om, od = map(int, on.split("-"))
    return oy - y - ((om, od) < (m, d))


def dmy(iso):
    y, m, d = iso.split("-")
    return f"{d}/{m}/{y}"


def font(size, bold=False):
    candidates = (["C:/Windows/Fonts/arialbd.ttf"] if bold else []) + ["C:/Windows/Fonts/arial.ttf"]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(path, lines, watermark=None):
    width, pad = 1500, 70
    height = pad * 2 + sum(size + 20 for _, size, _ in lines)
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    y = pad
    for text, size, bold in lines:
        draw.text((pad, y), text, fill="black", font=font(size, bold))
        y += size + 20
    if watermark:
        layer = Image.new("RGBA", img.size, (255, 255, 255, 0))
        ImageDraw.Draw(layer).text((width * 0.12, height * 0.40), watermark, fill=(210, 0, 0, 60), font=font(110, True))
        img = Image.alpha_composite(img.convert("RGBA"), layer.rotate(15, center=(width / 2, height / 2))).convert("RGB")
    img.save(path)


def bill(path, claim, person, dx):
    render(path, [
        (HOSPITAL["name"].upper(), 46, True),
        (f'Hospital Code: {HOSPITAL["code"]}    |    Multispeciality Hospital', 26, False),
        ("HOSPITAL BILL / INVOICE", 38, True),
        (f'Bill No: {claim["billNo"]}        Bill Date: {claim["discharge"]}', 28, False),
        (f'Patient Name: {person["name"]}', 30, False),
        (f'Admission Date: {claim["admission"]}', 30, False),
        (f'Discharge Date: {claim["discharge"]}', 30, False),
        (f'Treating Doctor: Dr {DOCTOR["name"]} ({DOCTOR["department"]})', 28, False),
        (f'Diagnosis: {dx["icdDescription"]} ({dx["icdCode"]})', 28, False),
        ("Particulars                                                    Amount", 28, True),
        (f'{dx["procedureName"]} ({dx["procedureCode"]})                         Rs. {claim["billed"]:,.2f}', 28, False),
        (f'Amount Payable: Rs. {claim["billed"]:,.2f}', 34, True),
        ("Payment Mode: Insurance (cashless)", 26, False),
    ])


def insurance_card(path, policy, person, mid):
    t = policy["policyType"]
    if t == "government":
        render(path, [
            ("SPECIMEN - SOFTWARE TEST DOCUMENT - NOT A REAL CARD", 28, True),
            ("AYUSHMAN BHARAT PM-JAY  -  BENEFICIARY E-CARD", 36, True),
            (f'Scheme: {policy["planName"]}    Insurer: {INSURER}', 26, False),
            (f'Beneficiary Name: {person["name"]}', 30, False),
            (f'PM-JAY ID: {person.get("pmjayId", "")}', 32, True),
            (f'Family ID: {policy["scheme"]["familyId"]}', 30, False),
            (f'Policy No: {policy["policyId"]}', 34, True),
            ("Sum Insured: Rs. 5,00,000 per family per year (floater)", 28, False),
            (f'Valid From: {policy["startDate"]}      Valid Till: {policy["endDate"]}', 28, False),
        ], watermark="SPECIMEN")
        return

    lines = [
        (INSURER.upper(), 46, True),
        (f'Health Card (e-Card)  -  {policy["planName"]}', 32, True),
    ]
    if t == "corporate":
        lines += [(f'Employer: {policy["corporate"]["companyName"]}', 30, False),
                  (f'Employee ID: {person.get("employeeId", "")}', 30, False)]
    if t == "group":
        lines += [(f'Group: {policy["group"]["groupName"]}', 30, False),
                  (f'Group Member ID: {person.get("groupMemberId", "")}', 30, False)]
    basis = {"individual": "Individual", "family_floater": "Family Floater", "corporate": "Per employee family (floater)", "group": "Individual"}[t]
    lines += [
        (f'Insured: {person["name"]}  ({RELATION.get(person["relationship"], person["relationship"])})', 30, False),
        (f'Policy No: {policy["policyId"]}', 34, True),
        (f"Member ID: {mid}", 28, False),
        (f'Sum Insured: Rs. {policy["sumInsured"]:,}  ({basis})', 30, False),
        (f'Valid From: {policy["startDate"]}      Valid Till: {policy["endDate"]}', 28, False),
        ("TPA: in-house claims", 26, False),
    ]
    render(path, lines)


def kyc(path, person):
    lines = [
        ("SPECIMEN - SOFTWARE TEST DOCUMENT - NOT A REAL IDENTITY CARD", 30, True),
        ("Government of India", 36, True),
        ("Aadhaar (test specimen)", 32, True),
        (f'Name: {person["name"]}', 30, False),
        (f'Date of Birth: {dmy(person["dateOfBirth"])}', 30, False),
        (f'Gender: {person["gender"].capitalize()}', 30, False),
        (f'Aadhaar Number: {person["aadhaarNumber"][:4]} {person["aadhaarNumber"][4:8]} {person["aadhaarNumber"][8:]}', 38, True),
    ]
    if person.get("panNumber"):
        lines += [("Income Tax Department - Permanent Account Number", 28, True), (f'PAN: {person["panNumber"]}', 34, True)]
    render(path, lines, watermark="SPECIMEN")


def consultation(path, claim, person, dx):
    sex = "M" if person["gender"] == "male" else "F"
    render(path, [
        (f'{HOSPITAL["name"].upper()} - OPD CONSULTATION', 36, True),
        (f'Dr {DOCTOR["name"]}, MS ({DOCTOR["department"]})    Reg No: {DOCTOR["registrationNumber"]}', 26, False),
        (f'Patient: {person["name"]}    Age/Sex: {age_on(person["dateOfBirth"], claim["admission"])}/{sex}    Date: {claim["admission"]}', 26, False),
        (f'Chief Complaint: {dx["complaint"]}', 26, False),
        (f'Examination: {dx["examination"]}', 26, False),
        (f'Diagnosis: {dx["diagnosis"]} ({dx["icdCode"]})', 32, True),
        ("Rx", 36, True),
        *[(f"{i}. {rx}", 28, False) for i, rx in enumerate(dx["rx"], 1)],
        (f'Advice: {dx["advice"]}', 28, False),
        ("Follow up one week after discharge", 28, False),
    ])


def investigations(path, claim, person, dx):
    render(path, [
        (f'{HOSPITAL["name"].upper()} - LABORATORY AND RADIOLOGY REPORT', 34, True),
        (f'Patient: {person["name"]}    Collected On: {claim["admission"]}    Reported On: {claim["admission"]}', 24, False),
        ("Specimen: blood; ultrasound", 28, False),
        ("Test Name                       Result            Units          Reference Range", 26, True),
        *[(f"{name:<32}{result:<18}{unit:<15}{ref}", 26, False) for name, result, unit, ref in dx["labs"]],
        (dx["imaging"], 26, False),
        (f'Impression: {dx["impression"]}', 28, False),
        ("Pathologist: Dr S Rao, MD (Pathology)", 26, False),
    ])


def main():
    if os.path.isdir(OUT):
        for entry in os.listdir(OUT):
            full = os.path.join(OUT, entry)
            if os.path.isdir(full):
                shutil.rmtree(full)
            elif entry.endswith(".png") or entry in ("DEMO_CLAIM.txt", "DEMO_CLAIMS.txt"):
                os.remove(full)
    os.makedirs(OUT, exist_ok=True)

    for p in DATA["policies"]:
        for m in p["members"]:
            assert is_valid_aadhaar(m["aadhaarNumber"]), m["aadhaarNumber"]

    sheet = [
        "HealthCVS demo claims — values to enter",
        "=======================================",
        f'Hospital {HOSPITAL["name"]} ({HOSPITAL["code"]}) · Insurer {INSURER}',
        f'Doctor for every claim: {DOCTOR["name"]} (NMC {DOCTOR["registrationNumber"]}, {DOCTOR["department"]})',
        "Policies and members are enrolled by: cd insurance-portal/backend; npm run seed:demo -- --email you@gmail.com",
        "",
    ]

    for c in DATA["claims"]:
        policy = POLICIES[c["policy"]]
        person = member(policy, c["member"])
        dx = DIAGNOSES[c["diagnosis"]]
        folder = os.path.join(OUT, c["id"])
        os.makedirs(folder, exist_ok=True)

        if c.get("reuse"):
            src = os.path.join(OUT, c["reuse"])
            for name in ("1_hospital_bill.png", "2_insurance_card.png", "4_consultation_papers.png", "5_investigation_report.png"):
                shutil.copy(os.path.join(src, name), os.path.join(folder, name))
        else:
            ids = member_ids(policy)
            bill(os.path.join(folder, "1_hospital_bill.png"), c, person, dx)
            insurance_card(os.path.join(folder, "2_insurance_card.png"), policy, person, ids[person["key"]])
            consultation(os.path.join(folder, "4_consultation_papers.png"), c, person, dx)
            investigations(os.path.join(folder, "5_investigation_report.png"), c, person, dx)
        kyc_person = person
        if c.get("kycOf"):
            kyc_person = next(m for pol in DATA["policies"] for m in pol["members"] if m["key"] == c["kycOf"])
        kyc(os.path.join(folder, "3_patient_id_SPECIMEN.png"), kyc_person)

        if c.get("secondPolicy"):
            second = POLICIES[c["secondPolicy"]]
            ids2 = member_ids(second)
            insurance_card(os.path.join(folder, "2b_insurance_card_second_policy.png"), second, member(second, c["member"]), ids2[c["member"]])

        entered = c.get("enterAs") or {"name": person["name"], "dateOfBirth": person["dateOfBirth"], "gender": person["gender"]}
        sheet += [
            f'{c["id"]} — {c["title"]}',
            f'  Patient   {entered["name"]} | Aadhaar {person["aadhaarNumber"]} | DOB {entered["dateOfBirth"]} | {entered["gender"]}'
            + (f' | PAN {person["panNumber"]}' if person.get("panNumber") and not c.get("enterAs") else ""),
            f'  Policy    {policy["policyId"]} ({policy["planName"]})' + (f' | ID on card: {c["memberRef"]}' if c.get("memberRef") else ""),
            f'  Admission {c["admission"]} -> {c["discharge"]} | cause: illness',
            f'  Medical   {dx["diagnosis"]} | ICD {dx["icdCode"]} | {dx["procedureCode"]} {dx["procedureName"]} | amount {c["amount"]}',
            f'  Documents {c["id"]}/1..5' + (" (bill and papers copied from " + c["reuse"] + ")" if c.get("reuse") else ""),
        ]
        if c.get("secondPolicy"):
            sheet.append(f'  Then file again under {POLICIES[c["secondPolicy"]]["policyId"]} with the same documents and 2b_insurance_card_second_policy.png as the card')
        if c.get("after"):
            sheet.append(f'  Run after {c["after"]} has been approved (TX6).')
        sheet += [f'  Expect    {c["expect"]}', ""]

    sheet += ["Blocked before they reach the insurer", "-------------------------------------"]
    for b in DATA["blocked"]:
        policy = POLICIES[b["policy"]]
        person = member(policy, b["member"])
        sheet += [
            f'{b["id"]} — {b["title"]}',
            f'  Patient {person["name"]} | Aadhaar {person["aadhaarNumber"]} | policy {policy["policyId"]} | admission {b["admission"]}',
            f'  Expect  {b["expect"]}',
            "",
        ]

    with open(os.path.join(OUT, "DEMO_CLAIMS.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sheet) + "\n")
    print(f"Wrote {len(DATA['claims'])} claim folders and DEMO_CLAIMS.txt to {OUT}")


if __name__ == "__main__":
    main()
