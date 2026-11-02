import { Children, Fragment, isValidElement } from "react";

// A help article's sections (components/ArticleHelp.jsx), in order: its h2s with an id, each with the text links to it
// show. Only fragments and plain elements are read: what a component renders isn't known before it renders.
export function getArticleSections(children) {
	const sections = [];
	const read = (nodes) =>
		Children.forEach(nodes, (node) => {
			if (!isValidElement(node)) return;
			if (node.type === "h2" && node.props.id) sections.push({ id: node.props.id, title: toText(node.props.children) });
			else if (node.type === Fragment || typeof node.type === "string") read(node.props.children);
		});
	read(children);
	return sections;
}

function toText(nodes) {
	let text = "";
	Children.forEach(nodes, (node) => {
		if (typeof node === "string" || typeof node === "number") text += node;
		else if (isValidElement(node)) text += toText(node.props.children);
	});
	return text;
}
