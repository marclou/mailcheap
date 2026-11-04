import { plainText } from "./contact-fields.js";
import { normalizeEmail } from "./validation.js";

// Who writes a newsletter's issues (models/Author.js): a name and an address, and maybe a picture.
export const MAX_AUTHORS = 20;
export const MAX_AUTHOR_NAME_LENGTH = 60;
export const AUTHOR_NEEDED = "Choose an author for this issue";
// Braces would read as a merge tag once the name is in an email (lib/merge-tags.js), and angle brackets as an address.
const NAME_SYMBOLS = /[{}<>]/;
// An upload's URL (lib/image-storage.js), or another https:// picture: nothing that could end an attribute.
const IMAGE_URL_PATTERN = /^https:\/\/[^\s"'<>]{4,490}$/;

// One line of plain text, as emails and pages print it.
export function readAuthorName(value) {
	return plainText(value);
}

// What's wrong with an author as given, { field, message }, or null. Only the fields given are checked; name is read
// with readAuthorName first.
export function getAuthorProblem({ name, email, imageUrl }) {
	if (name !== undefined) {
		if (!name) return { field: "name", message: "Add their name" };
		if (name.length > MAX_AUTHOR_NAME_LENGTH) return { field: "name", message: `${MAX_AUTHOR_NAME_LENGTH} characters at most` };
		if (NAME_SYMBOLS.test(name)) return { field: "name", message: "No braces or angle brackets" };
	}
	if (email !== undefined && !normalizeEmail(email)) return { field: "email", message: "Add a valid email address" };
	if (imageUrl && !IMAGE_URL_PATTERN.test(imageUrl)) return { field: "imageUrl", message: "Use an https:// image URL" };
	return null;
}

// What an issue's emails or its page show of its author, { name, imageUrl }: never their address. null without an
// author, or one not shown there. place: "email" or "web".
export function getAuthorByline(author, place) {
	const isShown = place === "email" ? author?.showInEmails : author?.showOnWeb;
	return isShown && author.name ? { name: author.name, imageUrl: author.imageUrl || null } : null;
}

// What readers see of an author, in words, when it's not everywhere: the editor shows it next to their name.
export function describeAuthorPlaces(author) {
	if (author.showOnWeb && author.showInEmails) return null;
	if (author.showOnWeb) return "Shown on the web only";
	return author.showInEmails ? "Shown in emails only" : "Not shown to readers";
}
