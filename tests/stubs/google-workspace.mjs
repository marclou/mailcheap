// An in-memory Google Workspace mailbox: emails are kept here instead of going to Gmail's SMTP server, and the bounces
// a test puts in the inbox are what its IMAP server answers with.
export const sent = [];
export const platformSent = [];
// Each { uid, receivedAt, source }, uid going up as they arrive.
export const inbox = [];
export const state = { failNext: null, inboxError: null, uidValidity: "1" };

function failIfAsked() {
	const error = state.failNext;
	state.failNext = null;
	if (error) throw error;
}

export async function sendWorkspaceEmail(email) {
	if (process.env.SENDING_ENABLED !== "true") throw new Error("Sending is off (SENDING_ENABLED is not true)");
	failIfAsked();
	sent.push(email);
	return { messageId: `<workspace-${sent.length}@example.com>` };
}

export async function sendWorkspacePlatformEmail(email) {
	failIfAsked();
	platformSent.push(email);
	return { messageId: `<workspace-platform-${platformSent.length}@example.com>` };
}

export async function readWorkspaceBounces({ since, afterUid = 0, uidValidity = null, limit }) {
	if (state.inboxError) throw state.inboxError;
	const isSameFolder = uidValidity === state.uidValidity && afterUid > 0;
	const emails = inbox.filter(({ uid, receivedAt }) => (isSameFolder ? uid > afterUid : receivedAt >= since)).slice(0, limit);
	return { uidValidity: state.uidValidity, emails };
}
