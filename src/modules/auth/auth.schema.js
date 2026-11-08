import { z } from "zod";

/** Request bodies for /api/auth/*. Same field names as the Next demo handler (LoginForm posts these). */

export const loginSchema = z.object({
    identifier: z.string().trim().min(3, "Enter your email or student ID.").max(120),
    password: z.string().min(1, "Enter your password.").max(200),
    next: z.string().max(200).optional(),
});

export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Enter your current password.").max(200),
        newPassword: z.string().min(8, "Use at least 8 characters.").max(200),
    })
    .refine((v) => v.currentPassword !== v.newPassword, { path: ["newPassword"], message: "Choose a password you have not used just now." });
