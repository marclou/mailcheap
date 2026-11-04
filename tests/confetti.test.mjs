import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { showConfetti } from "../lib/confetti.js";
import { bursts } from "./stubs/canvas-confetti.mjs";

// The confetti as an issue goes out (lib/confetti.js): canvas-confetti draws it in the browser, and its stub keeps
// each burst here.
const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("confetti", () => {
	test("one pop in hex colors, the only ones canvas-confetti reads, that shows nothing to those who reduce motion", async () => {
		await showConfetti();
		assert.ok(bursts.length > 0);
		for (const burst of bursts) {
			assert.equal(burst.disableForReducedMotion, true);
			assert.ok(burst.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)), burst.colors.join());
		}
	});

	test("canvas-confetti loads the first time it's needed, never with the page", async () => {
		const importers = [];
		for (const folder of ["app", "components", "lib"]) {
			for (const file of await readdir(join(ROOT, folder), { recursive: true })) {
				if (!/\.jsx?$/.test(file)) continue;
				if (/from "canvas-confetti"/.test(await readFile(join(ROOT, folder, file), "utf8"))) importers.push(`${folder}/${file}`);
			}
		}
		assert.deepEqual(importers, []);
	});
});
