// Confetti only draws in a browser: tests keep each burst it was asked for.
export const bursts = [];

export default function confetti(options) {
	bursts.push(options);
	return Promise.resolve();
}
