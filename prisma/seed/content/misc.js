// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
import { img } from "./media.js";

/**
 * Teachers & staff. Live mode: Staff where showOnWebsite = true, ordered.
 * TODO(school): teacher list with name, designation, qualification and photo.
 * Left empty on purpose: the site shows a friendly empty state instead of invented people.
 * @type {import("@/lib/data/types").Staff[]}
 */
export const staff = [];

/**
 * Facilities. Only what the school states on its posters plus what the photos show.
 * @type {import("@/lib/data/types").Facility[]}
 */
export const facilities = [
    {
        id: "f-ac",
        title: "AC classrooms",
        text: "Air-conditioned classrooms keep children fresh and focused through Dhaka's hottest months.",
        image: img.classroomDesks,
        tone: "sky",
    },
    {
        id: "f-cctv",
        title: "CCTV and a safe campus",
        text: "The campus is watched by CCTV cameras, and children stay safe and supervised for the whole school day.",
        image: img.classWriting,
        tone: "brand",
    },
    {
        id: "f-building",
        title: "Our own building",
        text: "Little Flower runs in its own building in East Kazipara, with a rooftop used for assemblies, games and programmes.",
        image: img.rooftopGathering,
        tone: "sun",
    },
    {
        id: "f-hifz",
        title: "Free Hifzul Quran",
        text: "Hifzul Quran is taught free of charge, and Zuhr and Asr prayers are held in jamaat on campus.",
        image: img.girlWriting,
        tone: "coral",
    },
    {
        id: "f-screen",
        title: "Screen-supported lessons",
        text: "Classrooms use a screen for videos and visual lessons, so ideas are easier to see and remember.",
        image: img.smartClass,
        tone: "sky",
    },
    {
        id: "f-art",
        title: "Art, craft and colour days",
        text: "Drawing classes, art competitions and colour days give every child a chance to create and celebrate.",
        image: img.artShowcase,
        tone: "coral",
    },
];

/**
 * Student corner downloads (routines, syllabus, exam schedules). Live mode: published files from the admin panel.
 * TODO(school): class routines, syllabus PDFs and exam schedule.
 * @type {import("@/lib/data/types").Download[]}
 */
export const downloads = [];
