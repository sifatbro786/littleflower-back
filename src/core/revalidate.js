import { logger } from "#core/logger.js";
import { enqueue, QUEUES } from "#core/queue.js";

/**
 * Tells the Next app to drop cached public pages (revalidateTag) after a CMS save, so the website
 * updates within seconds. Goes through the queue so a Next restart does not lose the signal.
 * Tags match littleflower-front lib/data cacheTag(): pages, page:<section>:<slug>, news, news:<slug>,
 * gallery, album:<slug>, notices, notice:<slug>, staff, downloads, classes.
 * @param {string[]} tags
 */
export async function revalidateWeb(tags) {
    const unique = [...new Set(tags.filter(Boolean))];
    if (!unique.length) return;
    try {
        await enqueue(QUEUES.SYSTEM, "web.revalidate", { tags: unique }, { attempts: 5, backoff: { type: "exponential", delay: 2_000 } });
    } catch (err) {
        logger.error({ err: err.message, tags: unique }, "could not queue revalidate (site updates when the cache expires)");
    }
}
