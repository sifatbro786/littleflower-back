// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
/**
 * Static notices (demo mode and seed source). Live mode: Notice model (category, pinned, PDF, scheduled publishedAt).
 * SAMPLE: placeholders for the demo. Replace with real notices from the office before launch.
 * @type {import("@/lib/data/types").Notice[]}
 */
export const notices = [
    {
        id: "n-2027-admission",
        slug: "admission-open-2027-play-group-to-ssc",
        title: "Admission open 2027: Play Group to SSC",
        category: "admission",
        publishedAt: "2026-11-01T09:00:00+06:00",
        pinned: true,
        excerpt: "English Medium, English Version and Bangla Medium. Call 01674-009118 or visit the campus.",
        bodyHtml:
            "<p>Admission for the 2027 session is open from Play Group to SSC in English Medium, English Version and Bangla Medium. Seats are limited in every class.</p><p>Guardians can collect the admission form from the school office at 87 East Kazipara, Kafrul, or call <strong>01674-009118</strong>, <strong>01911-250256</strong> or <strong>01711-038213</strong> for details.</p>",
    },
    {
        id: "n-2026-hifz",
        slug: "free-hifzul-quran-classes",
        title: "Free Hifzul Quran classes for students",
        category: "general",
        publishedAt: "2026-10-15T09:00:00+06:00",
        pinned: false,
        excerpt: "Hifzul Quran is taught free of charge alongside the regular curriculum.",
        bodyHtml:
            "<p>Little Flower offers Hifzul Quran classes free of charge for interested students, alongside their regular class work. Please contact the office to enrol your child.</p>",
    },
    {
        id: "n-2026-uniform",
        slug: "school-uniform-reminder",
        title: "Reminder: full school uniform every day",
        category: "general",
        publishedAt: "2026-10-05T09:00:00+06:00",
        pinned: false,
        excerpt: "Students must come in the full school uniform with the ID card.",
        bodyHtml:
            "<p>Dear guardians, please make sure your child comes to school in the full Little Flower uniform with the school ID card every day. Contact the office for uniform details.</p>",
    },
];

export const noticeCategories = [
    { value: "all", label: "All" },
    { value: "admission", label: "Admission" },
    { value: "exam", label: "Exam" },
    { value: "holiday", label: "Holiday" },
    { value: "event", label: "Event" },
    { value: "general", label: "General" },
];
