// Jobs are kept here instead of going to QStash; tests run them by calling the job's code.
export const published = [];
// failNext: an error the next batch publish throws, as QStash refusing it would.
export const state = { failNext: null };

export class Client {
	async batchJSON(requests) {
		if (state.failNext) {
			const error = state.failNext;
			state.failNext = null;
			throw error;
		}
		published.push(...requests);
		return requests.map((_, index) => ({ messageId: `msg-${published.length + index}` }));
	}

	async publishJSON(request) {
		published.push(request);
		return { messageId: `msg-${published.length}` };
	}
}
