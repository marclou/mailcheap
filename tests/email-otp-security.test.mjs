import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins";

test("OTP preflight compares one guess while concurrent checks are waiting", { timeout: 5000 }, async () => {
	const email = "otp-race@example.com";
	const wrongCode = "000000";
	let code;
	let raceActive = false;
	let comparisons = 0;
	let rejected = 0;
	let releaseHash;
	let arrivalsComplete;
	const hashGate = new Promise((resolve) => (releaseHash = resolve));
	const arrivals = new Promise((resolve) => (arrivalsComplete = resolve));
	const arrived = () => {
		if (comparisons + rejected === 8) arrivalsComplete();
	};
	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: "test-secret-for-otp-race-0123456789abcdef",
		telemetry: { enabled: false },
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		plugins: [
			emailOTP({
				generateOTP: () => "123456",
				sendVerificationOTP: async ({ otp }) => (code = otp),
				storeOTP: {
					hash: async (otp) => {
						if (raceActive && otp === wrongCode) {
							comparisons++;
							arrived();
							await hashGate;
						}
						return createHash("sha256").update(otp).digest("base64url");
					},
				},
			}),
		],
	});
	const sendCode = () => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
	const checkCode = (otp) => auth.api.checkVerificationOTP({ body: { email, type: "sign-in", otp } });
	await sendCode();
	await auth.api.signInEmailOTP({ body: { email, otp: code } });
	await sendCode();
	raceActive = true;
	const checks = Array.from({ length: 8 }, () =>
		checkCode(wrongCode).then(
			() => ({ accepted: true }),
			(error) => {
				rejected++;
				arrived();
				return { error };
			}
		)
	);
	let concurrentComparisons;
	try {
		await arrivals;
		concurrentComparisons = comparisons;
	} finally {
		releaseHash();
	}
	const results = await Promise.all(checks);
	raceActive = false;
	assert.equal(concurrentComparisons, 1);
	for (const result of results) assert.equal(result.error?.body?.code, "INVALID_OTP");
	await assert.rejects(checkCode(wrongCode), (error) => error.body?.code === "INVALID_OTP");
	await assert.rejects(checkCode(wrongCode), (error) => error.body?.code === "INVALID_OTP");
	await assert.rejects(checkCode(code), (error) => error.body?.code === "TOO_MANY_ATTEMPTS");
});
