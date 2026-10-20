import IconWarmup from "@/components/IconWarmup";
import LinkHelp from "@/components/LinkHelp";
import ProgressWarmup from "@/components/ProgressWarmup";
import { formatCount, formatNumber } from "@/lib/format";
import { getPaceHours, getPaceRoom } from "@/lib/send-spread";

// In the send step and the send-more dialog: where the account is in its warm-up, and the hours a send goes out over
// when it's more than the account has proven it can send (lib/send-spread.js). A send at full speed gets no title: it
// goes out when the step above says. Nothing for a send at full speed past the warm-up.
export default function NoticeWarmup({ pace, emails, newContacts = 0 }) {
	const hours = getPaceHours(pace, { emails, newContacts });
	const warmup = pace?.warmup;
	if (!hours && !warmup) return null;

	return (
		<div className="flex flex-col gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
			<div className="flex gap-2.5">
				<IconWarmup className="mt-0.5 text-muted-foreground" />
				<div className="flex flex-col gap-0.5 text-pretty tabular-nums">
					{hours > 0 && (
						<p className="font-medium">
							Goes out over {formatCount(hours, "hour")} while your account warms up{warmup ? "" : " to sends this size"}
						</p>
					)}
					<p className="text-muted-foreground">
						{describePace(pace, hours)} <LinkHelp article="warm-up" />
					</p>
				</div>
			</div>
			{warmup?.hasStarted && <ProgressWarmup warmup={warmup} className="bg-background" />}
		</div>
	);
}

function describePace(pace, hours) {
	const { warmup } = pace;
	const room = `For now, up to ${formatNumber(getPaceRoom(pace))} emails go out at once. That grows as your sends get few bounces and complaints.`;
	if (!warmup) return room;
	if (!warmup.hasStarted) return `This first campaign starts your account's ${warmup.days}-day warm-up.${hours ? ` ${room}` : ""}`;
	return hours ? `Day ${warmup.day} of ${warmup.days}. ${room}` : `Your account is warming up: day ${warmup.day} of ${warmup.days}.`;
}
