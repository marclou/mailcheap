import { handleAgentRestRequest } from "@/lib/api/agents";

// Every /api/v1/agents endpoint: each maps to one action of lib/actions (see lib/api/agents.js).
async function handle(request, { params }) {
	const { path } = await params;
	return handleAgentRestRequest(request, path);
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST };
