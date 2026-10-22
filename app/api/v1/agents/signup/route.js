import { handleAgentSignup } from "@/lib/agentonboard";

// AgentOnboard's account creation (lib/agentonboard.js): MailCheap Cloud only, so an agent signs nobody
// up where the allowlist decides who an account belongs to.
export async function POST(request) {
	return handleAgentSignup(request);
}
