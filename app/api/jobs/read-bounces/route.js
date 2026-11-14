import { NextResponse } from "next/server";
import { withQStashSignature } from "@/lib/qstash-route";
import { readBounces } from "@/lib/workspace-bounces";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// A Google Workspace mailbox's bounces, a few minutes after a batch went out (lib/workspace-bounces.js). A mailbox that
// doesn't answer fails the job, which QStash tries again.
export const POST = withQStashSignature(async () => NextResponse.json(await readBounces()));
