import "server-only";
import { apiKeyActions } from "@/lib/actions/api-keys";
import { billingActions } from "@/lib/actions/billing";
import { campaignActions } from "@/lib/actions/campaigns";
import { connectedAppActions } from "@/lib/actions/connected-apps";
import { contactActions } from "@/lib/actions/contacts";
import { domainActions } from "@/lib/actions/domains";
import { newsletterActions } from "@/lib/actions/newsletters";
import { overviewActions } from "@/lib/actions/overview";
import { segmentActions } from "@/lib/actions/segments";
import { uploadActions } from "@/lib/actions/uploads";

// Every customer action, in the order the docs list them. Admin and sign-in aren't customer actions.
export const ACTIONS = [
	...overviewActions,
	...newsletterActions,
	...campaignActions,
	...contactActions,
	...segmentActions,
	...domainActions,
	...uploadActions,
	...apiKeyActions,
	...connectedAppActions,
	...billingActions,
];

const BY_NAME = new Map(ACTIONS.map((action) => [action.name, action]));
if (BY_NAME.size !== ACTIONS.length) throw new Error("Two actions share a name");

export function getAction(name) {
	return BY_NAME.get(name) ?? null;
}

export const ACTION_GROUPS = [...new Set(ACTIONS.map(({ group }) => group))];
