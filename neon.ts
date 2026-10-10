import { build, type Plugin } from "esbuild";
import { defineConfig } from "@neon/config/v1";

// Mailcheap's backend on one Neon branch: Lakebase Postgres (always there), a public bucket for editor
// images, the AI Gateway for subject line ideas, and the sender function with its every-minute cron.
// Apply with: neon deploy --env .env.local

export const IMAGES_BUCKET = "mailcheap-images";

// What the sender reads from process.env. DATABASE_URL is injected by Neon. Keys missing from the env
// file are left out instead of uploaded empty, which would delete the deployed value.
const SENDER_ENV_KEYS = [
	"APP_URL",
	"SESSION_SECRET",
	"SENDER_SECRET",
	"SENDING_ENABLED",
	"SEND_RATE_PER_SECOND",
	"SES_REGION",
	"SES_ACCESS_KEY_ID",
	"SES_SECRET_ACCESS_KEY",
	"SES_CONFIGURATION_SET",
	"EMAIL_PROVIDER",
	"RESEND_API_KEY",
	"RESEND_WEBHOOK_SECRET",
	"ARCHIVE_HOSTS",
	"ALERT_FROM",
	"ADMIN_EMAIL",
];

function senderEnv(): Record<string, string> {
	return Object.fromEntries(
		SENDER_ENV_KEYS.flatMap((key) => (process.env[key] ? [[key, process.env[key] as string]] : []))
	);
}

// lib/ modules guard against client bundles with `import "server-only"`, which throws outside Next.js.
const serverOnly: Plugin = {
	name: "server-only",
	setup(build) {
		build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
		build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
	},
};

export default defineConfig({
	buckets: {
		[IMAGES_BUCKET]: { access: "public_read" },
	},
	aiGateway: true,
	functions: {
		sender: {
			name: "Mailcheap sender",
			source: "functions/sender.js",
			env: senderEnv(),
			bundler: async (fn) => {
				const out = await build({
					entryPoints: [fn.source],
					bundle: true,
					platform: "node",
					target: "node24",
					format: "esm",
					write: false,
					outfile: "index.mjs",
					plugins: [serverOnly],
					// CommonJS dependencies (the AWS SDK, sanitize-html) call require(); ESM output has none in scope.
					banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
				});
				return { "index.mjs": out.outputFiles[0].contents };
			},
		},
	},
	triggers: {
		"sender-tick": {
			type: "schedule",
			function: "sender",
			cron: "* * * * *",
			functionPath: "/tick",
		},
	},
});
