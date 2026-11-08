// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
import { img, video } from "./media.js";

/**
 * Static gallery (demo mode and seed source). Live mode: GalleryAlbum + GalleryImage from the admin panel.
 * TODO(school): confirm event names and dates (dates below are approximate).
 * @type {import("@/lib/data/types").GalleryAlbum[]}
 */
export const albums = [
    {
        id: "a-prize-giving",
        slug: "prize-giving-ceremony",
        title: "Prize giving ceremony",
        description: "Honouring our SSC achievers and best students.",
        date: "2026-03-10",
        cover: img.prizeGiving,
        images: [img.prizeGiving, img.rooftopGathering],
    },
    {
        id: "a-art",
        slug: "art-and-craft",
        title: "Art & craft",
        description: "Drawing classes, art competitions and paper craft.",
        date: "2026-08-20",
        cover: img.artShowcase,
        images: [img.artShowcase, img.artCompetition, img.drawingTable, img.drawingBoys, img.drawingCloseup, img.craftFish],
    },
    {
        id: "a-colour-days",
        slug: "colour-days-and-celebrations",
        title: "Colour days & celebrations",
        description: "Green Colour Day, Red Day and birthdays in class.",
        date: "2026-07-15",
        cover: img.greenColourDay,
        images: [img.greenColourDay, img.redDay, img.birthday],
    },
    {
        id: "a-sports",
        slug: "rooftop-football",
        title: "Football on the rooftop",
        description: "Friendly matches in our favourite team jerseys.",
        date: "2026-06-20",
        cover: img.footballTeams,
        images: [img.footballTeams, img.rooftopFootball, img.rooftopGathering],
    },
    {
        id: "a-classroom",
        slug: "classroom-life",
        title: "Classroom life",
        description: "Writing, screens, charts and everyday learning.",
        date: "2026-05-05",
        cover: img.classWriting,
        images: [img.classWriting, img.girlWriting, img.smartClass, img.classroomDesks],
    },
    {
        id: "a-teachers",
        slug: "our-teachers",
        title: "Our teachers",
        description: "The people who make Little Flower a second home.",
        date: "2026-04-15",
        cover: img.teachersTogether,
        images: [img.teachersTogether, img.teachersDayOut],
    },
];

/** @type {import("@/lib/data/types").VideoItem[]} */
export const videos = [
    { id: "v-campus", title: "A walk to our campus", kind: "file", ...video.campusTour, orientation: "landscape" },
    { id: "v-admission", title: "Admission is open", kind: "file", ...video.admissionPromo, orientation: "landscape" },
];
