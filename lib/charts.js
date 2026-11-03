// Round axis bounds and evenly spaced ticks around the data, so labels read 2,200 rather than 2,187.
export function niceScale(values, tickCount = 4) {
	const numbers = values.filter(Number.isFinite);
	let min = numbers.length ? Math.min(...numbers) : 0;
	let max = numbers.length ? Math.max(...numbers) : 0;
	if (min === max) {
		min = Math.max(0, min - 1);
		max += 1;
	}
	const step = niceStep((max - min) / (tickCount - 1));
	const low = Math.floor(min / step) * step;
	const high = Math.max(Math.ceil(max / step) * step, low + step);
	const ticks = [];
	for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick * 1e6) / 1e6);
	return { min: low, max: high, ticks };
}

function niceStep(rough) {
	const power = 10 ** Math.floor(Math.log10(rough || 1));
	const fraction = rough / power;
	const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
	return Math.max(nice * power, 1);
}

// 0 at the bottom of the axis, 1 at the top.
export function toRatio(value, { min, max }) {
	return max === min ? 0 : (value - min) / (max - min);
}

// Path through evenly spaced points in a width × height box, y measured from the top. A single value is a flat line.
export function linePath(values, scale, { width, height }) {
	const points = values.length === 1 ? [values[0], values[0]] : values;
	const step = points.length > 1 ? width / (points.length - 1) : 0;
	return points
		.map((value, index) => {
			const x = round(index * step);
			const y = round(height - toRatio(value, scale) * height);
			return `${index ? "L" : "M"}${x},${y}`;
		})
		.join("");
}

export function areaPath(values, scale, box) {
	if (values.length === 0) return "";
	return `${linePath(values, scale, box)}L${box.width},${box.height}L0,${box.height}Z`;
}

function round(value) {
	return Math.round(value * 10) / 10;
}
