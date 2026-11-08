import { Prisma } from "@prisma/client";

import { env } from "#config/env.js";
import { hashPassword } from "#core/auth.js";
import { toDbDate } from "#core/dates.js";
import { DEFAULT_ROLES } from "#core/rbac.js";

import { classes as contentClasses } from "./content/classes.js";
import { FEE_HEADS, GRADE_SCALE, PERIODS, SECTIONS, SESSION, SETTINGS, SMS_TEMPLATES, SUBJECTS } from "./data/school.js";

/**
 * Bootstrap seed: roles, Super Admin, session, classes, sections, subjects, grade scale, fee heads,
 * periods, SMS templates, settings. Idempotent and create-if-missing (upsert with update: {}),
 * safe to run in production at launch and again later.
 * @param {import("@prisma/client").PrismaClient} prisma
 */
export async function seedBootstrap(prisma) {
    const keep = { update: {} };

    for (const r of DEFAULT_ROLES) {
        await prisma.role.upsert({ where: { key: r.key }, create: { ...r, isSystem: true }, ...keep });
    }

    if (env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD) {
        const email = env.SUPERADMIN_EMAIL.toLowerCase();
        const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (!exists) {
            const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
            await prisma.user.create({
                data: { name: "Super Admin", email, passwordHash: await hashPassword(env.SUPERADMIN_PASSWORD), roleId: role.id },
            });
            console.log(`  super admin created: ${email}`);
        }
    } else {
        console.warn("  SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set: super admin skipped");
    }

    // Only one session can be current (isCurrent true|null + unique). Mark this one current only if none is.
    const current = await prisma.academicSession.findUnique({ where: { isCurrent: true }, select: { id: true } });
    const session = await prisma.academicSession.upsert({
        where: { name: SESSION.name },
        create: { name: SESSION.name, startDate: toDbDate(SESSION.startDate), endDate: toDbDate(SESSION.endDate), isCurrent: current ? null : true },
        ...keep,
    });

    for (const c of contentClasses) {
        const stage = c.stage.toUpperCase();
        const cls = await prisma.class.upsert({
            where: { slug: c.slug },
            create: {
                slug: c.slug,
                name: c.name,
                order: c.order,
                stage,
                gradingMode: c.gradingMode,
                ageHint: c.ageHint,
                tone: c.tone.toUpperCase(),
                summary: c.summary,
                focus: c.focus,
            },
            ...keep,
        });
        for (const name of SECTIONS) {
            await prisma.section.upsert({ where: { classId_name: { classId: cls.id, name } }, create: { classId: cls.id, name }, ...keep });
        }
        for (const [i, name] of SUBJECTS[stage].entries()) {
            await prisma.subject.upsert({
                where: { classId_name: { classId: cls.id, name } },
                create: { classId: cls.id, name, order: i + 1 },
                ...keep,
            });
        }
    }

    for (const g of GRADE_SCALE) await prisma.gradeScale.upsert({ where: { grade: g.grade }, create: g, ...keep });
    for (const f of FEE_HEADS) await prisma.feeHead.upsert({ where: { code: f.code }, create: f, ...keep });
    for (const p of PERIODS) await prisma.period.upsert({ where: { number: p.number }, create: p, ...keep });
    for (const t of SMS_TEMPLATES) await prisma.smsTemplate.upsert({ where: { code: t.code }, create: t, ...keep });
    for (const [key, value] of Object.entries(SETTINGS)) {
        await prisma.setting.upsert({ where: { key }, create: { key, value: value ?? Prisma.JsonNull }, ...keep });
    }

    console.log(`  bootstrap ok (session ${session.name}${session.isCurrent ? ", current" : ""})`);
}
