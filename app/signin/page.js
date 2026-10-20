import { redirect } from "next/navigation";
import ButtonSigninGoogle from "@/components/ButtonSigninGoogle";
import FormSignin from "@/components/FormSignin";
import LayoutSplit from "@/components/LayoutSplit";
import LogoWordmark from "@/components/LogoWordmark";
import ScriptBotId from "@/components/ScriptBotId";
import { SigninAside, SiteAnalytics } from "@/components/SiteExtensions";
import { DELETION_GRACE_DAYS } from "@/lib/account-deletion";
import { getSession, getSignupError, isGoogleEnabled } from "@/lib/auth";
import { BOTID_SIGNIN, isBotIdEnabled } from "@/lib/bot-check";
import { isCloud } from "@/lib/config";
import { readOAuthRequest } from "@/lib/oauth";
import { toSafeNextPath } from "@/lib/validation";

export const metadata = { title: "Sign in" };

// Also where an app connecting with OAuth (ChatGPT, Claude) sends people who aren't signed in: Better Auth
// adds the signed authorization request to the query, and signing in carries on to the consent page.
export default async function SigninPage({ searchParams }) {
	const params = await searchParams;
	const { next, error, deleted } = params;
	const nextPath = toSafeNextPath(next);
	const oauthRequest = await readOAuthRequest(params);
	if (!oauthRequest && (await getSession())) redirect(nextPath);
	const oauthQuery = oauthRequest && !oauthRequest.isExpired ? oauthRequest.query : null;
	const intro = getIntro(oauthRequest, deleted !== undefined);

	return (
		<LayoutSplit aside={SigninAside && <SigninAside />}>
			<header className="flex h-9 items-center">
				<LogoWordmark href="/" className="rounded-md" />
			</header>
			<div className="flex flex-1 items-center justify-center py-12">
				<div className="w-full max-w-[22rem] animate-enter">
					<h1 className="font-display text-[2.5rem] leading-[1.05] font-[480] tracking-[-0.03em] text-balance">Sign in to MailCheap</h1>
					{intro && <p className="mt-3 text-[15px] leading-6 text-pretty text-muted-foreground">{intro}</p>}
					{oauthRequest?.isExpired ? null : (
						<div className="mt-8">
							{isGoogleEnabled() && (
								<>
									<ButtonSigninGoogle next={nextPath} oauthQuery={oauthQuery} />
									<div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
										<span className="h-px flex-1 bg-border" />
										or
										<span className="h-px flex-1 bg-border" />
									</div>
								</>
							)}
							{typeof error === "string" && (
								<p role="alert" className="mb-3 text-sm text-pretty text-destructive">
									{getSignupError(error) ?? "Google sign-in failed. Try again."}
								</p>
							)}
							<FormSignin next={nextPath} oauthQuery={oauthQuery} />
						</div>
					)}
				</div>
			</div>
			{SiteAnalytics && <SiteAnalytics />}
			{isBotIdEnabled() && <ScriptBotId protect={BOTID_SIGNIN} />}
		</LayoutSplit>
	);
}

// Only what changes what to do: an app connecting, an expired link, an account just deleted, or a server that lets
// few emails in.
function getIntro(oauthRequest, isDeleted) {
	if (oauthRequest?.isExpired) return "This sign-in link expired. Go back to the app and connect MailCheap again.";
	if (oauthRequest) return `${oauthRequest.client.name} wants to connect to your MailCheap account. Sign in first.`;
	if (isDeleted) return `Your account is deleted. Sign in within ${DELETION_GRACE_DAYS} days to restore it.`;
	if (!isCloud()) return "Only the emails this server allows can sign in.";
	return null;
}
