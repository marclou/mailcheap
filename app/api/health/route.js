export const dynamic = "force-dynamic";

// Liveness check for Docker and hosting platforms (Coolify, Railway, Fly...). It only says the server
// answers: a database outage shouldn't make the orchestrator restart a healthy process in a loop.
export function GET() {
	return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
