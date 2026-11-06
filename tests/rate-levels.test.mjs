import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "../lib/config.js";
import { getFirstSendProblem } from "../lib/first-send.js";
import { judgeRates } from "../lib/rate-levels.js";
import { getAccountCheckWindow, getAccountRateProblem, getCampaignRateProblem } from "../lib/sending-rules.js";

const level = (counts) => judgeRates(counts)?.level ?? null;

test("the two levels live in one place", () => {
	assert.deepEqual(LIMITS.pause, { bounceRate: 0.025, minBounces: 5, complaintRate: 0.0008, minComplaints: 2, refusalRate: 0.02, minRefusals: 10 });
	assert.deepEqual(LIMITS.block, { bounceRate: 0.05, minBounces: 10, complaintRate: 0.003, minComplaints: 3 });
});

test("Gmail refusals: 10 at least to pause over 2%, and never a block", () => {
	assert.equal(level({ sent: 100, refused: 9 }), null, "9 refusals, at 9%");
	assert.equal(level({ sent: 400, refused: 10 }), "pause", "10 refusals at 2.5%");
	assert.equal(level({ sent: 500, refused: 10 }), null, "10 refusals at exactly 2%");
	assert.equal(level({ sent: 100, refused: 100 }), "pause", "every email refused still only pauses");
	assert.deepEqual(judgeRates({ sent: 3503, refused: 2140 }), { level: "pause", metric: "refusal", rate: 2140 / 3503, limit: 0.02 });
	assert.equal(level({ sent: 100_000, refused: 50 }), null, "a good list's few refusals");
	assert.deepEqual(judgeRates({ sent: 1000, bounced: 30, refused: 600 }), { level: "pause", metric: "bounce", rate: 0.03, limit: 0.025 }, "bounces first");
	assert.deepEqual(judgeRates({ sent: 1000, bounced: 60, refused: 600 }), { level: "block", metric: "bounce", rate: 0.06, limit: 0.05 }, "a block before any pause");
});

test("complaints: one never counts, two pause over 0.08%, three block over 0.3%", () => {
	assert.equal(level({ sent: 100, complained: 1 }), null, "1 complaint, at 1%");
	assert.equal(level({ sent: 10, complained: 1 }), null, "1 complaint, at 10%");
	assert.equal(level({ sent: 1000, complained: 2 }), "pause", "2 complaints at 0.20%");
	assert.equal(level({ sent: 100, complained: 2 }), "pause", "2 complaints never block, even at 2%");
	assert.equal(level({ sent: 2500, complained: 2 }), null, "exactly 0.08% is under");
	assert.equal(level({ sent: 999, complained: 3 }), "block", "3 complaints just over 0.3%");
	assert.equal(level({ sent: 1000, complained: 3 }), "pause", "3 complaints at exactly 0.3%");
	assert.equal(level({ sent: 1001, complained: 3 }), "pause", "3 complaints just under 0.3%");
	assert.equal(level({ sent: 3750, complained: 3 }), null, "3 complaints at 0.08%");
});

test("hard bounces: 5 at least to pause over 2.5%, 10 at least to block over 5%", () => {
	assert.equal(level({ sent: 100, bounced: 4 }), null, "4 bounces, at 4%");
	assert.equal(level({ sent: 100, bounced: 5 }), "pause", "5 bounces at 5%");
	assert.equal(level({ sent: 200, bounced: 5 }), null, "5 bounces at exactly 2.5%");
	assert.equal(level({ sent: 20, bounced: 9 }), "pause", "9 bounces never block, even at 45%");
	assert.equal(level({ sent: 199, bounced: 10 }), "block", "10 bounces just over 5%");
	assert.equal(level({ sent: 200, bounced: 10 }), "pause", "10 bounces at exactly 5%");
	assert.equal(level({ sent: 0, bounced: 10 }), null);
});

test("each place words its level: a campaign, a first send's slice, the last 7 days", () => {
	assert.deepEqual(getCampaignRateProblem({ sent: 900, bounced: 22 }, { sent: 100, bounced: 4 }), {
		level: "pause",
		metric: "bounce",
		reason:
			"Bounce rate of 2.60% on this campaign (limit 2.50%). Check where these contacts came from before you resume: at 5.00% with 10 bounces, the account is blocked.",
	});
	assert.equal(getCampaignRateProblem({ sent: 900, bounced: 6 }, { sent: 100, bounced: 4 }), null, "last-chance emails count too: 1.00% in all");
	assert.deepEqual(getCampaignRateProblem({ sent: 900, complained: 1 }, { sent: 100, complained: 3 }), {
		level: "block",
		metric: "complaint",
		reason: "Complaint rate of 0.40% on a campaign (limit 0.30%)",
	});
	assert.match(getCampaignRateProblem({ sent: 1000, complained: 2 }).reason, /^Complaint rate of 0.20% on this campaign \(limit 0.08%\)\. Check that these contacts asked/);
	assert.deepEqual(getCampaignRateProblem({ sent: 900, refused: 20 }, { sent: 100, refused: 5 }), {
		level: "pause",
		metric: "refusal",
		reason:
			"Gmail refusal rate of 2.50% on this campaign (limit 2.00%). Gmail refuses emails it reads as unsolicited: check that these contacts asked for your emails before you resume.",
	});

	assert.deepEqual(getFirstSendProblem({ sent: 200, bounced: 6 }), {
		level: "pause",
		metric: "bounce",
		reason: "The first 200 new contacts had a bounce rate of 3.00% (limit 2.50%)",
	});
	assert.deepEqual(getFirstSendProblem({ sent: 200, bounced: 12 }), {
		level: "block",
		metric: "bounce",
		reason: "The first 200 new contacts had a bounce rate of 6.00% (limit 5.00%)",
	});
	assert.equal(getFirstSendProblem({ sent: 200, complained: 1 }), null);
	assert.deepEqual(getFirstSendProblem({ sent: 200, refused: 61 }), {
		level: "pause",
		metric: "refusal",
		reason: "The first 200 new contacts had a Gmail refusal rate of 30.50% (limit 2.00%)",
	});

	assert.deepEqual(getAccountRateProblem({ sent: 600, delivered: 580, bounced: 36 }), {
		level: "block",
		reason: "Bounce rate of 6.00% over the last 7 days (limit 5.00%)",
	});
	assert.match(getAccountRateProblem({ sent: 600, bounced: 16 }).reason, /^Bounce rate of 2.67% over the last 7 days \(limit 2.50%\)\. Nothing is paused/);
	assert.equal(getAccountRateProblem({ sent: 600, bounced: 16 }).level, "pause");
});

test("the account check adds up the last 7 days, or the days since an admin unblocked it", () => {
	const now = new Date("2026-11-02T16:00:00Z");
	const weekAgo = new Date("2026-10-26T16:00:00Z");
	assert.deepEqual(getAccountCheckWindow(now, undefined), { since: weekAgo, where: "over the last 7 days" });
	assert.deepEqual(getAccountCheckWindow(now, new Date("2026-10-20T09:00:00Z")), { since: weekAgo, where: "over the last 7 days" }, "an older unblock");
	const unblockedAt = new Date("2026-11-02T15:27:00Z");
	const window = getAccountCheckWindow(now, unblockedAt);
	assert.deepEqual(window, { since: unblockedAt, where: "since the account was unblocked" });
	assert.equal(getAccountRateProblem({ sent: 120, bounced: 11 }, window.where).reason, "Bounce rate of 9.17% since the account was unblocked (limit 5.00%)");
});
