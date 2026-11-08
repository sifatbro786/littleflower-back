import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { ACCOUNTS, BASE, client } from "./client.js";

/**
 * End-to-end flows against a running dev API with the demo seed (npm run test:api).
 * Covers the launch criteria: fee ledger always balances, one exam cycle end to end, attendance
 * rules, and "own" scopes. Each flow cleans up after itself where the rules allow (payments are
 * reversed, the test exam is emptied and deleted).
 */
const sa = client();
const acc = client();
const teacher = client();
let guardianA;
let guardianB;

before(async () => {
    const h = await fetch(`${BASE}/api/health`).catch(() => null);
    if (!h?.ok) throw new Error(`API not reachable at ${BASE} (start it with npm run dev)`);
    await sa.login(...ACCOUNTS.superAdmin());
    await acc.login(...ACCOUNTS.accountant());
    await teacher.login(...ACCOUNTS.teacher());
    const list = (await sa.get("/api/students")).data;
    guardianA = { c: client(), student: list[0] };
    guardianB = { c: client(), student: list[1] };
    await guardianA.c.login(...ACCOUNTS.guardian(list[0].studentUid.toLowerCase()));
    await guardianB.c.login(...ACCOUNTS.guardian(list[1].studentUid.toLowerCase()));
});

describe("fees: the ledger always balances", () => {
    it("two cashiers paying the same dues at once → one receipt, gap-free numbers, reversal reopens the dues", async () => {
        const list = (await acc.get("/api/fees/collect-list")).data;
        const st = list.find((s) => s.dues.length >= 2);
        assert.ok(st, "demo data needs a student with two open invoices");
        const dues = st.dues.slice(0, 2);
        const total = dues[0].due + dues[1].due;
        const body = (ref) => ({ studentId: st.id, amount: total, method: "CASH", invoiceIds: dues.map((d) => d.id), clientRef: ref });
        const stamp = Date.now();
        const [a, b] = await Promise.all([acc.post("/api/fees/payments", body(`t-${stamp}-a`)), acc.post("/api/fees/payments", body(`t-${stamp}-b`))]);
        const ok = [a, b].filter((r) => r.status === 201);
        assert.equal(ok.length, 1, "exactly one payment");
        assert.equal([a, b].find((r) => r.status !== 201).status, 409);
        const receipt = ok[0].data;
        assert.equal(receipt.lines.reduce((n, l) => n + l.amount, 0), total);

        const next = await acc.post("/api/fees/payments", { studentId: st.id, amount: 1, method: "CASH", invoiceIds: st.dues.slice(2, 3).map((d) => d.id).concat(dues[0].id), clientRef: `t-${stamp}-c` });
        if (next.status === 201) {
            const n = (s) => Number(s.split("-").at(-1));
            assert.equal(n(next.data.payment.receiptNo), n(receipt.payment.receiptNo) + 1, "receipt numbers have no gap");
            await acc.post(`/api/fees/payments/${next.data.payment.id}/reverse`, { reason: "API test cleanup" });
        }

        assert.equal((await acc.post("/api/fees/payments", body(`t-${stamp}-a`))).status, 409, "same clientRef rejected");
        assert.equal((await acc.post("/api/fees/payments", { ...body(`t-${stamp}-d`), amount: total + 1 })).status, 409, "dues already paid");

        const rev = await acc.post(`/api/fees/payments/${receipt.payment.id}/reverse`, { reason: "API test cleanup" });
        assert.equal(rev.data.payment.status, "REVERSED");
        assert.equal((await acc.post(`/api/fees/payments/${receipt.payment.id}/reverse`, { reason: "again" })).status, 409);
        const after = (await acc.get("/api/fees/collect-list")).data.find((s) => s.id === st.id);
        assert.equal(after.dues.find((d) => d.id === dues[0].id).due, dues[0].due, "reversed dues are open again");
    });

    it("every ledger total adds up (billed − paid allocations = due)", async () => {
        const l = (await acc.get(`/api/fees/students/${guardianA.student.id}/ledger`)).data;
        for (const i of l.invoices) assert.equal(i.due, Math.max(0, i.amount - i.discount - i.paid));
        assert.equal(l.totals.due, l.invoices.reduce((n, i) => n + i.due, 0));
    });

    it("invoice generation is idempotent", async () => {
        const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date()).slice(0, 7);
        await acc.post("/api/fees/invoices/generate", { month });
        const again = await acc.post("/api/fees/invoices/generate", { month });
        assert.equal(again.data.created, 0);
    });
});

describe("results: one exam cycle end to end", () => {
    it("create → open → teacher marks own subject → lock → publish → guardian sees → unpublish → clean up", async () => {
        const opts = (await teacher.get("/api/exams/marks-options")).data;
        assert.ok(opts.length, "demo teacher needs an assignment");
        const pick = opts[0];
        const sections = (await sa.get("/api/academics/sections")).data;
        const classId = sections.find((s) => s.value === pick.sectionId).classId;
        const exam = (await sa.post("/api/exams", { name: `API test ${Date.now()}`, classIds: [classId], fullMarks: 50, passMarks: 17 })).data;
        assert.equal(exam.status, "DRAFT");
        assert.equal((await teacher.get(`/api/exams/${exam.id}/marks?sectionId=${pick.sectionId}&subjectId=${pick.subjectId}`)).data.editable, false);
        await sa.post(`/api/exams/${exam.id}/status`, { status: "MARKS_OPEN" });

        const sheet = (await teacher.get(`/api/exams/${exam.id}/marks?sectionId=${pick.sectionId}&subjectId=${pick.subjectId}`)).data;
        const other = (await sa.get("/api/exams/marks-options")).data.find((o) => o.sectionId !== pick.sectionId && !opts.some((x) => x.value === o.value));
        if (other) assert.equal((await teacher.get(`/api/exams/${exam.id}/marks?sectionId=${other.sectionId}&subjectId=${other.subjectId}`)).status, 404, "teacher cannot open another teacher's subject");
        assert.equal((await teacher.put(`/api/exams/${exam.id}/marks`, { sectionId: pick.sectionId, subjectId: pick.subjectId, rows: [{ enrollmentId: sheet.rows[0].enrollmentId, obtained: 51, absent: false }] })).status, 400, "above full marks");
        const rows = sheet.rows.map((r, i) => ({ enrollmentId: r.enrollmentId, obtained: i === 0 ? null : 20 + (i % 30) + 0.5, absent: i === 0, remarks: sheet.gradingMode === "REMARKS" ? "Good effort" : null }));
        const saved = (await teacher.put(`/api/exams/${exam.id}/marks`, { sectionId: pick.sectionId, subjectId: pick.subjectId, rows })).data;
        assert.equal(saved.entered, sheet.rows.length);

        assert.equal((await sa.post(`/api/exams/${exam.id}/publish`, {})).status, 409, "publish needs LOCKED");
        await sa.post(`/api/exams/${exam.id}/status`, { status: "LOCKED" });
        assert.equal((await teacher.put(`/api/exams/${exam.id}/marks`, { sectionId: pick.sectionId, subjectId: pick.subjectId, rows: rows.slice(0, 1) })).status, 409, "locked");
        const pub = await sa.post(`/api/exams/${exam.id}/publish`, { allowIncomplete: true, sendSms: false });
        assert.equal(pub.status, 200, pub.error?.message);

        const tab = (await sa.get(`/api/exams/${exam.id}/tabulation?sectionId=${pick.sectionId}`)).data;
        assert.equal(tab.published, true);
        assert.equal(tab.rows.length, sheet.rows.length);

        await sa.post(`/api/exams/${exam.id}/unpublish`, {});
        await sa.post(`/api/exams/${exam.id}/status`, { status: "MARKS_OPEN" });
        await teacher.put(`/api/exams/${exam.id}/marks`, { sectionId: pick.sectionId, subjectId: pick.subjectId, rows: rows.map((r) => ({ enrollmentId: r.enrollmentId, obtained: null, absent: false, remarks: null })) });
        assert.equal((await sa.post(`/api/exams/${exam.id}/status`, { status: "DRAFT" })).status, 200);
        assert.equal((await sa.del(`/api/exams/${exam.id}`)).status, 200);
    });
});

describe("attendance rules", () => {
    it("re-saving a day upserts (one row per student per date) and past dates send no SMS", async () => {
        const days = (await sa.get("/api/attendance/dates?n=3")).data;
        const date = days[0]; // oldest of the last three school days: never today
        const sectionId = (await sa.get("/api/academics/sections")).data[0].value;
        const sheet = (await sa.get(`/api/attendance/sheet?sectionId=${sectionId}&date=${date}`)).data;
        const entries = sheet.rows.map((r, i) => ({ enrollmentId: r.enrollmentId, status: i === 0 ? "ABSENT" : r.status ?? "PRESENT" }));
        const first = await sa.put("/api/attendance/sheet", { sectionId, date, entries });
        assert.equal(first.status, 200, first.error?.message);
        assert.ok(!first.data.smsAt, "no absent SMS for a past date");
        const again = (await sa.put("/api/attendance/sheet", { sectionId, date, entries })).data;
        assert.equal(again.present + again.absent + again.late, sheet.rows.length);
        const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
        assert.equal((await sa.put("/api/attendance/sheet", { sectionId, date: future, entries })).status, 400, "future date");
    });
});

describe("own scopes", () => {
    it("a guardian gets 404 for another child (ledger, results, attendance, admit card)", async () => {
        const other = guardianB.student.id;
        const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date()).slice(0, 7);
        for (const p of [`/api/fees/students/${other}/ledger`, `/api/exams/students/${other}/results`, `/api/attendance/students/${other}?month=${month}`, `/api/exams/students/${other}/admit-card`, `/api/students/${other}`]) {
            assert.equal((await guardianA.c.get(p)).status, 404, p);
        }
        assert.equal((await guardianA.c.get(`/api/fees/students/${guardianA.student.id}/ledger`)).status, 200);
    });
    it("staff-only endpoints refuse guardians and teachers", async () => {
        assert.equal((await guardianA.c.get("/api/fees/dues")).status, 403);
        assert.equal((await teacher.get("/api/fees/summary")).status, 403);
        assert.equal((await teacher.patch("/api/settings", { "results.tieBreak": "name" })).status, 403);
    });
});
