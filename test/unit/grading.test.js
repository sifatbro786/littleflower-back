import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeResult, isEntered, prepareScale, withPositions } from "#modules/exams/exams.grading.js";

const SCALE = prepareScale([
    { minPercent: 80, maxPercent: 100, grade: "A+", point: 5 },
    { minPercent: 70, maxPercent: 79, grade: "A", point: 4 },
    { minPercent: 60, maxPercent: 69, grade: "A-", point: 3.5 },
    { minPercent: 50, maxPercent: 59, grade: "B", point: 3 },
    { minPercent: 40, maxPercent: 49, grade: "C", point: 2 },
    { minPercent: 33, maxPercent: 39, grade: "D", point: 1 },
    { minPercent: 0, maxPercent: 32, grade: "F", point: 0 },
]);
const SUBJECTS = [
    { examSubjectId: "en", name: "English", fullMarks: 100, passMarks: 33 },
    { examSubjectId: "ma", name: "Mathematics", fullMarks: 50, passMarks: 17 },
];
const mark = (obtained, extra = {}) => ({ obtained, absent: false, remarks: null, ...extra });
const run = (en, ma, remarksMode = false) => computeResult({ subjects: SUBJECTS, marks: new Map(Object.entries({ en, ma }).filter(([, v]) => v)), scale: SCALE, remarksMode });

describe("grade scale", () => {
    it("uses the highest row with minPercent <= percent (79.5% is A, not a gap)", () => {
        assert.equal(SCALE.forPercent(79.5).grade, "A");
        assert.equal(SCALE.forPercent(80).grade, "A+");
        assert.equal(SCALE.forPercent(32.99).grade, "F");
    });
    it("overall grade from GPA", () => {
        assert.equal(SCALE.forGpa(5).grade, "A+");
        assert.equal(SCALE.forGpa(4.99).grade, "A");
        assert.equal(SCALE.forGpa(0).grade, "F");
    });
});

describe("computeResult", () => {
    it("passes with half marks and averages points", () => {
        const r = run(mark(79.5), mark(40));
        assert.deepEqual([r.total, r.fullTotal, r.gpa, r.grade, r.failed, r.complete], [119.5, 150, 4.5, "A", false, true]);
    });
    it("fails a subject below its own pass mark even if the percentage grade would pass", () => {
        const r = run(mark(85), mark(16.5)); // 33% of 50 = 16.5 → below passMarks 17
        assert.equal(r.lines[1].grade, "F");
        assert.deepEqual([r.failed, r.gpa, r.grade], [true, 0, "F"]);
    });
    it("absent counts as failed and adds nothing to the total", () => {
        const r = run(mark(85), mark(null, { absent: true }));
        assert.deepEqual([r.lines[1].grade, r.total, r.failed, r.complete], ["AB", 85, true, true]);
    });
    it("a missing subject makes the result incomplete and failed", () => {
        const r = run(mark(85), null);
        assert.deepEqual([r.complete, r.failed, r.lines[1].grade], [false, true, "—"]);
    });
    it("REMARKS classes: no grade, GPA or failure; a remark counts as entered", () => {
        const r = run(mark(null, { remarks: "Reads well" }), mark(30), true);
        assert.deepEqual([r.gpa, r.grade, r.failed, r.complete], [null, null, false, true]);
        assert.equal(isEntered({ obtained: null, absent: false, remarks: "x" }, false), false);
    });
});

describe("withPositions", () => {
    const rows = [
        { roll: 1, name: "Zara", total: 100, failed: true, remarksMode: false },
        { roll: 2, name: "Mim", total: 90, failed: false, remarksMode: false },
        { roll: 3, name: "Arif", total: 90, failed: false, remarksMode: false },
    ];
    it("passed students first, then total, then roll", () => {
        assert.deepEqual(withPositions(rows).map((r) => r.position), [3, 1, 2]);
    });
    it("tie break by name when the school chooses it", () => {
        assert.deepEqual(withPositions(rows, "name").map((r) => r.position), [3, 2, 1]);
    });
    it("no positions for REMARKS classes", () => {
        assert.equal(withPositions([{ roll: 1, total: 5, failed: false, remarksMode: true }])[0].position, null);
    });
});
