// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
/**
 * Media library (files in /public/images and /public/videos), real Little Flower photos.
 * Live mode: CMS uploads live in /var/www/littleflower/uploads/public and the API returns the same ImageRef shape.
 * @type {Record<string, import("@/lib/data/types").ImageRef>}
 */
export const img = {
    cover: { src: "/images/facebook-cover.jpg", width: 1200, height: 628, alt: "Little Flower International English Medium School banner with students in class" },
    classroomDesks: { src: "/images/classroom-desks.jpg", width: 1800, height: 809, alt: "A bright classroom with colourful chairs and desks ready for the day" },
    smartClass: { src: "/images/smart-class.jpg", width: 1200, height: 1600, alt: "Students watching a lesson on the classroom screen" },
    artShowcase: { src: "/images/art-showcase.jpg", width: 1599, height: 899, alt: "Young students proudly holding up their drawings" },
    drawingBoys: { src: "/images/drawing-boys.jpg", width: 899, height: 1403, alt: "Two boys colouring their drawings at a red table" },
    drawingTable: { src: "/images/drawing-table.jpg", width: 1800, height: 1350, alt: "A teacher guiding students during a drawing class" },
    craftFish: { src: "/images/craft-fish.jpg", width: 1350, height: 1800, alt: "A smiling boy holding up the paper fish he made in craft class" },
    drawingCloseup: { src: "/images/drawing-closeup.jpg", width: 1013, height: 1800, alt: "A student carefully colouring a picture" },
    girlWriting: { src: "/images/girl-writing.jpg", width: 1197, height: 1600, alt: "A girl writing in her copy during class" },
    classWriting: { src: "/images/class-writing.jpg", width: 1800, height: 1350, alt: "Students in school uniform writing in class beside the months chart" },
    rooftopGathering: { src: "/images/rooftop-gathering.jpg", width: 1800, height: 1350, alt: "Students and teachers gathered on the school rooftop for a programme" },
    footballTeams: { src: "/images/football-teams.jpg", width: 1800, height: 1350, alt: "Students lined up in football jerseys before a friendly match" },
    rooftopFootball: { src: "/images/rooftop-football.jpg", width: 1350, height: 1800, alt: "A friendly football match on the school rooftop" },
    quranPrizeDay: { src: "/images/quran-prize-day.jpg", width: 1600, height: 1200, alt: "Students holding the Holy Quran and prizes with their teachers" },
    prizeGiving: { src: "/images/prize-giving.jpg", width: 1600, height: 900, alt: "Guests handing out prizes at the Little Flower prize giving ceremony" },
    artCompetition: { src: "/images/art-competition.jpg", width: 1600, height: 1197, alt: "Students drawing on the rooftop during an art competition" },
    greenColourDay: { src: "/images/green-colour-day.jpg", width: 1600, height: 1200, alt: "Students in green with fruits and leaf crowns on Green Colour Day" },
    teachersDayOut: { src: "/images/teachers-day-out.jpg", width: 1599, height: 1200, alt: "Little Flower teachers smiling together at a school event" },
    teachersTogether: { src: "/images/teachers-together.jpg", width: 1599, height: 1200, alt: "Teachers sitting together in front of a painted landscape mural" },
    birthday: { src: "/images/birthday-celebration.jpg", width: 1280, height: 960, alt: "Students and teachers celebrating a birthday with balloons and cake" },
    redDay: { src: "/images/red-day.jpg", width: 1280, height: 851, alt: "Students and teachers dressed in red for a colour day celebration" },
    posterBn: { src: "/images/admission-poster-bn.jpg", width: 1008, height: 1411, alt: "Bangla admission poster of Little Flower International School" },
    poster2027: { src: "/images/admission-poster-2027.jpg", width: 1254, height: 1254, alt: "Admission Open 2027 poster: Play Group to O Level and SSC, Cambridge curriculum, free Hifzul Quran" },
};

export const video = {
    hero: { src: "/videos/hero.mp4", poster: "/videos/hero-poster.jpg" },
    campusTour: { src: "/videos/campus-tour.mp4", poster: "/videos/campus-tour-poster.jpg" },
    admissionPromo: { src: "/videos/admission-promo.mp4", poster: "/videos/admission-promo-poster.jpg" },
};
