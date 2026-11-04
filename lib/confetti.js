// A few seconds of confetti as an issue goes out. canvas-confetti draws it over the whole page, under the toasts, on a
// canvas of its own that it removes once the last piece has fallen, so it carries on while the page turns into the
// report. Its code loads the first time, and it shows nothing to those who reduce motion.
export function showConfetti() {
	return import("canvas-confetti")
		.then(({ default: confetti }) => {
			for (const burst of BURSTS) confetti({ ...OPTIONS, ...burst });
		})
		.catch(() => {});
}

const OPTIONS = {
	origin: { y: 0.7 },
	// canvas-confetti only reads hex colors.
	colors: ["#0ea5e9", "#8b5cf6", "#f43f5e", "#fbbf24", "#10b981"],
	disableForReducedMotion: true,
};
// One pop, made of bursts of different spreads and speeds.
const BURSTS = [
	{ particleCount: 50, spread: 26, startVelocity: 55 },
	{ particleCount: 40, spread: 60 },
	{ particleCount: 70, spread: 100, decay: 0.91, scalar: 0.8 },
	{ particleCount: 20, spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 },
	{ particleCount: 20, spread: 120, startVelocity: 45 },
];
