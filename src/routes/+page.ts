// src/routes/+page.ts
// Resume an existing draft when ?draftId=... is provided. Otherwise the page
// boots into kid-picker mode.

import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const draftId = url.searchParams.get('draftId') ?? null;
	return { draftId };
};

export const ssr = false; // workshop UX is fully client-side (IDB + WebGPU later)
