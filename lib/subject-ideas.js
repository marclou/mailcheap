import "server-only";
import { neon } from "@neon/ai-sdk-provider";
import { Output, generateText } from "ai";
import { z } from "zod";
import { markdownToHtml } from "./markdown.js";
import { htmlToText } from "./render-email.js";

// Subject line and preview text ideas for a draft, through the Neon AI Gateway on the project's branch:
// one Neon credential, no model provider account. AI_MODEL picks any model the branch serves.
const DEFAULT_MODEL = "claude-sonnet-5";
// The opening of an issue says what it's about. The rest only costs tokens.
const MAX_BODY_CHARACTERS = 8000;

const IdeasSchema = z.object({
	ideas: z
		.array(
			z.object({
				subject: z.string().describe("At most 60 characters, no emoji, no clickbait, no ALL CAPS"),
				previewText: z.string().describe("At most 110 characters, adds to the subject instead of repeating it"),
			})
		)
		.length(3),
});

export function isAiGatewayConfigured() {
	return Boolean(process.env.NEON_AI_GATEWAY_BASE_URL && process.env.NEON_AI_GATEWAY_TOKEN);
}

export async function suggestSubjectLines({ newsletter, campaign }) {
	const html = campaign.format === "markdown" ? markdownToHtml(campaign.markdown) : campaign.html;
	const body = htmlToText(html).slice(0, MAX_BODY_CHARACTERS);
	if (!body.trim()) throw new Error("Write some of the issue first");

	const { output } = await generateText({
		model: neon(process.env.AI_MODEL || DEFAULT_MODEL),
		output: Output.object({ schema: IdeasSchema }),
		system: [
			"You write email subject lines and preview text for a newsletter.",
			"Match the voice of the issue. Be specific to what this issue says, never generic.",
			"Spam filters and readers both punish hype: no emoji, no ALL CAPS, no exclamation marks, no fake urgency.",
			"Give three different angles.",
		].join(" "),
		prompt: [
			`Newsletter: ${newsletter.name}`,
			newsletter.description ? `About: ${newsletter.description}` : null,
			campaign.subject ? `Current subject (improve on it): ${campaign.subject}` : null,
			`Issue:\n${body}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		abortSignal: AbortSignal.timeout(45_000),
	});
	return output.ideas.map(({ subject, previewText }) => ({
		subject: subject.trim().slice(0, 200),
		previewText: previewText.trim().slice(0, 300),
	}));
}
