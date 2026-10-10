import crypto from "node:crypto";

// MongoDB ObjectId layout: 4-byte seconds, 5 random bytes per process, 3-byte counter. Ids made in one
// process sort in creation order, which the sender relies on to reach the most engaged readers first.
const PROCESS_BYTES = crypto.randomBytes(5).toString("hex");
let counter = crypto.randomInt(0, 0xffffff);

export function newId(now = Date.now()) {
	counter = (counter + 1) % 0x1000000;
	const seconds = Math.floor(now / 1000).toString(16).padStart(8, "0");
	return `${seconds}${PROCESS_BYTES}${counter.toString(16).padStart(6, "0")}`;
}
