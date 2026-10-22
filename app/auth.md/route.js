import { getAgentAuthMd } from "@/lib/agentonboard";

// AgentOnboard discovery at the conventional path (agentonboard.xyz/docs/auth-md); /.well-known/auth.md
// re-exports this same file.
export function GET() {
	return new Response(getAgentAuthMd(), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
