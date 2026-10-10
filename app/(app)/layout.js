import Link from "next/link";
import LogoMailcheap from "@/components/LogoMailcheap";
import NavFooter from "@/components/NavFooter";
import NavLinks from "@/components/NavLinks";
import NavMobile from "@/components/NavMobile";
import { requireSession } from "@/lib/auth";
import { getSparkLoopConnection } from "@/lib/sparkloop-account";
import { SPARKLOOP_PITCH } from "@/lib/sparkloop-content";

export default async function AppLayout({ children }) {
	await requireSession();
	// SparkLoop's pages join the nav once an account is connected, unless they're shown from the start.
	const showSparkLoop = SPARKLOOP_PITCH || (await getSparkLoopConnection()).status !== "disconnected";

	return (
		<div className="flex min-h-dvh flex-col md:flex-row">
			<aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border/60 px-3 py-4 md:flex">
				<Link href="/" className="mb-6 flex h-9 items-center gap-2 px-2.5">
					<LogoMailcheap />
					<span className="text-sm font-semibold tracking-tight">Mailcheap</span>
				</Link>
				<NavLinks showSparkLoop={showSparkLoop} />
				<div className="mt-auto">
					<NavFooter />
				</div>
			</aside>
			<NavMobile footer={<NavFooter />} showSparkLoop={showSparkLoop} />
			<main className="min-w-0 flex-1">
				<div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10">{children}</div>
			</main>
		</div>
	);
}
