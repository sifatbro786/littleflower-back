import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, dhakaDateString, weekdayOf } from "#core/dates.js";
import { normalizeBdPhone } from "#core/phone.js";
import { fillTemplate, smsSegments } from "#core/sms.js";

describe("Asia/Dhaka dates", () => {
    it("a UTC evening is already the next day in Dhaka (attendance date)", () => {
        assert.equal(dhakaDateString(new Date("2026-11-07T18:30:00Z")), "2026-11-08");
        assert.equal(dhakaDateString(new Date("2026-11-07T17:59:00Z")), "2026-11-07");
    });
    it("addDays crosses months and years", () => {
        assert.equal(addDays("2026-12-31", 1), "2027-01-01");
        assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    });
    it("weekday codes match the weekly-off setting", () => {
        assert.equal(weekdayOf("2026-11-06"), "FRI");
        assert.equal(weekdayOf("2026-11-07"), "SAT");
    });
});

describe("phones and SMS", () => {
    it("normalises Bangladeshi mobiles", () => {
        assert.equal(normalizeBdPhone("+880 1712-345678"), "01712345678");
        assert.equal(normalizeBdPhone("8801812345678"), "01812345678");
        assert.equal(normalizeBdPhone("01212345678"), null);
    });
    it("counts segments (GSM 160/153, Unicode 70/67)", () => {
        assert.deepEqual(smsSegments("a".repeat(160)), { unicode: false, segments: 1 });
        assert.deepEqual(smsSegments("a".repeat(161)), { unicode: false, segments: 2 });
        assert.deepEqual(smsSegments("অ".repeat(70)), { unicode: true, segments: 1 });
        assert.deepEqual(smsSegments("অ".repeat(71)), { unicode: true, segments: 2 });
    });
    it("fills templates and leaves unknown variables visible", () => {
        assert.equal(fillTemplate("{student_name} {roll} {x}", { student_name: "Rafi", roll: 3 }), "Rafi 3 {x}");
    });
});
