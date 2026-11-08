// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
import { img } from "./media.js";

/**
 * Static news & events (demo mode and seed source), built from real school photos.
 * TODO(school): confirm event names and dates (dates below are approximate).
 * @type {import("@/lib/data/types").NewsPost[]}
 */
export const news = [
    {
        id: "e-prize-giving",
        slug: "prize-giving-ceremony",
        title: "Prize giving ceremony for our SSC achievers",
        excerpt: "Guests, teachers and guardians came together to honour students for their results and hard work.",
        publishedAt: "2026-03-10T12:00:00+06:00",
        cover: img.prizeGiving,
        images: [img.prizeGiving, img.rooftopGathering],
        albumSlug: "prize-giving-ceremony",
        bodyHtml: `
<p>Little Flower held its prize giving ceremony to honour students for their SSC results, scholarships and good conduct. Guests and guardians handed out prizes on the school rooftop, decorated for the day.</p>
<p>Results like these come from years of steady work: classwork done in class, regular homework and class tests, and special classes for SSC and scholarship exams. Congratulations to every student, and thank you to the teachers and guardians behind them.</p>`,
    },
    {
        id: "e-green-day",
        slug: "green-colour-day",
        title: "Green Colour Day",
        excerpt: "Leaf crowns, fresh fruits and a lot of green: students learned why plants and healthy food matter.",
        publishedAt: "2026-07-15T12:00:00+06:00",
        cover: img.greenColourDay,
        albumSlug: "colour-days-and-celebrations",
        bodyHtml: `
<p>On Green Colour Day the whole school turned green. Students came in green clothes and paper leaf crowns and set up a table of fresh fruits and vegetables.</p>
<p>Colour days are a favourite at Little Flower. Little ones learn colours, food and nature by seeing, touching and talking about them, not just by reading.</p>`,
    },
    {
        id: "e-art",
        slug: "art-competition-on-the-rooftop",
        title: "Art competition on the rooftop",
        excerpt: "Students from every class spread out on the rooftop with paper and colours for the annual art competition.",
        publishedAt: "2026-08-20T12:00:00+06:00",
        cover: img.artCompetition,
        albumSlug: "art-and-craft",
        bodyHtml: `<p>The rooftop became one big drawing class for the art competition. Students from the youngest classes to the seniors drew, coloured and proudly showed their work to guardians and teachers.</p>`,
    },
    {
        id: "e-football",
        slug: "football-match-on-the-rooftop",
        title: "Football fever on the rooftop",
        excerpt: "In their favourite team jerseys, students played a friendly match cheered on by the whole school.",
        publishedAt: "2026-06-20T12:00:00+06:00",
        cover: img.footballTeams,
        albumSlug: "rooftop-football",
        bodyHtml: `<p>Students came in their favourite team jerseys for a friendly football match on the school rooftop. Games like this teach teamwork, fair play and how to win and lose with a smile.</p>`,
    },
];
