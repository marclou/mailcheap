import assert from "node:assert/strict";
import { test } from "node:test";
import Campaign, { CAMPAIGN_CHANNELS } from "../models/Campaign.js";
import CampaignLink from "../models/CampaignLink.js";
import Contact, { SMS_STATUSES } from "../models/Contact.js";
import Suppression from "../models/Suppression.js";

test("Contact model defaults and SMS status constants", () => {
	assert.deepEqual(SMS_STATUSES, ["none", "active", "unsubscribed", "bounced"]);

	const contact = new Contact({
		newsletterId: "6650f1c2e9b1d4a012345678",
		email: "reader@example.com",
	});

	assert.equal(contact.smsStatus, "none");
	assert.equal(contact.phone, undefined);

	contact.phone = "+33612345678";
	contact.phoneCountry = "FR";
	contact.smsStatus = "active";
	contact.smsConsent = { source: "signup_form", at: new Date() };

	assert.equal(contact.phone, "+33612345678");
	assert.equal(contact.smsStatus, "active");
	assert.equal(contact.phoneCountry, "FR");
});

test("Campaign model defaults and SMS channel constants", () => {
	assert.deepEqual(CAMPAIGN_CHANNELS, ["email", "sms"]);

	const campaign = new Campaign({
		newsletterId: "6650f1c2e9b1d4a012345678",
	});

	assert.equal(campaign.channel, "email");
	assert.equal(campaign.smsText, "");
	assert.equal(campaign.smsSegments, 1);
	assert.equal(campaign.smsEncoding, "GSM-7");

	const smsCampaign = new Campaign({
		newsletterId: "6650f1c2e9b1d4a012345678",
		channel: "sms",
		smsText: "Hello subscriber! Reply STOP to opt out.",
		smsSegments: 1,
		smsEncoding: "GSM-7",
	});

	assert.equal(smsCampaign.channel, "sms");
	assert.equal(smsCampaign.smsText, "Hello subscriber! Reply STOP to opt out.");
});

test("Suppression model supports email and phone targets", () => {
	const emailSuppression = new Suppression({
		email: "bounced@example.com",
		reason: "bounce",
	});
	assert.equal(emailSuppression.targetType, "email");

	const phoneSuppression = new Suppression({
		targetType: "phone",
		phone: "+33612345678",
		reason: "stop",
	});
	assert.equal(phoneSuppression.targetType, "phone");
	assert.equal(phoneSuppression.phone, "+33612345678");
	assert.equal(phoneSuppression.reason, "stop");
});

test("CampaignLink model supports shortCode attribute", () => {
	const link = new CampaignLink({
		campaignId: "6650f1c2e9b1d4a012345678",
		key: "k1",
		url: "https://example.com/promo",
		shortCode: "x9B2aK",
	});

	assert.equal(link.shortCode, "x9B2aK");
	assert.equal(link.clicks, 0);
});
