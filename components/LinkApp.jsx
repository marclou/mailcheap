// A dashboard page named in the help center or the docs, by its path. A plain link rather than next/link: these pages need a
// session, so a signed-out reader goes to sign-in and lands on the page after it (proxy.js passes the path as next). The
// href stays a literal path, which tests/help.test.mjs checks against the app's routes.
export default function LinkApp({ href, className, children }) {
	return (
		<a href={href} className={className}>
			{children}
		</a>
	);
}
