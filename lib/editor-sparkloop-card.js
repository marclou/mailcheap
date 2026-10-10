import { Node } from "@tiptap/core";
import { CARD_FIELDS, DEFAULT_CARD_TEXT, getCardLabel } from "./sparkloop-cards.js";

// A SparkLoop offer or recommendation in an issue. The document keeps an empty div with the card's
// snapshot (lib/sparkloop-cards.js draws it in emails and on the archive); the editor shows a preview,
// and a double-click opens its wording again (onEdit).
export const SparkLoopCard = Node.create({
	name: "sparkloopCard",
	group: "block",
	atom: true,
	draggable: true,
	selectable: true,

	addOptions() {
		return { onEdit: () => {} };
	},

	addAttributes() {
		const attributes = {
			kind: {
				default: "offer",
				parseHTML: (element) => element.getAttribute("data-sparkloop-card") || "offer",
				renderHTML: ({ kind }) => ({ "data-sparkloop-card": kind }),
			},
		};
		for (const [key, name] of Object.entries(CARD_FIELDS)) {
			attributes[key] = {
				default: "",
				parseHTML: (element) => element.getAttribute(name) ?? "",
				renderHTML: (values) => (values[key] ? { [name]: values[key] } : {}),
			};
		}
		return attributes;
	},

	parseHTML() {
		return [{ tag: "div[data-sparkloop-card]" }];
	},

	renderHTML({ HTMLAttributes }) {
		return ["div", HTMLAttributes];
	},

	addNodeView() {
		return ({ node, getPos }) => {
			const dom = renderPreview(node.attrs);
			dom.addEventListener("dblclick", () => this.options.onEdit({ attrs: node.attrs, getPos }));
			return { dom };
		};
	},
});

function element(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

function renderPreview(card) {
	const defaults = DEFAULT_CARD_TEXT[card.kind] ?? DEFAULT_CARD_TEXT.offer;
	const dom = element("div", "sparkloop-card");
	dom.contentEditable = "false";
	dom.dataset.kind = card.kind;

	if (card.image) {
		const image = element("img", "sparkloop-card-image");
		image.src = card.image;
		image.alt = "";
		dom.append(image);
	}

	const body = element("div", "sparkloop-card-body");
	const eyebrow = element("div", "sparkloop-card-eyebrow");
	if (card.logo) {
		const logo = element("img", "sparkloop-card-logo");
		logo.src = card.logo;
		logo.alt = "";
		eyebrow.append(logo);
	}
	const byline = element("div");
	if (card.brand) byline.append(element("div", "sparkloop-card-brand", card.brand));
	byline.append(element("div", "sparkloop-card-label", getCardLabel(card)));
	eyebrow.append(byline);
	body.append(eyebrow, element("p", "sparkloop-card-title", card.title));
	if (card.description) body.append(element("p", "sparkloop-card-description", card.description));
	body.append(element("span", "sparkloop-card-cta", `${card.cta || defaults.cta} →`));
	const badge = card.kind === "offer" ? "SparkLoop offer" : "SparkLoop recommendation";
	dom.append(body, element("span", "sparkloop-card-badge", `${badge} · double-click to edit`));
	dom.title = "Double-click to edit";
	return dom;
}
