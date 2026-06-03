// src/routes/+page.ts
// Resume an existing draft when ?draftId=... is provided. Otherwise the page
// boots into kid-picker mode.
//
// Also reads ?ref=<shortcode> when present — the grandparent-share referral
// flow lands on /, attribution lives in a cookie set elsewhere, but the
// query param is preserved into `data.referralShortcode` so the workshop
// can attribute the eventual order back to the originating parent.

import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const draftId = url.searchParams.get('draftId') ?? null;
	const referralShortcode = url.searchParams.get('ref') ?? null;
	return { draftId, referralShortcode };
};

export const ssr = false; // workshop UX is fully client-side (IDB + WebGPU later)
