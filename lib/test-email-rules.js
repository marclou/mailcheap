import { normalizeEmail } from "./validation.js";

// The addresses one test email goes to at most.
export const MAX_TEST_RECIPIENTS = 5;
// Addresses outside the account's team its tests reach in a day, on Starter: bigger plans multiply it (lib/plans.js
// getSignupScale). A test skips the checks a send goes through, so it can't become a way to email strangers.
export const OUTSIDE_TEST_ADDRESSES_PER_DAY = 20;
// And the tests one of them gets in a day, from every account together.
export const TESTS_PER_OUTSIDE_ADDRESS_PER_DAY = 10;

// The test dialog's To (components/DialogSendTest.jsx): addresses separated by commas, semicolons or spaces, the same
// one once. { emails } or { error }.
export function readTestRecipients(text) {
	const parts = String(text ?? "")
		.split(/[\s,;]+/)
		.filter(Boolean);
	if (parts.length === 0) return { error: "Add the address the test goes to" };
	const invalid = parts.find((part) => !normalizeEmail(part));
	if (invalid) return { error: `${invalid.slice(0, 100)} isn't an email address` };
	const emails = [...new Set(parts.map(normalizeEmail))];
	if (emails.length > MAX_TEST_RECIPIENTS) return { error: `A test goes to ${MAX_TEST_RECIPIENTS} addresses at most` };
	return { emails };
}

// "jane@example.com", "jane@example.com and tom@example.com", or "jane@example.com and 2 others".
export function describeTestRecipients(emails) {
	if (emails.length <= 1) return emails[0] ?? "";
	if (emails.length === 2) return `${emails[0]} and ${emails[1]}`;
	return `${emails[0]} and ${emails.length - 1} others`;
}
