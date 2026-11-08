import { randomInt } from "node:crypto";

// No 0/O, 1/l/I: temp passwords are read out over the phone or written on paper.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Random one-time password for admin-created accounts and resets (user must change it on first sign-in). */
export function tempPassword(length = 10) {
    let s = "";
    for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    return s;
}
