import Image from "@tiptap/extension-image";

// A picture placed left, center or right of the column (lib/clean-html.js IMAGE_ALIGNMENTS). Centered ones carry no
// attribute, so issues written before alignment keep their markup.
export const ImageAligned = Image.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			align: {
				default: "center",
				parseHTML: (element) => readAlign(element.getAttribute("data-align")),
				renderHTML: ({ align }) => (align === "center" ? {} : { "data-align": align }),
			},
		};
	},
});

function readAlign(value) {
	return value === "left" || value === "right" ? value : "center";
}
