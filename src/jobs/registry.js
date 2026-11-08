import { QUEUES } from "#core/queue.js";

import { emailProcessors } from "./email.job.js";
import { resultProcessors } from "./result.job.js";
import { smsProcessors } from "./sms.job.js";
import { systemProcessors } from "./system.job.js";

/**
 * queue → { jobName → processor } and per-queue concurrency.
 * Steps 2–4 fill in: email (contact, reset, receipt), sms (absent, due, result, custom),
 * pdf (marksheet, tabulation, admit/ID cards, receipt), result (calculate, publish).
 * PDF runs at concurrency 1: Chromium is the heaviest thing on a 1 vCPU / 3.8 GB VPS.
 */
export const WORKERS = {
    [QUEUES.SYSTEM]: { concurrency: 1, processors: systemProcessors },
    [QUEUES.EMAIL]: { concurrency: 3, processors: emailProcessors },
    [QUEUES.SMS]: { concurrency: 3, processors: smsProcessors },
    [QUEUES.PDF]: { concurrency: 1, processors: {} },
    [QUEUES.RESULT]: { concurrency: 1, processors: resultProcessors },
};
