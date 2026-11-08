// Copied from littleflower-front/lib/demo/seed.js. Demo seed source only (SEED_DEMO=true, never in production).
/**
 * DEMO DATA — deterministic sample records for the client demo (no database yet).
 *
 * Everything here mirrors the PRD §8 data model (Student, Enrollment, Staff, Exam, Mark, Attendance,
 * Invoice, Payment …) so the shapes returned by lib/dashboard/* stay identical when Phase 2 swaps this
 * file for real API calls. Names and numbers are fictional. Delete this folder once the API exists.
 */

/* ------------------------------------------------------------------ */
/* Deterministic random helpers (same output on every server render)  */
/* ------------------------------------------------------------------ */
export function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    // murmur3 finaliser: similar keys ("x-1", "x-2") must not give similar numbers
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}
const pick = (arr, key) => arr[Math.floor(hash(key) * arr.length) % arr.length];
const between = (min, max, key) => Math.round(min + hash(key) * (max - min));

/* ------------------------------------------------------------------ */
/* Academic setup                                                      */
/* ------------------------------------------------------------------ */
export const session = { id: "ses-2026", name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", isCurrent: true };

export const classes = [
    { id: "pg", name: "Play Group", order: 1, gradingMode: "REMARKS" },
    { id: "nursery", name: "Nursery", order: 2, gradingMode: "REMARKS" },
    { id: "kg", name: "KG", order: 3, gradingMode: "REMARKS" },
    { id: "c1", name: "Class I", order: 4, gradingMode: "MARKS" },
    { id: "c2", name: "Class II", order: 5, gradingMode: "MARKS" },
    { id: "c3", name: "Class III", order: 6, gradingMode: "MARKS" },
    { id: "c4", name: "Class IV", order: 7, gradingMode: "MARKS" },
    { id: "c5", name: "Class V", order: 8, gradingMode: "MARKS" },
    { id: "c6", name: "Class VI", order: 9, gradingMode: "MARKS" },
    { id: "c7", name: "Class VII", order: 10, gradingMode: "MARKS" },
    { id: "c8", name: "Class VIII", order: 11, gradingMode: "MARKS" },
    { id: "c9", name: "Class IX", order: 12, gradingMode: "MARKS" },
    { id: "c10", name: "Class X", order: 13, gradingMode: "MARKS" },
];

const SUBJECTS_EARLY = ["English", "Bangla", "Mathematics", "Rhymes & Drawing", "Arabic"];
const SUBJECTS_PRIMARY = ["English 1st Paper", "English 2nd Paper", "Bangla", "Mathematics", "Science", "Bangladesh & Global Studies", "Religion", "Arabic"];
const SUBJECTS_SECONDARY = ["Bangla 1st Paper", "Bangla 2nd Paper", "English 1st Paper", "English 2nd Paper", "Mathematics", "Science", "Bangladesh & Global Studies", "Religion", "ICT"];
const SECONDARY = new Set(["c6", "c7", "c8", "c9", "c10"]);

export const subjects = classes.flatMap((c) =>
    (SECONDARY.has(c.id) ? SUBJECTS_SECONDARY : c.gradingMode === "MARKS" ? SUBJECTS_PRIMARY : SUBJECTS_EARLY).map((name, i) => ({
        id: `${c.id}-s${i + 1}`,
        classId: c.id,
        name,
        order: i + 1,
    })),
);

/* ------------------------------------------------------------------ */
/* Staff                                                                */
/* ------------------------------------------------------------------ */
export const staff = [
    { id: "t01", name: "Nasrin Akter", designation: "Assistant Head Teacher", phone: "01711-000101", email: "nasrin@littleflower.demo", qualification: "M.A. in English", joinedAt: "2025-01-01" },
    { id: "t02", name: "Farzana Rahman", designation: "Senior Teacher", phone: "01711-000102", email: "farzana@littleflower.demo", qualification: "B.Ed, M.A.", joinedAt: "2025-01-01" },
    { id: "t03", name: "Md. Rakibul Hasan", designation: "Senior Teacher", phone: "01711-000103", email: "rakib@littleflower.demo", qualification: "M.Sc. in Mathematics", joinedAt: "2025-01-01" },
    { id: "t04", name: "Sharmin Sultana", designation: "Assistant Teacher", phone: "01711-000104", email: "sharmin@littleflower.demo", qualification: "B.A. (Hons)", joinedAt: "2025-01-05" },
    { id: "t05", name: "Tahmina Begum", designation: "Assistant Teacher", phone: "01711-000105", email: "tahmina@littleflower.demo", qualification: "B.Sc., B.Ed", joinedAt: "2025-01-05" },
    { id: "t06", name: "Hafez Abdullah", designation: "Arabic Teacher", phone: "01711-000106", email: "abdullah@littleflower.demo", qualification: "Kamil (Hadith)", joinedAt: "2025-01-01" },
    { id: "t07", name: "Ruma Khatun", designation: "Assistant Teacher", phone: "01711-000107", email: "ruma@littleflower.demo", qualification: "B.A., Montessori Training", joinedAt: "2025-02-01" },
    { id: "t08", name: "Sabina Yasmin", designation: "Art & Craft Teacher", phone: "01711-000108", email: "sabina@littleflower.demo", qualification: "BFA", joinedAt: "2025-03-01" },
];

/** Class teacher per section + subject assignments (TeacherAssignment). */
const classTeacher = { pg: "t07", nursery: "t04", kg: "t05", c1: "t02", c2: "t01", c3: "t03", c4: "t02", c5: "t01", c6: "t03", c7: "t05", c8: "t01", c9: "t03", c10: "t02" };

/** Demo keeps one section per class (the English Version medium); live seeds all three mediums. */
export const sections = classes.map((c) => ({ id: `${c.id}-a`, classId: c.id, name: "English Version", classTeacherId: classTeacher[c.id] }));

function subjectTeacher(subjectName, classId) {
    if (subjectName === "Arabic" || subjectName === "Religion") return "t06";
    if (subjectName === "ICT") return "t03";
    if (subjectName === "Rhymes & Drawing") return "t08";
    if (/Mathematics|Science/.test(subjectName)) return classId === "c1" || classId === "c2" ? "t05" : "t03";
    if (/English/.test(subjectName)) return ["c4", "c5", "c8", "c9", "c10"].includes(classId) ? "t01" : "t02";
    return classTeacher[classId];
}

export const assignments = subjects.map((s) => ({
    id: `as-${s.id}`,
    staffId: subjectTeacher(s.name, s.classId),
    sectionId: `${s.classId}-a`,
    subjectId: s.id,
    sessionId: session.id,
}));

/* ------------------------------------------------------------------ */
/* Students + enrollments                                               */
/* ------------------------------------------------------------------ */
const FIRST_BOYS = ["Ayaan", "Rayan", "Zayan", "Arham", "Rafsan", "Tahsin", "Nafis", "Saad", "Ishraq", "Fahim", "Rifat", "Mahir", "Arian", "Samin", "Yasir", "Tanvir", "Abrar", "Labib"];
const FIRST_GIRLS = ["Ayesha", "Inaya", "Zara", "Maryam", "Raisa", "Nusaiba", "Tasnim", "Anika", "Sumaiya", "Fariha", "Nabiha", "Liyana", "Ishrat", "Sadia", "Mahira", "Arisha", "Rumaisa", "Tahiya"];
const LAST = ["Rahman", "Hossain", "Islam", "Ahmed", "Chowdhury", "Karim", "Uddin", "Haque", "Sarkar", "Alam", "Mia", "Talukder", "Siddique", "Khan"];
const FATHER = ["Md. Abdul Karim", "Md. Shafiqul Islam", "Md. Jahangir Alam", "Md. Mizanur Rahman", "Md. Kamrul Hasan", "Md. Rezaul Karim", "Md. Aminul Haque", "Md. Habibur Rahman", "Md. Nazmul Hossain", "Md. Saiful Islam"];
const MOTHER = ["Rokeya Begum", "Shirin Akter", "Nasima Khatun", "Fatema Begum", "Salma Akter", "Rehana Parvin", "Jesmin Ara", "Lovely Akter", "Mousumi Rahman", "Shapla Begum"];
const AREAS = ["East Kazipara, Kafrul", "West Kazipara, Mirpur", "Shewrapara, Mirpur", "Itkhola Bazar, Kafrul", "Senpara Parbata, Mirpur", "Taltola, Agargaon", "Ibrahimpur, Kafrul", "Section 10, Mirpur"];

const COUNTS = { pg: 18, nursery: 20, kg: 22, c1: 24, c2: 22, c3: 20, c4: 18, c5: 16, c6: 16, c7: 15, c8: 14, c9: 13, c10: 12 };
const BIRTH_YEAR = { pg: 2022, nursery: 2021, kg: 2020, c1: 2019, c2: 2018, c3: 2017, c4: 2016, c5: 2015, c6: 2014, c7: 2013, c8: 2012, c9: 2011, c10: 2010 };

export const students = [];
export const enrollments = [];
let serial = 1;
for (const c of classes) {
    for (let roll = 1; roll <= COUNTS[c.id]; roll++) {
        const key = `${c.id}-${roll}`;
        const gender = hash(`g-${key}`) > 0.5 ? "FEMALE" : "MALE";
        const first = pick(gender === "FEMALE" ? FIRST_GIRLS : FIRST_BOYS, `f-${key}`);
        const last = pick(LAST, `l-${key}`);
        const uid = `LFIS-26${String(serial).padStart(3, "0")}`;
        const id = `stu-${String(serial).padStart(3, "0")}`;
        const month = between(1, 12, `m-${key}`);
        const day = between(1, 28, `d-${key}`);
        students.push({
            id,
            studentUid: uid,
            name: `${first} ${last}`,
            gender,
            dob: `${BIRTH_YEAR[c.id]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            bloodGroup: pick(["A+", "B+", "O+", "AB+", "A-", "O-"], `b-${key}`),
            fatherName: pick(FATHER, `fa-${key}`),
            motherName: pick(MOTHER, `mo-${key}`),
            guardianPhone: `0171${between(1, 9, `p1-${key}`)}-${String(between(100000, 999999, `p2-${key}`))}`,
            address: pick(AREAS, `ad-${key}`) + ", Dhaka",
            admissionDate: hash(`adm-${key}`) > 0.6 ? "2026-01-04" : "2025-01-02",
            status: serial === 37 ? "INACTIVE" : "ACTIVE",
            userId: `usr-${id}`,
        });
        enrollments.push({ id: `enr-${id}`, studentId: id, sessionId: session.id, sectionId: `${c.id}-a`, classId: c.id, roll });
        serial++;
    }
}

/* ------------------------------------------------------------------ */
/* Grade scale (Bangladesh primary GPA)                                 */
/* ------------------------------------------------------------------ */
export const gradeScale = [
    { minPercent: 80, maxPercent: 100, grade: "A+", point: 5.0 },
    { minPercent: 70, maxPercent: 79, grade: "A", point: 4.0 },
    { minPercent: 60, maxPercent: 69, grade: "A-", point: 3.5 },
    { minPercent: 50, maxPercent: 59, grade: "B", point: 3.0 },
    { minPercent: 40, maxPercent: 49, grade: "C", point: 2.0 },
    { minPercent: 33, maxPercent: 39, grade: "D", point: 1.0 },
    { minPercent: 0, maxPercent: 32, grade: "F", point: 0.0 },
];

/* ------------------------------------------------------------------ */
/* Exams                                                                */
/* ------------------------------------------------------------------ */
export const exams = [
    { id: "ex-1", name: "First Term Examination", short: "First Term", sessionId: session.id, status: "PUBLISHED", startDate: "2026-04-12", endDate: "2026-04-22", publishedAt: "2026-05-05" },
    { id: "ex-2", name: "Second Term Examination", short: "Second Term", sessionId: session.id, status: "PUBLISHED", startDate: "2026-08-09", endDate: "2026-08-19", publishedAt: "2026-09-01" },
    { id: "ex-3", name: "Annual Examination", short: "Annual", sessionId: session.id, status: "MARKS_OPEN", startDate: "2026-11-15", endDate: "2026-11-26", publishedAt: null },
];

export const examSubjects = exams.flatMap((e) =>
    subjects.map((s) => ({ id: `${e.id}-${s.id}`, examId: e.id, subjectId: s.id, classId: s.classId, fullMarks: 100, passMarks: 33 })),
);

/** Marks for every enrollment × exam-subject. Annual exam: only ~40% entered so far. */
export const marks = [];
for (const en of enrollments) {
    const ability = 0.55 + hash(`ab-${en.studentId}`) * 0.4; // 55%–95% baseline per student
    for (const es of examSubjects.filter((x) => x.classId === en.classId)) {
        const exam = exams.find((e) => e.id === es.examId);
        if (exam.status === "MARKS_OPEN" && hash(`open-${es.subjectId}`) > 0.4) continue;
        const absent = hash(`abs-${en.id}-${es.id}`) < 0.008;
        const raw = ability * 100 + (hash(`mk-${en.id}-${es.id}`) - 0.5) * 24;
        marks.push({
            id: `mk-${en.id}-${es.id}`,
            enrollmentId: en.id,
            examSubjectId: es.id,
            obtained: absent ? null : Math.max(12, Math.min(99, Math.round(raw))),
            absent,
            enteredById: assignments.find((a) => a.subjectId === es.subjectId)?.staffId,
        });
    }
}

/* ------------------------------------------------------------------ */
/* Routine (Sunday–Thursday, 6 periods)                                 */
/* ------------------------------------------------------------------ */
export const periods = [
    { id: "p1", number: 1, start: "08:00", end: "08:40" },
    { id: "p2", number: 2, start: "08:40", end: "09:20" },
    { id: "p3", number: 3, start: "09:20", end: "10:00" },
    { id: "p4", number: 4, start: "10:20", end: "11:00" },
    { id: "p5", number: 5, start: "11:00", end: "11:40" },
    { id: "p6", number: 6, start: "11:40", end: "12:20" },
];
export const DAYS = ["SUN", "MON", "TUE", "WED", "THU"];

export const routineSlots = [];
const booked = new Set(); // staffId|day|period — DB unique constraint (staffId, day, periodId, sessionId)
for (const sec of sections) {
    const subs = subjects.filter((s) => s.classId === sec.classId);
    const early = classes.find((c) => c.id === sec.classId).gradingMode === "REMARKS";
    const maxP = early ? 4 : 6;
    DAYS.forEach((day, d) => {
        for (let p = 0; p < maxP; p++) {
            // rotate through subjects, skipping any whose teacher is already in another class this period
            for (let k = 0; k < subs.length; k++) {
                const sub = subs[(p + d * 2 + k) % subs.length];
                const staffId = assignments.find((a) => a.subjectId === sub.id)?.staffId;
                const key = `${staffId}|${day}|${p}`;
                if (booked.has(key)) continue;
                booked.add(key);
                routineSlots.push({ id: `rs-${sec.id}-${day}-${p + 1}`, sessionId: session.id, sectionId: sec.id, day, periodId: periods[p].id, subjectId: sub.id, staffId });
                break;
            }
        }
    });
}

/* ------------------------------------------------------------------ */
/* Holidays                                                             */
/* ------------------------------------------------------------------ */
export const holidays = [
    { date: "2026-02-21", title: "Shaheed Day & International Mother Language Day" },
    { date: "2026-03-26", title: "Independence Day" },
    { date: "2026-04-14", title: "Pohela Boishakh" },
    { date: "2026-05-01", title: "May Day" },
    { date: "2026-08-05", title: "July Mass Uprising Day" },
    { date: "2026-12-16", title: "Victory Day" },
];

/* ------------------------------------------------------------------ */
/* Fees                                                                 */
/* ------------------------------------------------------------------ */
export const feeHeads = [
    { id: "fh-admission", name: "Admission Fee", type: "ONE_TIME" },
    { id: "fh-session", name: "Session Fee", type: "ONE_TIME" },
    { id: "fh-tuition", name: "Monthly Tuition", type: "MONTHLY" },
    { id: "fh-exam", name: "Exam Fee", type: "ONE_TIME" },
];

const TUITION = { pg: 2000, nursery: 2200, kg: 2400, c1: 2600, c2: 2700, c3: 2800, c4: 3000, c5: 3200, c6: 3400, c7: 3500, c8: 3600, c9: 3800, c10: 4000 };
export const feeStructures = classes.flatMap((c) => [
    { id: `fs-${c.id}-tuition`, sessionId: session.id, classId: c.id, feeHeadId: "fh-tuition", amount: TUITION[c.id] },
    { id: `fs-${c.id}-session`, sessionId: session.id, classId: c.id, feeHeadId: "fh-session", amount: 3000 },
    { id: `fs-${c.id}-exam`, sessionId: session.id, classId: c.id, feeHeadId: "fh-exam", amount: c.gradingMode === "MARKS" ? 600 : 400 },
    { id: `fs-${c.id}-admission`, sessionId: session.id, classId: c.id, feeHeadId: "fh-admission", amount: 8000 },
]);

/**
 * "Today" for the demo, in Asia/Dhaka, clamped to the 2026 session so the demo still makes sense
 * if it is opened later. All attendance and fee data is generated relative to this date.
 */
export const DEMO_TODAY = (() => {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
    if (d < "2026-02-01") return "2026-02-01";
    if (d > "2026-12-31") return "2026-12-31";
    return d;
})();
const CUR_MONTH = Number(DEMO_TODAY.slice(5, 7));
const TODAY_DAY = Number(DEMO_TODAY.slice(8, 10));
const MONTHS = Array.from({ length: CUR_MONTH }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
export const invoices = [];
export const payments = [];
export const allocations = [];
let receiptSeq = 1;
const COLLECTORS = ["usr-accounts", "usr-office"];

for (const en of enrollments) {
    const stu = students.find((s) => s.id === en.studentId);
    const amt = (head) => feeStructures.find((f) => f.classId === en.classId && f.feeHeadId === head).amount;
    const sibling = hash(`sib-${stu.id}`) < 0.1; // 10% sibling waiver on tuition
    const list = [];
    if (stu.admissionDate.startsWith("2026")) list.push({ head: "fh-admission", month: "2026-01" });
    list.push({ head: "fh-session", month: "2026-01" });
    MONTHS.forEach((m) => list.push({ head: "fh-tuition", month: m }));
    list.push({ head: "fh-exam", month: "2026-04" }, { head: "fh-exam", month: "2026-08" });

    const payer = hash(`payer-${stu.id}`); // how up to date this family is
    const paidUntil = payer > 0.75 ? CUR_MONTH : payer > 0.35 ? CUR_MONTH - 1 : payer > 0.12 ? CUR_MONTH - 2 : CUR_MONTH - 4; // months paid

    list.forEach((item, i) => {
        const id = `inv-${stu.id}-${i + 1}`;
        const amount = amt(item.head);
        const discount = item.head === "fh-tuition" && sibling ? Math.round(amount * 0.1) : 0;
        invoices.push({ id, enrollmentId: en.id, studentId: stu.id, feeHeadId: item.head, month: item.month, amount, discount });
        const monthNo = Number(item.month.slice(5));
        if (monthNo <= paidUntil) {
            const isCur = monthNo === CUR_MONTH;
            // current-month payments fall on or before today; ~1 in 6 of them today (for the dashboard)
            const day = isCur ? (hash(`td-${id}`) < 0.17 ? TODAY_DAY : between(1, Math.max(1, TODAY_DAY), `pd-${id}`)) : between(3, 15, `pd-${id}`);
            const paidAt = `${item.month}-${String(day).padStart(2, "0")}T${String(between(9, 13, `ph-${id}`)).padStart(2, "0")}:${String(between(0, 59, `pm-${id}`)).padStart(2, "0")}:00+06:00`;
            const online = hash(`on-${id}`) < 0.18;
            const pid = `pay-${String(receiptSeq).padStart(5, "0")}`;
            payments.push({
                id: pid,
                receiptNo: `LFIS-2026-${String(receiptSeq).padStart(5, "0")}`,
                studentId: stu.id,
                amount: amount - discount,
                method: online ? pick(["BKASH", "CARD"], `mth-${id}`) : "CASH",
                tranId: online ? `TRX${Math.floor(hash(`tx-${id}`) * 1e10)}` : null,
                collectedById: online ? null : pick(COLLECTORS, `col-${id}`),
                paidAt,
                reversedPaymentId: null,
                status: "VALID",
            });
            allocations.push({ id: `al-${pid}`, paymentId: pid, invoiceId: id, amount: amount - discount });
            receiptSeq++;
        }
    });
}
// Receipt numbers are gap-free and chronological (PRD §6.7: locked counter row in the payment transaction)
payments.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
payments.forEach((p, i) => (p.receiptNo = `LFIS-2026-${String(i + 1).padStart(5, "0")}`));
// One reversal example (never deleted, only reversed — PRD §6.7)
if (payments[41]) payments[41] = { ...payments[41], status: "REVERSED", reversalReason: "Duplicate entry at counter" };

/* ------------------------------------------------------------------ */
/* Notices (internal + public), SMS, audit                              */
/* ------------------------------------------------------------------ */
export const staffNotices = [
    { id: "sn-1", title: "Annual exam question papers due by 5 November", audience: "STAFF", publishedAt: "2026-10-22T10:00:00+06:00", pinned: true, body: "Class teachers, please submit question papers for the Annual Examination to the office by 5 November." },
    { id: "sn-2", title: "Marks entry for Annual Examination is open", audience: "STAFF", publishedAt: "2026-10-20T09:00:00+06:00", pinned: false, body: "Marks entry stays open until 30 November. Please enter marks only for your assigned subjects." },
    { id: "sn-3", title: "Parent–teacher meeting on Thursday", audience: "ALL", publishedAt: "2026-10-15T09:00:00+06:00", pinned: false, body: "Parent–teacher meeting for all classes on Thursday, 10:30 AM to 12:30 PM." },
    { id: "sn-4", title: "Winter uniform from 1 December", audience: "ALL", publishedAt: "2026-10-12T09:00:00+06:00", pinned: false, body: "Students may wear the school sweater with the regular uniform from 1 December." },
    { id: "sn-5", title: "Class V: extra practice classes", audience: "CLASS:c5", publishedAt: "2026-10-10T09:00:00+06:00", pinned: false, body: "Extra practice classes for Class V on Sunday and Tuesday after the last period." },
];

export const smsTemplates = [
    { id: "tpl-absent", name: "Absent alert", type: "ABSENT", body: "Dear guardian, {student_name} (Roll {roll}, {class}) was absent today, {date}. - Little Flower School" },
    { id: "tpl-due", name: "Fee due reminder", type: "FEE_DUE", body: "Dear guardian, {student_name}'s fees of Tk {due_amount} are due. Please pay by {due_date}. - Little Flower School" },
    { id: "tpl-result", name: "Result published", type: "RESULT", body: "{student_name}'s {exam} result is published. GPA {gpa}. Login: portal. - Little Flower School" },
    { id: "tpl-bn", name: "Holiday notice (Bangla)", type: "CUSTOM", body: "প্রিয় অভিভাবক, আগামীকাল স্কুল বন্ধ থাকবে। - লিটল ফ্লাওয়ার স্কুল" },
];

export const smsLogs = Array.from({ length: 28 }, (_, i) => {
    const s = students[(i * 7) % students.length];
    const type = ["ABSENT", "FEE_DUE", "RESULT", "CUSTOM"][i % 4];
    const day = 26 - Math.floor(i / 3);
    return {
        id: `sms-${i + 1}`,
        to: s.guardianPhone,
        studentId: s.id,
        type,
        segments: type === "CUSTOM" ? 2 : 1,
        status: i === 5 ? "FAILED" : i === 11 ? "QUEUED" : "DELIVERED",
        providerId: `MSG${100000 + i * 37}`,
        sentAt: `2026-10-${String(Math.max(day, 1)).padStart(2, "0")}T${String(10 + (i % 6)).padStart(2, "0")}:3${i % 10}:00+06:00`,
    };
});

export const auditLogs = [
    { id: "au-1", actor: "Nasrin Akter", action: "results.publish", entity: "Exam", entityId: "ex-2", detail: "Published Second Term Examination", ip: "103.92.84.17", createdAt: "2026-09-01T11:04:00+06:00" },
    { id: "au-2", actor: "Accounts Desk", action: "payment.reverse", entity: "Payment", entityId: "pay-00042", detail: "Reversed receipt LFIS-2026-00042 (duplicate entry at counter)", ip: "103.92.84.17", createdAt: "2026-10-18T12:40:00+06:00" },
    { id: "au-3", actor: "Md. Rakibul Hasan", action: "marks.update", entity: "Mark", entityId: "c4-s4", detail: "Updated Mathematics marks, Class IV (Annual)", ip: "103.92.84.22", createdAt: "2026-10-24T14:12:00+06:00" },
    { id: "au-4", actor: "Super Admin", action: "role.update", entity: "Role", entityId: "ACCOUNTANT", detail: "Granted sms.dues to Accountant", ip: "202.84.40.10", createdAt: "2026-10-10T09:30:00+06:00" },
    { id: "au-5", actor: "Office Desk", action: "student.create", entity: "Student", entityId: "stu-171", detail: "Admitted new student to Class IV", ip: "103.92.84.17", createdAt: "2026-10-08T10:15:00+06:00" },
    { id: "au-6", actor: "Farzana Rahman", action: "auth.login", entity: "User", entityId: "usr-t02", detail: "Signed in", ip: "103.92.84.31", createdAt: "2026-10-26T07:52:00+06:00" },
    { id: "au-7", actor: "Nasrin Akter", action: "attendance.update", entity: "Attendance", entityId: "c2-a", detail: "Corrected attendance for Class II before SMS cut-off", ip: "103.92.84.31", createdAt: "2026-10-25T09:48:00+06:00" },
    { id: "au-8", actor: "Super Admin", action: "settings.update", entity: "Setting", entityId: "sms.cutoff", detail: "Absent SMS cut-off changed to 10:30", ip: "202.84.40.10", createdAt: "2026-10-02T16:20:00+06:00" },
];
