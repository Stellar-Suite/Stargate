import child_process from "child_process";

import logger from "./logger.js";

/**
 *
 * @export
 * @return {Promise<number>} 
 */
export async function execAsync(...args) {
    return new Promise((resolve, reject) => {
        let proc = child_process.spawn(...args);
        // good logging
        logger.info("Calling " + args[0] + " " + args[1].join(" "));
        proc.stdout.pipe(process.stdout);
        proc.stderr.pipe(process.stderr);
        process.stdin.pipe(proc.stdin);
        proc.on("exit", resolve);
    });
}