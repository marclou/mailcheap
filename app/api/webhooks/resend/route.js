import { handleResendRequest } from "@/lib/resend-webhook";

// Deliveries, bounces, complaints, suppressions and failures from the Resend team every account sends through.
export function POST(request) {
	return handleResendRequest(request);
}
