import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectSchema, concessionSchema } from "#modules/fees/fees.schema.js";
import { patchSchema } from "#modules/settings/settings.schema.js";
import { importRow } from "#modules/students/students.schema.js";

const row = { name: "Rafi Hasan", gender: "boy", dob: "9/3/2018", class: "Class I", guardianPhone: "+8801712345678" };

describe("student CSV row", () => {
    it("accepts Bangladeshi day-first dates, gender words and phone formats", () => {
        const r = importRow.parse(row);
        assert.deepEqual([r.dob, r.gender, r.guardianPhone, r.section], ["2018-03-09", "MALE", "01712345678", ""]);
    });
    it("rejects impossible dates and bad phones", () => {
        assert.equal(importRow.safeParse({ ...row, dob: "31/02/2018" }).success, false);
        assert.equal(importRow.safeParse({ ...row, guardianPhone: "12345" }).success, false);
    });
    it("normalises blood group spelling", () => {
        assert.equal(importRow.parse({ ...row, bloodGroup: "o +ve" }).bloodGroup, "O+");
    });
});

describe("money input", () => {
    it("whole taka only", () => {
        const base = { studentId: "01a1b6b1-a279-769d-b737-5da6e6b728a2", method: "CASH", invoiceIds: ["01a1b6b1-a279-769d-b737-5da6e6b728a3"] };
        assert.equal(collectSchema.safeParse({ ...base, amount: 100.5 }).success, false);
        assert.equal(collectSchema.safeParse({ ...base, amount: 0 }).success, false);
        assert.equal(collectSchema.safeParse({ ...base, amount: 100 }).success, true);
    });
    it("a waiver is either a percent or an amount", () => {
        const base = { feeHeadId: "01a1b6b1-a279-769d-b737-5da6e6b728a2", reason: "Sibling" };
        assert.equal(concessionSchema.safeParse({ ...base, percent: 50, amount: 100 }).success, false);
        assert.equal(concessionSchema.safeParse({ ...base }).success, false);
        assert.equal(concessionSchema.safeParse({ ...base, percent: 50 }).success, true);
    });
});

describe("settings", () => {
    it("rejects unknown keys and turning off Students", () => {
        assert.equal(patchSchema.safeParse({ "hack.me": 1 }).success, false);
        assert.equal(patchSchema.safeParse({ "modules.enabled": ["fees"] }).success, false);
        assert.equal(patchSchema.safeParse({ "attendance.smsCutoff": "25:00" }).success, false);
        assert.equal(patchSchema.safeParse({ "cards.admitDueLimit": null, "results.tieBreak": "name" }).success, true);
    });
});
