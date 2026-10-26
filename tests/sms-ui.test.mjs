import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EditorSms from "../components/EditorSms.jsx";
import SmartphonePreview from "../components/SmartphonePreview.jsx";

test("EditorSms renders segment and character counts", () => {
	const html = renderToStaticMarkup(createElement(EditorSms, { value: "Hello world" }));
	assert.ok(html.includes("11 chars"));
	assert.ok(html.includes("1 segment"));
	assert.ok(html.includes("GSM-7"));
	assert.equal(html.includes("Non-standard characters detected"), false);
});

test("EditorSms displays UCS-2 warning on non-GSM input", () => {
	const html = renderToStaticMarkup(createElement(EditorSms, { value: "Special: \u0410" }));
	assert.ok(html.includes("Non-standard characters detected"));
	assert.ok(html.includes("UCS-2"));
});

test("SmartphonePreview renders message bubble and replaces merge tags", () => {
	const html = renderToStaticMarkup(
		createElement(SmartphonePreview, {
			message: "Hi {{first_name}}, check this out!",
			senderName: "Acme News",
		})
	);

	assert.ok(html.includes("Acme News"));
	assert.ok(html.includes("Hi Alex, check this out!"));
	assert.equal(html.includes("{{first_name}}"), false);
});
