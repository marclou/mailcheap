import { handleGroundmailRequest } from "@/lib/groundmail-webhook";

// Deliveries, bounces, complaints and failures of every email MailCheap sends through Groundmail.
export function POST(request) {
	return handleGroundmailRequest(request);
}
