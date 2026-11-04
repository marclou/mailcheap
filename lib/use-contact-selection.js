import { createContext, use } from "react";

export const ContactSelectionContext = createContext(null);

// The contacts list's selection (components/ProviderContactSelection.jsx), null outside of one.
export function useContactSelection() {
	return use(ContactSelectionContext);
}
