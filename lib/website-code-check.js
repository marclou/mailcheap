import "server-only";
import { Script } from "node:vm";
import { readCustomCode } from "./website-code.js";

const FILENAME = "custom-code";

// Custom code as it's saved, from the Website page and the API alike: its tags (lib/website-code.js), then the
// JavaScript of each of its scripts, compiled and never run. The message names the line to fix.
export function getCustomCodeProblem(code) {
	const { problem, scripts } = readCustomCode(code);
	const found = problem ?? scripts.map(getSyntaxProblem).find(Boolean);
	return found ? `Custom code, line ${found.line}: ${found.message}` : null;
}

function getSyntaxProblem({ line, source }) {
	try {
		new Script(source, { filename: FILENAME });
		return null;
	} catch (error) {
		const lineInScript = Number(new RegExp(`^${FILENAME}:(\\d+)`).exec(error.stack)?.[1] ?? 1);
		return { line: line + lineInScript - 1, message: describeSyntaxError(error, source) };
	}
}

// Anything but a syntax error is the parser running out of stack, as a browser's would too.
function describeSyntaxError(error, source) {
	if (!(error instanceof SyntaxError)) return "this script nests too deeply for browsers to read.";
	if (/[“”‘’]/.test(source)) return "this script has curly quotes (“ ”), which JavaScript doesn't read. Type straight quotes (\") instead.";
	if (error.message === "Unexpected end of input") return "this script ends too early: a } or a ) is missing.";
	return `this script has a JavaScript error: ${error.message}.`;
}
