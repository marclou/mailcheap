import { handleResendWebhook } from "@/lib/resend-webhook";

// Resend email events, signed with RESEND_WEBHOOK_SECRET. The sender function serves the same handler.
export function POST(request) {
	return handleResendWebhook(request);
}
