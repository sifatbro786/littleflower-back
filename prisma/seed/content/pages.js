// Copied from littleflower-front/content (static content). Seed source only; edit content in the admin panel after launch.
import { img } from "./media.js";

/**
 * Static pages (demo mode and seed source). Live mode: Page model, edited in /admin with a limited rich-text toolbar.
 * Copy marked DRAFT was written by STR from the school's posters and Facebook page and must be approved by the school.
 * @type {import("@/lib/data/types").Page[]}
 */
export const pages = [
    /* ------------------------------ ABOUT ------------------------------ */
    {
        section: "about",
        slug: "introduction",
        title: "Introduction",
        summary: "A school in Kafrul, Mirpur teaching children from Play Group to SSC since 2000.",
        cover: img.rooftopGathering,
        updatedAt: "2026-11-08",
        // DRAFT
        bodyHtml: `
<p><strong>Little Flower International English Medium School</strong> has been teaching the children of Kafrul and Mirpur since <strong>2000</strong>. From Play Group to SSC, families can choose <strong>English Medium</strong> (Cambridge curriculum), <strong>English Version</strong> or <strong>Bangla Medium</strong>, all under one roof in our own building at East Kazipara.</p>
<p>Our crest carries the prayer <em>Rabbe Jidni Elma</em>, "My Lord, increase me in knowledge", and our motto is simple: <strong>come to learn, go to serve</strong>. We want children who do well in exams and who also grow up honest, disciplined and kind.</p>
<h3>What every Little Flower student gets</h3>
<ul>
<li>Play Group to SSC in English Medium, English Version or Bangla Medium</li>
<li>Air-conditioned classrooms and CCTV across the campus</li>
<li>Free Hifzul Quran, with Zuhr and Asr prayers in jamaat on campus</li>
<li>Classwork taught and finished in class, regular homework and class tests</li>
<li>Special classes for SSC and scholarship exams, and extra care for weaker students</li>
<li>Art, sports and colour days throughout the year</li>
</ul>
<p>Little Flower is a government approved school. EMIS code: <strong>310071577</strong>.</p>`,
    },
    {
        section: "about",
        slug: "our-story",
        title: "Our Story",
        summary: "Founded in 2000 in East Kazipara, Little Flower has grown from a small school into a Play Group to SSC campus.",
        cover: img.prizeGiving,
        updatedAt: "2026-11-08",
        // DRAFT: expand with the founding story from the school.
        bodyHtml: `
<p>Little Flower started in <strong>2000</strong> with a small group of children and a clear promise to parents: steady teaching, good manners and a safe place to grow. Over the years the school moved into its own building in East Kazipara, Kafrul, and grew all the way to SSC.</p>
<p>The results have followed. By the school's own record, Little Flower students have had a <strong>100% SSC pass rate for 18 years</strong>, with <strong>201 A+</strong> results and <strong>531 scholarships</strong>, and the school was recognised as a <strong>best school in 2009 and 2018</strong>.</p>
<p>What has not changed is the feeling of a family school. Teachers know every child by name, birthdays are celebrated in class and guardians are always welcome to talk to the teachers.</p>`,
    },
    {
        section: "about",
        slug: "chairman-message",
        title: "Message from the Chairman",
        summary: "A few words from the founder and chairman of Little Flower.",
        updatedAt: "2026-11-08",
        // TODO(school): the chairman's written message, name and portrait photo.
        bodyHtml: `
<p>Dear guardians and students,</p>
<p>Since 2000, Little Flower has tried to keep one promise: to teach every child with care, discipline and good values, so that they come to learn and go out to serve their families, their country and their faith.</p>
<p>The full message from our Chairman will be published here soon.</p>`,
    },
    {
        section: "about",
        slug: "vision-mission",
        title: "Vision & Mission",
        summary: "Knowledge, discipline and good character, from the first day of Play Group to the SSC exam.",
        cover: img.artShowcase,
        updatedAt: "2026-11-08",
        // DRAFT: wording to be approved by the school.
        bodyHtml: `
<h3>Our vision</h3>
<p>To raise students who seek knowledge all their lives, live with honesty and discipline, and use what they learn to serve others.</p>
<h3>Our mission</h3>
<ul>
<li>Give every family a choice of English Medium, English Version or Bangla Medium, with the same care in each.</li>
<li>Teach lessons fully in class, check homework regularly and test often, so no child falls behind.</li>
<li>Prepare students for SSC and scholarship exams with special classes and extra help for weaker students.</li>
<li>Build religious understanding and good manners, with free Hifzul Quran and prayers on campus.</li>
<li>Keep the campus clean, safe and watched over, with healthy fun every week.</li>
</ul>`,
    },

    /* ---------------------------- ACADEMICS ---------------------------- */
    {
        section: "academics",
        slug: "classes",
        title: "Our Classes",
        summary: "Thirteen classes in three stages: Early Years, Primary and Secondary up to SSC.",
        cover: img.classWriting,
        updatedAt: "2026-11-08",
        bodyHtml: `<p>Every class runs in three mediums: <strong>English Medium</strong>, <strong>English Version</strong> and <strong>Bangla Medium</strong>. In the Early Years children learn through rhymes, stories and play. From Class I they move to structured subjects, regular class tests and term exams, and from Class IX they follow the SSC course.</p>`,
    },
    {
        section: "academics",
        slug: "curriculum",
        title: "Curriculum & Approach",
        summary: "Cambridge curriculum in English Medium, the national curriculum in English Version and Bangla Medium.",
        cover: img.smartClass,
        updatedAt: "2026-11-08",
        // DRAFT: confirm textbook board / publisher list with the school.
        bodyHtml: `
<h3>Three mediums</h3>
<ul>
<li><strong>English Medium</strong> follows the Cambridge curriculum.</li>
<li><strong>English Version</strong> follows the national curriculum taught in English.</li>
<li><strong>Bangla Medium</strong> follows the national curriculum in Bangla.</li>
</ul>
<h3>Learning happens in class</h3>
<p>Lessons are taught and practised in the classroom, so children do not depend on private tutors. Teachers give regular homework and take class tests to see who needs more help.</p>
<h3>Special classes</h3>
<p>Students preparing for the SSC and scholarship exams get special classes and model tests. Weaker students get extra classes so they can catch up with confidence.</p>
<h3>Faith and character</h3>
<p>Hifzul Quran is taught free of charge, and Zuhr and Asr prayers are held in jamaat on campus. Good manners and discipline are part of every day.</p>`,
    },
    {
        section: "academics",
        slug: "activities",
        title: "Activities",
        summary: "Art, sports, colour days and programmes: learning does not stop at the textbook.",
        cover: img.greenColourDay,
        updatedAt: "2026-11-08",
        bodyHtml: `
<p>Children remember what they make, play and celebrate. That is why the Little Flower calendar is full of activities.</p>
<ul>
<li><strong>Art and craft</strong>: drawing classes, paper craft and an art competition on the rooftop.</li>
<li><strong>Sports</strong>: friendly football matches and games on the school rooftop.</li>
<li><strong>Colour days</strong>: Green Colour Day, Red Day and more for the younger classes.</li>
<li><strong>Celebrations</strong>: birthdays in class, national days and the prize giving ceremony.</li>
</ul>`,
    },
    {
        section: "academics",
        slug: "fees",
        title: "Fees Structure",
        summary: "Admission, session and monthly tuition fees for each class.",
        updatedAt: "2026-11-08",
        // TODO(school): fee heads and amounts per class.
        bodyHtml: `<p>The fee chart for the current session will be published here. For admission and monthly tuition fees, please call the school office and we will be happy to explain everything.</p>`,
    },

    /* ---------------------------- ADMISSION ---------------------------- */
    {
        section: "admission",
        slug: "information",
        title: "Admission Information",
        summary: "Admission is open from Play Group to SSC in three mediums. Here is how to join Little Flower.",
        cover: img.poster2027,
        updatedAt: "2026-11-08",
        // DRAFT: confirm required documents and steps with the office.
        bodyHtml: `
<p>We welcome new families throughout the year, subject to seat availability. Visit the campus at 87 East Kazipara, Itkhola Bazar, Kafrul, meet the teachers and see the classrooms for yourself.</p>`,
    },

    /* ------------------------------ LEGAL ------------------------------ */
    // DRAFT: written by STR to match how this website actually works. Must be approved by the school before launch.
    // This is not legal advice.
    {
        section: "legal",
        slug: "privacy",
        title: "Privacy Policy",
        summary: "What information this website collects, why, and how the school protects it.",
        updatedAt: "2026-11-08",
        bodyHtml: `
<p>Little Flower International English Medium School ("the school", "we") runs this website for parents, students and visitors. We care deeply about the privacy of children and their families. This policy explains what information the website collects and how it is used.</p>

<h3>1. Information we collect</h3>
<ul>
<li><strong>Contact form:</strong> when you send a message we receive your name, mobile number, your email address (if you give it) and your message.</li>
<li><strong>Technical information:</strong> like every website, our server receives your IP address and basic browser information. We use the IP address only to block spam and abuse of our forms.</li>
<li><strong>Portal:</strong> the student and guardian portal shows the school's own records about your child, such as class, results, attendance and fees. Login details are created and given by the school office.</li>
</ul>
<p>We do not ask for any information about children through the public website, and we do not sell, rent or trade personal information.</p>

<h3>2. How we use information</h3>
<ul>
<li>To reply to your message, admission question or request.</li>
<li>To share school notices, results and fee information with the right guardian.</li>
<li>To keep the website and its forms secure.</li>
</ul>

<h3>3. Cookies</h3>
<p>The public website does not use advertising or tracking cookies. The portal uses secure login cookies that are needed to keep you signed in. They are not used for advertising.</p>

<h3>4. Photos and videos of students</h3>
<p>Photos and videos on this website show school activities and are published by the school. If you are a guardian and would like a photo or video of your child removed, contact the office and we will remove it as soon as possible.</p>

<h3>5. Third-party services</h3>
<ul>
<li><strong>Google Maps:</strong> the map on the contact page is provided by Google.</li>
<li><strong>Email and SMS:</strong> messages are sent through email and SMS service providers chosen by the school.</li>
<li><strong>Online payment:</strong> card and mobile banking payments are handled by the payment gateway. The school does not see or store your card or wallet details.</li>
</ul>

<h3>6. How we protect information</h3>
<p>The website runs over a secure HTTPS connection. Access to student records is limited by role, so teachers, office staff and guardians only see what they need. Guardians can only see their own child's information.</p>

<h3>7. How long we keep information</h3>
<p>Messages from the contact form are kept only as long as needed to answer them. Student records are kept by the school as part of its normal academic records.</p>

<h3>8. Your choices</h3>
<p>You can ask the school to show, correct or delete the personal information you have given us through this website. Please contact the office using the details below.</p>

<h3>9. Changes to this policy</h3>
<p>We may update this policy when the website changes. The date at the top of this page shows the latest version.</p>

<h3>10. Contact</h3>
<p>Little Flower International English Medium School, 87 East Kazipara, Itkhola Bazar, Kafrul, Dhaka 1216. Phone: <strong>01674-009118</strong>. Email: <strong>littleflower48@yahoo.com</strong>.</p>`,
    },
    {
        section: "legal",
        slug: "terms",
        title: "Terms of Use",
        summary: "The simple rules for using the Little Flower website, portal and online services.",
        updatedAt: "2026-11-08",
        bodyHtml: `
<p>By using this website you agree to these terms. If you do not agree, please do not use the website.</p>

<h3>1. About this website</h3>
<p>This website is run by Little Flower International English Medium School, Kafrul, Dhaka, to share information about the school with parents, students and visitors.</p>

<h3>2. Accuracy of information</h3>
<p>We try to keep all information correct and up to date. Notices, fees, dates and results on the website are for information. If anything on the website is different from a notice or document issued by the school office, the office copy is final.</p>

<h3>3. Photos, logo and content</h3>
<p>The school name, crest, photos, videos and text on this website belong to the school. Please do not copy, edit or reuse them, and never reuse photos or videos of children, without written permission from the school.</p>

<h3>4. Acceptable use</h3>
<ul>
<li>Do not try to access information that does not belong to you, including another student's records.</li>
<li>Do not send spam, false information or harmful content through our forms.</li>
<li>Do not try to break, overload or disrupt the website.</li>
</ul>

<h3>5. Portal accounts</h3>
<ul>
<li>Login details are given by the school office and are for the student and their guardian only.</li>
<li>Keep your password secret. You are responsible for activity on your account.</li>
<li>If you think someone else knows your password, contact the office so it can be reset.</li>
<li>The school may suspend an account that is misused.</li>
</ul>

<h3>6. Online results</h3>
<p>Results shown online are for quick reference. The signed marksheet issued by the school is the official record.</p>

<h3>7. Online payments</h3>
<p>A payment is complete only when the school receives confirmation from the payment gateway. A receipt is issued for every confirmed payment. For any payment problem, contact the office with your transaction ID. Gateway charges, if any, are set by the payment provider.</p>

<h3>8. Links to other websites</h3>
<p>The website may link to other sites such as Facebook and Google Maps. The school is not responsible for the content or policies of those sites.</p>

<h3>9. Limitation of liability</h3>
<p>The school is not responsible for any loss caused by temporary unavailability of the website or by technical errors, though we will fix problems as quickly as we can.</p>

<h3>10. Governing law</h3>
<p>These terms are governed by the laws of Bangladesh.</p>

<h3>11. Changes and contact</h3>
<p>We may update these terms from time to time. For any question, call <strong>01674-009118</strong> or visit the school office.</p>`,
    },
];

/**
 * Admission steps and documents. TODO(school): confirm. Live mode: part of the admission Page model.
 */
export const admissionSteps = [
    { title: "Call or visit", text: "Call 01674-009118 or walk in to the campus at 87 East Kazipara, Itkhola Bazar, Kafrul." },
    { title: "Choose a medium", text: "Talk to the office about English Medium, English Version or Bangla Medium and see the classrooms." },
    { title: "Admission test", text: "A short test or meeting with your child to find the right class." },
    { title: "Confirm admission", text: "Submit the form with documents and pay the admission fee." },
];

export const admissionDocuments = [
    "Birth registration certificate (copy)",
    "Two passport-size photos of the student",
    "Photos and NID copies of the parents",
    "Previous school report or transfer certificate (Class I and above)",
];
