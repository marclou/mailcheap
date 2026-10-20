"use client";

import { createContext, useContext } from "react";

const ContactOptions = createContext({ fields: [], tags: [] });

// The account's contact fields and the newsletter's tag names, given once for every row of the contacts list.
export default function ProviderContactOptions({ fields, tags, children }) {
	return <ContactOptions.Provider value={{ fields, tags }}>{children}</ContactOptions.Provider>;
}

export function useContactOptions() {
	return useContext(ContactOptions);
}
