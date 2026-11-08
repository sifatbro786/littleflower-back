/**
 * School-specific bootstrap data (Little Flower International English Medium School). For the next school, replace this file and /content;
 * no code changes. Everything here is create-if-missing: edits made in the admin panel are never overwritten.
 */

export const SESSION = { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" };

/**
 * Sections created for every class. Little Flower runs three mediums; each medium is a section
 * (decision 8 Nov 2026), so rolls, routines, attendance and results stay per medium with no code change.
 * TODO(school): confirm which classes run all three mediums; unused sections can be deleted in the panel.
 */
export const SECTIONS = ["English Medium", "English Version", "Bangla Medium"];

// TODO(school): confirm subject lists per stage (English Medium / Cambridge subject names may differ).
export const SUBJECTS = {
    EARLY: ["English", "Bangla", "Mathematics", "Rhymes & Drawing", "Arabic"],
    PRIMARY: ["English 1st Paper", "English 2nd Paper", "Bangla", "Mathematics", "Science", "Bangladesh & Global Studies", "Religion", "Arabic"],
    SECONDARY: ["Bangla 1st Paper", "Bangla 2nd Paper", "English 1st Paper", "English 2nd Paper", "Mathematics", "Science", "Bangladesh & Global Studies", "Religion", "ICT"],
};

/** Bangladesh primary GPA scale. Lookup: highest minPercent <= percent. */
export const GRADE_SCALE = [
    { minPercent: 80, maxPercent: 100, grade: "A+", point: 5.0 },
    { minPercent: 70, maxPercent: 79, grade: "A", point: 4.0 },
    { minPercent: 60, maxPercent: 69, grade: "A-", point: 3.5 },
    { minPercent: 50, maxPercent: 59, grade: "B", point: 3.0 },
    { minPercent: 40, maxPercent: 49, grade: "C", point: 2.0 },
    { minPercent: 33, maxPercent: 39, grade: "D", point: 1.0 },
    { minPercent: 0, maxPercent: 32, grade: "F", point: 0.0 },
];

export const FEE_HEADS = [
    { code: "admission", name: "Admission Fee", type: "ONE_TIME", order: 1 },
    { code: "session", name: "Session Fee", type: "ONE_TIME", order: 2 },
    { code: "tuition", name: "Monthly Tuition", type: "MONTHLY", order: 3 },
    { code: "exam", name: "Exam Fee", type: "ONE_TIME", order: 4 },
];

// TODO(school): confirm period timings.
export const PERIODS = [
    { number: 1, startTime: "08:00", endTime: "08:40" },
    { number: 2, startTime: "08:40", endTime: "09:20" },
    { number: 3, startTime: "09:20", endTime: "10:00" },
    { number: 4, startTime: "10:20", endTime: "11:00" },
    { number: 5, startTime: "11:00", endTime: "11:40" },
    { number: 6, startTime: "11:40", endTime: "12:20" },
];

export const SMS_TEMPLATES = [
    { code: "absent", name: "Absent alert", type: "ABSENT", body: "Dear guardian, {student_name} (Roll {roll}, {class}) was absent today, {date}. - Little Flower School" },
    { code: "fee_due", name: "Fee due reminder", type: "FEE_DUE", body: "Dear guardian, {student_name}'s fees of Tk {due_amount} are due. Please pay by {due_date}. - Little Flower School" },
    { code: "result", name: "Result published", type: "RESULT", body: "{student_name}'s {exam} result is published. GPA {gpa}. Login: portal. - Little Flower School" },
    { code: "holiday_bn", name: "Holiday notice (Bangla)", type: "CUSTOM", body: "প্রিয় অভিভাবক, আগামীকাল স্কুল বন্ধ থাকবে। - লিটল ফ্লাওয়ার স্কুল" },
];

/** Setting rows (key → value json). */
export const SETTINGS = {
    "school.profile": {
        name: "Little Flower International English Medium School",
        shortName: "Little Flower",
        eiin: "", // the school uses an EMIS code (web config/school.js registration)
        established: 2000,
        contact: {
            phone: "+880 1674-009118",
            whatsapp: "+880 1674-009118",
            email: "littleflower48@yahoo.com",
            addressLines: ["87 East Kazipara, Itkhola Bazar", "Kafrul, Mirpur, Dhaka 1216, Bangladesh"],
            addressShort: "87 East Kazipara, Kafrul, Dhaka 1216",
            geo: { lat: 23.7977, lng: 90.3755 },
            officeHours: "",
        },
        social: {
            facebook: "https://www.facebook.com/LittleFlowerInternationalEnglishMediumSchool",
            youtube: "",
        },
    },
    "modules.enabled": ["cms", "students", "results", "attendance", "routine", "cards", "fees", "sms", "portal"],
    "ids.studentUidPrefix": "LFIS-",
    "fees.receiptPrefix": "LFIS",
    "attendance.weeklyOff": ["FRI", "SAT"], // TODO(school): confirm weekly holidays
    "attendance.smsCutoff": "10:30",
    /** Position tie break after total: "roll" or "name" */
    "results.tieBreak": "roll",
    /** Skip admit cards for students with dues above this (taka). null = off */
    "cards.admitDueLimit": null,
};
