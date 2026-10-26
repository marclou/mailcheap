import "server-only";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { getSmsCredentials, getSmsRegion, getSmsSenderId, isSendingEnabled } from "@/lib/config";

// Every direct call to AWS SNS SMS lives in this file, so tests replace it whole (tests/stubs/sms.mjs).
const READ_TIMEOUT_MS = 5000;
let client;

function getClient() {
	const credentials = getSmsCredentials();
	if (!credentials) throw new Error("AWS SNS is not configured (missing credentials)");
	client ??= new SNSClient({
		region: getSmsRegion(),
		credentials,
	});
	return client;
}

// Dispatches an SMS message through AWS SNS.
export async function sendSms({ phoneNumber, message, senderId, messageType = "Promotional" }) {
	if (!isSendingEnabled()) {
		return { messageId: `mock-sms-${Date.now()}` };
	}

	const targetSenderId = senderId || getSmsSenderId();
	const attributes = {
		"AWS.SNS.SMS.SMSType": {
			DataType: "String",
			StringValue: messageType,
		},
	};

	if (targetSenderId) {
		attributes["AWS.SNS.SMS.SenderID"] = {
			DataType: "String",
			StringValue: targetSenderId,
		};
	}

	const command = new PublishCommand({
		PhoneNumber: phoneNumber,
		Message: message,
		MessageAttributes: attributes,
	});

	const response = await getClient().send(command, {
		abortSignal: AbortSignal.timeout(READ_TIMEOUT_MS),
	});

	return { messageId: response.MessageId };
}
