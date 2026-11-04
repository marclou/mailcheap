import assert from "node:assert/strict";
import { test } from "node:test";

const { refreshEvery } = await import("../components/RefreshPage.jsx");

const EVERY_MS = 30_000;

function stubGlobal(t, name, value) {
	const before = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
	t.after(() => (before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]));
}

// The page's tab, visible and online at first, with the events the browser sends as that changes.
function openTab(t) {
	const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
	const browser = new EventTarget();
	const connection = { onLine: true };
	stubGlobal(t, "document", page);
	stubGlobal(t, "window", browser);
	stubGlobal(t, "navigator", connection);
	return {
		show(visibilityState) {
			page.visibilityState = visibilityState;
			page.dispatchEvent(new Event("visibilitychange"));
		},
		connect(onLine) {
			connection.onLine = onLine;
			if (onLine) browser.dispatchEvent(new Event("online"));
		},
	};
}

test("a page takes its numbers again on time while its tab is visible, and the one due while it wasn't as it comes back", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const tab = openTab(t);
	let refreshes = 0;
	const stop = refreshEvery(EVERY_MS, () => refreshes++);

	t.mock.timers.tick(EVERY_MS - 1);
	assert.equal(refreshes, 0);
	t.mock.timers.tick(1);
	assert.equal(refreshes, 1);
	t.mock.timers.tick(EVERY_MS);
	assert.equal(refreshes, 2);

	tab.show("hidden");
	t.mock.timers.tick(5 * EVERY_MS);
	assert.equal(refreshes, 2, "none while the tab is hidden");
	tab.show("visible");
	assert.equal(refreshes, 3, "one as it comes back, for all it missed");
	t.mock.timers.tick(EVERY_MS - 1);
	assert.equal(refreshes, 3, "the next one counts from it");
	t.mock.timers.tick(1);
	assert.equal(refreshes, 4);

	tab.show("hidden");
	t.mock.timers.tick(EVERY_MS / 2);
	tab.show("visible");
	assert.equal(refreshes, 4, "a quick look at another tab changes nothing");
	t.mock.timers.tick(EVERY_MS / 2);
	assert.equal(refreshes, 5);

	stop();
	t.mock.timers.tick(5 * EVERY_MS);
	tab.show("hidden");
	tab.show("visible");
	assert.equal(refreshes, 5, "nothing once the page stops it");
});

test("offline, where a refresh would load the whole page again, none goes: the one due goes as the connection comes back", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const tab = openTab(t);
	let refreshes = 0;
	const stop = refreshEvery(EVERY_MS, () => refreshes++);

	tab.connect(false);
	t.mock.timers.tick(3 * EVERY_MS);
	assert.equal(refreshes, 0);
	tab.connect(true);
	assert.equal(refreshes, 1);
	t.mock.timers.tick(EVERY_MS);
	assert.equal(refreshes, 2);
	stop();
});
