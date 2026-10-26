# Step 1: AWS SNS Setup and Configuration

This guide details how to configure Amazon Simple Notification Service (AWS SNS) for SMS messaging in MailCheap, along with credential resolution, IAM policies, and instance configuration checks.

---

## 1. Environment Variables and Fallback Strategy

MailCheap uses AWS SES for email delivery using the following environment variables:
- `SES_ACCESS_KEY_ID`
- `SES_SECRET_ACCESS_KEY`
- `SES_REGION`

To maintain backward compatibility and avoid requiring self-hosters to duplicate credentials if their AWS account has SNS permissions, MailCheap adopts an automatic fallback hierarchy:

```
SNS_ACCESS_KEY_ID      --> fallback to SES_ACCESS_KEY_ID
SNS_SECRET_ACCESS_KEY  --> fallback to SES_SECRET_ACCESS_KEY
SNS_REGION             --> fallback to SES_REGION (defaults to "us-east-1")
```

Optional specific SMS configuration:
- `SNS_SENDER_ID`: Optional alphanumeric sender ID (up to 11 characters, supported in countries where carrier registration is not mandatory, e.g. UK, EU).
- `SNS_SMS_TYPE`: Default message type: `"Transactional"` (higher priority, default) or `"Promotional"` (lower cost in certain regions).

---

## 2. Configuration Helper Updates (`lib/config.js`)

In `mailcheap/lib/config.js`, export helper functions to inspect SMS capabilities without throwing errors if SMS is unconfigured:

```javascript
// lib/config.js additions

export function getSmsRegion(env = process.env) {
	return env.SNS_REGION || env.SES_REGION || "us-east-1";
}

export function getSmsCredentials(env = process.env) {
	const accessKeyId = env.SNS_ACCESS_KEY_ID || env.SES_ACCESS_KEY_ID;
	const secretAccessKey = env.SNS_SECRET_ACCESS_KEY || env.SES_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) return null;
	return { accessKeyId, secretAccessKey };
}

// Whether the server has credentials to send SMS messages.
// If false, the dashboard gracefully disables SMS campaign creation.
export function isSmsConfigured(env = process.env) {
	return Boolean(getSmsCredentials(env));
}

export function getSmsDefaultSenderId(env = process.env) {
	return env.SNS_SENDER_ID || null;
}
```

---

## 3. AWS IAM Policy

The AWS IAM user or role used by MailCheap requires the following minimal IAM policy to send SMS messages via Amazon SNS:

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "MailcheapSnsSmsSend",
			"Effect": "Allow",
			"Action": [
				"sns:Publish",
				"sns:SetSMSAttributes",
				"sns:GetSMSAttributes"
			],
			"Resource": "*"
		}
	]
}
```

---

## 4. AWS Telecom Specifics & Operational Rules

### A. AWS SMS Sandbox vs Production
By default, new AWS accounts are placed in the **SMS Sandbox**. In sandbox mode:
- SMS can only be sent to verified phone numbers in the AWS SNS console.
- Maximum spend limit is set to $1.00 USD per month.
- To send to any recipient, accounts must request an **AWS SMS spending limit increase** and **Production access** in the AWS SNS console (under Text messaging (SMS) > Account settings).

### B. Message Types (Transactional vs Promotional)
Amazon SNS provides two categories:
- **Transactional**: Critical messages such as one-time passwords, verification codes, and time-sensitive operational alerts. AWS prioritizes delivery over cost.
- **Promotional**: Marketing and general news. AWS uses cost-optimized routes; delivery might experience slight delays during peak telecom traffic.

In MailCheap, standard newsletter campaigns default to `"Promotional"`, while confirmation codes or urgent alerts use `"Transactional"`.

### C. Alphanumeric Sender IDs and Origination Numbers
- In countries supporting alphanumeric sender IDs (e.g., France, UK, Germany), messages display a brand name (such as `MailCheap` or the newsletter name, max 11 alphanumeric characters).
- In the United States and Canada, carrier regulations (A2P 10DLC) prohibit generic alphanumeric sender IDs. Senders must register a 10DLC brand and campaign or use a toll-free number registered with AWS Pinpoint / SNS.
