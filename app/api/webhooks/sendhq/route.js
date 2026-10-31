import { handleSendhqRequest } from "@/lib/sendhq-webhook";

// Deliveries, bounces, complaints and failures from the SendHQ workspace every account sends through.
export function POST(request) {
	return handleSendhqRequest(request);
}
