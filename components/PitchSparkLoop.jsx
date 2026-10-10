import { Check } from "lucide-react";
import CardConnectSparkLoop from "@/components/CardConnectSparkLoop";
import GraphicSparkLoop from "@/components/GraphicSparkLoop";
import { SPARKLOOP_FEATURES } from "@/lib/sparkloop-content";

// What a SparkLoop page shows until the account is connected: what the feature does, then how to get it.
export default function PitchSparkLoop({ feature }) {
	const pitch = SPARKLOOP_FEATURES[feature];

	return (
		<div className="flex flex-col gap-8">
			<section className="grid items-center gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-12">
				<div className="flex flex-col gap-5 animate-enter">
					<p className="inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground shadow-border">
						Free with a SparkLoop account
					</p>
					<h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{pitch.headline}</h2>
					<p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">{pitch.body}</p>
					<ul className="flex flex-col gap-2.5">
						{pitch.points.map((point) => (
							<li key={point} className="flex items-start gap-2.5 text-sm">
								<span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
									<Check className="size-3" />
								</span>
								{point}
							</li>
						))}
					</ul>
				</div>
				<GraphicSparkLoop feature={feature} className="animate-enter [--stagger:1]" />
			</section>

			<div style={{ "--stagger": 2 }} className="animate-enter">
				<CardConnectSparkLoop note={pitch.requirement} />
			</div>
		</div>
	);
}
