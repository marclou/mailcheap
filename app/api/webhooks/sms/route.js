import { handleSmsEvent } from "@/lib/sms-events";
import { handleSnsRequest } from "@/lib/sns-webhook";

// Inbound two-way SMS replies and carrier delivery reports via AWS SNS.
export async function POST(request) {
	return handleSnsRequest(request, {
		topicArn: process.env.SNS_SMS_TOPIC_ARN || process.env.SES_SNS_TOPIC_ARN,
		label: "sms-webhook",
		handle: handleSmsEvent,
	});
}
