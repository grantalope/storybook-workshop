import { describe, expect, it } from 'vitest';
import {
	renderEmail,
	subjectFor,
	textFor,
	footerFor,
} from '$lib/services/marketing';

describe('EmailRenderer + CrmClient helpers', () => {
	it('renders subject/text/html for gate_unlock', () => {
		const r = renderEmail({
			template: 'gate_unlock',
			to: 'parent@x.com',
			vars: { kid_name: 'Eli', link: 'https://x/y/abcd1234' },
		});
		expect(r.subject).toContain('Eli');
		expect(r.text).toContain('Eli');
		expect(r.text).toContain('https://x/y/abcd1234');
		expect(r.html).toContain('<h1');
		expect(r.html).toContain('Eli');
	});

	it('always includes an unsubscribe link in plain-text', () => {
		const r = renderEmail({
			template: 'lifecycle_T24h',
			to: 'parent@x.com',
			vars: { kid_name: 'Eli', link: 'https://x/y/c', promo_code: 'BEDTIME10' },
		});
		expect(r.text).toContain('Unsubscribe from marketing emails');
		expect(r.text).toContain('parent%40x.com');
	});

	it('always includes data-unsubscribe attr in HTML', () => {
		const r = renderEmail({
			template: 'lifecycle_T24h',
			to: 'parent@x.com',
			vars: { kid_name: 'Eli', link: 'https://x' },
		});
		expect(r.html).toContain('data-unsubscribe="marketing"');
	});

	it('HTML escapes user-supplied values (XSS guard)', () => {
		const r = renderEmail({
			template: 'lifecycle_T0',
			to: '"><script>alert(1)</script>@x.com',
			vars: { kid_name: '<img src=x>', link: 'javascript:alert(1)' },
		});
		expect(r.html).not.toContain('<script>');
		expect(r.html).not.toContain('<img src=x>');
		expect(r.html).toContain('&lt;img');
	});

	it('renders edu_drip_weekly with custom subject + body', () => {
		const r = renderEmail({
			template: 'edu_drip_weekly',
			to: 'parent@x.com',
			vars: {
				subject: 'Bus 1995: bedtime',
				body: 'Bedtime reading is the strongest predictor of later reading.',
				link: 'https://x/research',
			},
		});
		expect(r.subject).toBe('Bus 1995: bedtime');
		expect(r.text).toContain('Bedtime reading');
	});

	it('renders all 14 templates without throwing', () => {
		const templates = [
			'gate_unlock',
			'lifecycle_T0',
			'lifecycle_T1h',
			'lifecycle_T24h',
			'lifecycle_T72h',
			'lifecycle_T7d',
			'lifecycle_T14d',
			'lifecycle_T30d',
			'abandoned_cart_T1h',
			'abandoned_cart_T24h',
			'abandoned_cart_T72h',
			'birthday_6w',
			'edu_drip_weekly',
			'referral_credit_awarded',
		] as const;
		for (const t of templates) {
			const r = renderEmail({
				template: t,
				to: 'p@x.com',
				vars: { kid_name: 'Kid', link: 'https://x/y' },
			});
			expect(r.subject.length).toBeGreaterThan(0);
			expect(r.text.length).toBeGreaterThan(0);
			expect(r.html.length).toBeGreaterThan(50);
		}
	});

	it('subjectFor varies by template + kid name', () => {
		expect(subjectFor('lifecycle_T0', { kid_name: 'Eli' })).toContain('Eli');
		expect(subjectFor('birthday_6w', { kid_name: 'Mia' })).toContain('Mia');
		expect(subjectFor('referral_credit_awarded', {})).toContain('$5');
	});

	it('textFor includes promo code when supplied', () => {
		const txt = textFor('abandoned_cart_T1h', {
			kid_name: 'Eli',
			link: 'https://x',
			promo_code: 'TESTCODE12',
		});
		expect(txt).toContain('TESTCODE12');
	});

	it('footerFor parametrizes unsubscribe link by bucket', () => {
		const f = footerFor({ to_email: 'p@x.com', unsubscribe_bucket: 'educational' });
		expect(f).toContain('educational');
		expect(f).toContain('type=educational');
		expect(f).toContain('p%40x.com');
	});

	it('does NOT include kid photo or rendered book interior in body', () => {
		// Privacy contract: only the shareable link, never an attachment / image data.
		const r = renderEmail({
			template: 'lifecycle_T0',
			to: 'p@x.com',
			vars: { kid_name: 'Eli', link: 'https://x/y' },
		});
		expect(r.html).not.toContain('data:image');
		expect(r.html).not.toContain('<img');
		expect(r.text).not.toContain('data:');
	});
});
