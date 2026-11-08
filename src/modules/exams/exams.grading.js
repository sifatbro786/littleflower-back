/**
 * Result calculation (PRD §6.3). Pure functions: no database, so Step 5 tests can cover them directly.
 * The same code computes the live tabulation and the frozen ResultSnapshot, so what the principal
 * reviews is exactly what gets published.
 *
 * Rules
 * - Subject grade from the percentage via the grade scale (highest row with minPercent <= percent).
 * - A subject fails when absent, not entered, or obtained < that subject's passMarks (point 0, grade F).
 * - Any failed subject → overall F, GPA 0. Otherwise GPA = average point (2 decimals), overall grade
 *   = highest scale row whose point <= GPA.
 * - REMARKS classes (Play Group–KG): no grade, GPA or position; teachers' remarks are the report.
 * - Position inside a section: passed students first, then total desc, then roll asc.
 */

/** @typedef {{ minPercent: number, maxPercent: number, grade: string, point: number }} Grade */
/** @typedef {{ examSubjectId: string, name: string, fullMarks: number, passMarks: number }} ExamSubjectRef */
/** @typedef {{ obtained: number | null, absent: boolean, remarks: string | null }} MarkRef */

const round2 = (n) => Math.round(n * 100) / 100;

/** @param {Grade[]} scale any order */
export function prepareScale(scale) {
    const byPercent = [...scale].sort((a, b) => b.minPercent - a.minPercent);
    const byPoint = [...scale].sort((a, b) => b.point - a.point);
    const fail = byPercent.at(-1) ?? { grade: "F", point: 0 };
    return {
        /** @param {number} percent */
        forPercent: (percent) => byPercent.find((g) => percent >= g.minPercent) ?? fail,
        /** @param {number} gpa */
        forGpa: (gpa) => byPoint.find((g) => gpa >= g.point) ?? fail,
        fail,
    };
}

/** A mark row counts as entered when it holds a number, an absent flag or (REMARKS classes) a remark. */
export const isEntered = (m, remarksMode = false) => Boolean(m && (m.absent || m.obtained != null || (remarksMode && m.remarks)));

/**
 * @param {{ subjects: ExamSubjectRef[], marks: Map<string, MarkRef>, scale: ReturnType<typeof prepareScale>, remarksMode: boolean }} input
 */
export function computeResult({ subjects, marks, scale, remarksMode }) {
    const lines = subjects.map((s) => {
        const m = marks.get(s.examSubjectId);
        const entered = isEntered(m, remarksMode);
        const absent = Boolean(m?.absent);
        const obtained = m?.obtained ?? null;
        const base = { subject: s.name, full: s.fullMarks, pass: s.passMarks, obtained, absent, entered, remarks: m?.remarks ?? null };
        if (remarksMode) return { ...base, grade: absent ? "AB" : "—", point: 0, failed: false };
        if (!entered) return { ...base, grade: "—", point: 0, failed: true };
        if (absent) return { ...base, grade: "AB", point: 0, failed: true };
        if (obtained < s.passMarks) return { ...base, grade: scale.fail.grade, point: 0, failed: true };
        const g = scale.forPercent((obtained / s.fullMarks) * 100);
        return { ...base, grade: g.grade, point: g.point, failed: g.point === 0 };
    });

    const total = round2(lines.reduce((sum, l) => sum + (l.absent ? 0 : (l.obtained ?? 0)), 0));
    const fullTotal = lines.reduce((sum, l) => sum + l.full, 0);
    const complete = lines.length > 0 && lines.every((l) => l.entered);
    const percent = fullTotal ? round2((total / fullTotal) * 100) : 0;

    if (remarksMode) return { lines, total, fullTotal, percent, complete, remarksMode, failed: false, gpa: null, grade: null };

    const failed = !lines.length || lines.some((l) => l.failed);
    const gpa = failed ? 0 : round2(lines.reduce((sum, l) => sum + l.point, 0) / lines.length);
    return { lines, total, fullTotal, percent, complete, remarksMode, failed, gpa, grade: failed ? scale.fail.grade : scale.forGpa(gpa).grade };
}

/**
 * Adds position (1..n) to results of one section. REMARKS classes get null.
 * Tie break after total: setting results.tieBreak "roll" (default) or "name".
 * @template {{ roll: number, name?: string, total: number, failed: boolean, remarksMode: boolean }} T
 * @param {T[]} rows
 * @param {"roll" | "name"} [tie]
 * @returns {(T & { position: number | null })[]}
 */
export function withPositions(rows, tie = "roll") {
    const second = tie === "name" ? (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.roll - b.roll : (a, b) => a.roll - b.roll;
    const ranked = [...rows].sort((a, b) => Number(a.failed) - Number(b.failed) || b.total - a.total || second(a, b));
    const pos = new Map(ranked.map((r, i) => [r, i + 1]));
    return rows.map((r) => ({ ...r, position: r.remarksMode ? null : pos.get(r) }));
}
