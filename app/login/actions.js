"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isValidLogin, startSession } from "@/lib/auth";
import { getConfigProblems } from "@/lib/config";
import { notifyActivity } from "@/lib/notify-activity";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";

const ATTEMPTS_PER_IP = { name: "login-ip", limit: 10, window: "15 m" };

function safeNextPath(value) {
	return typeof value === "string" && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : "/";
}

export async function login(_state, formData) {
	const problems = getConfigProblems();
	if (problems.length > 0) return { error: `Login is off until the server's settings are fixed. ${problems.join(" ")}` };

	if (await isRateLimited({ ...ATTEMPTS_PER_IP, key: getClientIp(await headers()) })) {
		return { error: "Too many attempts. Try again in 15 minutes." };
	}

	const email = formData.get("email");
	const password = formData.get("password");

	if (!isValidLogin(email, password)) {
		// Slow down guessing; the admin account is the only account.
		await new Promise((resolve) => setTimeout(resolve, 800));
		return { error: "Wrong email or password" };
	}

	await startSession(process.env.ADMIN_EMAIL);
	await notifyActivity(["New login"], { withUserAgent: true });
	redirect(safeNextPath(formData.get("next")));
}
