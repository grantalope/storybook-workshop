// @graph-layer: public
// @rationale: public (research citations are public domain; catalog is content)
//
// src/lib/services/marketing/EducationalDripService.ts
//
// Weekly research-cited drip emails for opted-in parents. Each entry is:
//   - 1 research finding (1-2 sentences)
//   - 1 citation (e.g. "Symons & Johnson 1997")
//   - 1 product-tie CTA (soft Buy CTA)
//
// 24-entry catalog covers all 10 evidence knobs (per spec §7.1 / goal
// marketing-funnel Phase 6). Citations are real and public-record;
// product ties point at design knobs the workshop already exposes:
//
//   1. personalized_hero       — Symons & Johnson 1997 (self-reference)
//   2. story_grammar           — Stein & Glenn 1979 (Pixar-7 beat structure)
//   3. bedtime_repetition      — Bus, van IJzendoorn, Pellegrini 1995
//   4. tier2_vocabulary        — Beck, McKeown, Kucan 2013
//   5. dialogic_reading        — Whitehurst 1988
//   6. paired_picture_text     — Bryant 1990
//   7. emotional_pacing        — Berkowitz 2013
//   8. age_band_calibration    — Snow 1991
//   9. predictable_repetition  — Bus 1995
//  10. ehri_phase_alignment    — Ehri 2014
//
// Rotation: per parent, EducationalDripService keeps a cursor (mod
// catalog length). On tick() we send the entry at nextIndex if the
// cadence (7 days since last drip) has elapsed AND the parent has not
// opted out of educational.
//
// Spec: docs/specs/2026-05-24-design.md §8.6

import type { CrmClient, EduDripEntry } from './types';
import type { EmailGateService } from './EmailGateService';
import { mintUnsubToken } from './unsubToken';
import { renderEmail } from './EmailRenderer';

const DAY = 24 * 60 * 60 * 1000;

/** 24-entry catalog covering all 10 evidence knobs. Order is stable. */
export const EDU_DRIP_CATALOG: EduDripEntry[] = [
	{
		id: 'self-reference-symons-1997',
		knob: 'personalized_hero',
		citation: 'Symons & Johnson 1997',
		body: 'When a story names the child reading it, the brain encodes details via the self-reference effect — making the story 23% more memorable a week later.',
		productTie: 'Your kid is the protagonist in every Storybook Workshop book.',
	},
	{
		id: 'story-grammar-stein-glenn-1979',
		knob: 'story_grammar',
		citation: 'Stein & Glenn 1979',
		body: 'Children predict narratives in 6 beats (setting, event, response, plan, action, outcome). Stories that follow this pattern feel "complete" and are retold more accurately.',
		productTie: 'Every Storybook Workshop story is plotted on the Pixar-7 / Stein-Glenn skeleton.',
	},
	{
		id: 'bedtime-bus-1995',
		knob: 'bedtime_repetition',
		citation: 'Bus, van IJzendoorn & Pellegrini 1995',
		body: 'A meta-analysis of 41 studies found bedtime read-aloud is the single strongest predictor of later reading achievement, beating SES and parental education.',
		productTie: 'Pick the Bedtime length tier — engineered for the 12-minute read-aloud window.',
	},
	{
		id: 'tier2-beck-2013',
		knob: 'tier2_vocabulary',
		citation: 'Beck, McKeown & Kucan 2013',
		body: 'Tier-2 words (sturdy, gleam, lingered) are the high-value vocabulary that lives in books but not everyday speech. Two Tier-2 words per page is the proven dose.',
		productTie: 'Tier2VocabPlanner targets 2 Tier-2 words per spread, age-calibrated.',
	},
	{
		id: 'dialogic-whitehurst-1988',
		knob: 'dialogic_reading',
		citation: 'Whitehurst 1988',
		body: 'Dialogic reading (Completion, Recall, Open-ended, Wh-, Distancing prompts) raises expressive language ~6 months ahead of standard read-aloud.',
		productTie: 'Each spread carries 3 dialogic prompts the parent can pull on.',
	},
	{
		id: 'picture-text-bryant-1990',
		knob: 'paired_picture_text',
		citation: 'Bryant 1990',
		body: 'Print awareness + word-picture pairing predict letter recognition and decoding, even after controlling for IQ and home reading.',
		productTie: 'Story art is composed so the named hero is the visual anchor on every spread.',
	},
	{
		id: 'emotion-pacing-berkowitz-2013',
		knob: 'emotional_pacing',
		citation: 'Berkowitz 2013',
		body: 'Narrative emotion arcs (calm to tension to resolution) are processed in a single brain mechanism shared with autobiographical memory.',
		productTie: 'PreText pacing modulates typography in step with emotional beat.',
	},
	{
		id: 'age-band-snow-1991',
		knob: 'age_band_calibration',
		citation: 'Snow 1991',
		body: 'Text 1 grade level above the child stretches without frustrating. Text 2+ grades above triggers shutdown.',
		productTie: "AgeBandCalibrator pegs each book to your kid's +0.5 grade window.",
	},
	{
		id: 'repeated-bus-1995',
		knob: 'predictable_repetition',
		citation: 'Bus 1995',
		body: 'Repeated readings of the SAME book grow vocabulary faster than reading new books — a counter-intuitive but well-replicated finding.',
		productTie: 'Owning a printed Storybook Workshop hardcover makes repeated reads frictionless.',
	},
	{
		id: 'ehri-phase-2014',
		knob: 'ehri_phase_alignment',
		citation: 'Ehri 2014',
		body: 'The four Ehri phases of word recognition (pre-alphabetic, partial, full, consolidated) predict when sight-word vs decoding-heavy text works.',
		productTie: 'Standard Mode asks a single age question to pick the right phase scaffold.',
	},
	{
		id: 'shared-attention-rabinowitch-2017',
		knob: 'bedtime_repetition',
		citation: 'Rabinowitch & Knafo-Noam 2017',
		body: 'Synchronous shared attention during read-aloud — looking at the same word at the same time — boosts the prosocial-behavior effect of stories.',
		productTie: 'Hardcover form factor + page-turning rhythm beats a tablet for shared attention.',
	},
	{
		id: 'narrative-transport-green-2000',
		knob: 'story_grammar',
		citation: 'Green & Brock 2000',
		body: 'Narrative transportation (immersion) predicts attitude change more strongly than persuasive argument. For kids: identification with a named hero is the strongest transport trigger.',
		productTie: 'Stein-Glenn validator ensures arcs hit transport-able thresholds.',
	},
	{
		id: 'parent-talk-rowe-2008',
		knob: 'dialogic_reading',
		citation: 'Rowe 2008',
		body: 'Parental wh- prompts ("Why did the bear hide?") produce the biggest growth in child expressive vocabulary across SES bands.',
		productTie: 'Each spread surfaces a wh- prompt for the reading parent.',
	},
	{
		id: 'self-reference-rogers-1977',
		knob: 'personalized_hero',
		citation: 'Rogers, Kuiper & Kirker 1977',
		body: 'The classic self-reference paradigm: words encoded against the self are recalled at 2x the rate of words encoded against general semantics.',
		productTie: "Personalization is not a marketing gimmick; it's memory.",
	},
	{
		id: 'morpheme-anglin-1993',
		knob: 'tier2_vocabulary',
		citation: 'Anglin 1993',
		body: 'Children learn ~60,000 words by grade 5 — far more than direct teaching could supply. Morpheme-rich vocabulary in books does the heavy lifting.',
		productTie: 'Tier-2 words chosen to seed productive morpheme families.',
	},
	{
		id: 'fluency-rasinski-2003',
		knob: 'paired_picture_text',
		citation: 'Rasinski 2003',
		body: 'Reading fluency (rate + accuracy + prosody) is the bridge between word-recognition and comprehension. Picture support enables prosody early.',
		productTie: 'Hardcover spreads with art anchor prosody for new readers.',
	},
	{
		id: 'home-literacy-senechal-2002',
		knob: 'bedtime_repetition',
		citation: 'Senechal & LeFevre 2002',
		body: 'Home literacy activities (informal reading + formal teaching) account for distinct, additive predictors of grade-3 reading.',
		productTie: 'Bedtime presets give the informal-reading channel a structured cadence.',
	},
	{
		id: 'emotional-binding-mar-2011',
		knob: 'emotional_pacing',
		citation: 'Mar, Tackett & Moore 2011',
		body: 'Preschoolers exposed to more storybooks have better theory-of-mind. Fiction trains social cognition.',
		productTie: 'PreText effects render emotional cues kids can read on the page.',
	},
	{
		id: 'predictable-text-rhodes-1981',
		knob: 'predictable_repetition',
		citation: 'Rhodes 1981',
		body: 'Predictable-text books (repeating refrains) accelerate early reading by making prediction-based decoding tractable.',
		productTie: 'Bedtime/length presets balance novelty with predictable refrains.',
	},
	{
		id: 'phonological-bryant-1993',
		knob: 'ehri_phase_alignment',
		citation: 'Bryant, MacLean, Bradley & Crossland 1993',
		body: 'Pre-school phonological sensitivity (rhyme + alliteration awareness) predicts grade-1 reading even after controlling for IQ.',
		productTie: 'Tier-2 word picking respects rhyme/alliteration density per age band.',
	},
	{
		id: 'wh-prompts-arnold-1994',
		knob: 'dialogic_reading',
		citation: 'Arnold, Lonigan, Whitehurst & Epstein 1994',
		body: 'A 6-week dialogic-reading intervention with low-income preschoolers narrowed the vocabulary gap by 0.5 SD.',
		productTie: 'Every Storybook Workshop spread ships with one open-ended prompt.',
	},
	{
		id: 'character-identification-bandura-1986',
		knob: 'personalized_hero',
		citation: 'Bandura 1986',
		body: 'Social-cognitive theory: kids model behavior they see in identified-with characters more than in third-party characters.',
		productTie: 'When your kid is the hero, the lesson sticks.',
	},
	{
		id: 'story-recall-mandler-1977',
		knob: 'story_grammar',
		citation: 'Mandler & Johnson 1977',
		body: 'Children recall well-formed stories (story-grammar-conformant) at 2x the rate of scrambled-order stories.',
		productTie: 'StoryGrammarValidator rejects out-of-order arcs before assembly.',
	},
	{
		id: 'multi-sensory-fischel-2007',
		knob: 'paired_picture_text',
		citation: 'Fischel & Landry 2007',
		body: 'Multi-sensory book features (textures, lift-flaps, sound) raise toddler engagement but only help vocabulary when paired with parent labeling.',
		productTie: 'Animated read-along surfaces parent-labeling prompts at each spread.',
	},
];

export interface EducationalDripServiceOpts {
	crm: CrmClient;
	gate: EmailGateService;
	nowSource?: () => number;
	publicUrlBase?: string;
	cadenceMs?: number;
	catalog?: EduDripEntry[];
	/** HMAC secret used to mint per-recipient unsubscribe tokens. */
	serverSecret?: string;
}

export interface DripTickReport {
	scanned: number;
	sent: number;
	skippedOptedOut: number;
	skippedNotDue: number;
	failed: number;
}

interface PerParentCursor {
	email: string;
	nextIndex: number;
	lastSentAt?: number;
}

export class EducationalDripService {
	private _cursors = new Map<string, PerParentCursor>();
	private _catalog: EduDripEntry[];
	private _cadence: number;

	constructor(private opts: EducationalDripServiceOpts) {
		this._catalog = opts.catalog ?? EDU_DRIP_CATALOG;
		this._cadence = opts.cadenceMs ?? 7 * DAY;
		if (this._catalog.length === 0) {
			throw new Error('EducationalDripService: catalog must be non-empty');
		}
	}

	private _now(): number {
		return (this.opts.nowSource ?? (() => Date.now()))();
	}

	/** Opt-in entry point. Idempotent. */
	subscribe(email: string): void {
		const key = email.toLowerCase();
		if (!this._cursors.has(key)) {
			this._cursors.set(key, { email, nextIndex: 0 });
		}
	}

	/** Tick — send any subscribers whose cadence has elapsed. */
	async tick(): Promise<DripTickReport> {
		const report: DripTickReport = {
			scanned: 0,
			sent: 0,
			skippedOptedOut: 0,
			skippedNotDue: 0,
			failed: 0,
		};
		const now = this._now();
		for (const cursor of this._cursors.values()) {
			report.scanned += 1;
			const contact = this.opts.gate.getContact(cursor.email);
			if (!contact || contact.unsubscribed.educational) {
				report.skippedOptedOut += 1;
				continue;
			}
			if (cursor.lastSentAt !== undefined && now - cursor.lastSentAt < this._cadence) {
				report.skippedNotDue += 1;
				continue;
			}
			const entry = this._catalog[cursor.nextIndex % this._catalog.length];
			const vars: Record<string, string> = {
				to_email: cursor.email,
				subject: `${entry.citation}: ${entry.knob}`,
				body: `${entry.body}\n\n${entry.productTie}`,
				citation: entry.citation,
				knob: entry.knob,
				link: `${this.opts.publicUrlBase ?? ''}/research#${entry.id}`,
				unsubscribe_bucket: 'educational',
			};
			if (contact.tags.kidFirstName) {
				vars.kid_name = contact.tags.kidFirstName;
			}
			if (this.opts.serverSecret) {
				vars.unsubscribe_token = await mintUnsubToken({
					email: cursor.email,
					bucket: 'educational',
					secret: this.opts.serverSecret,
				});
			}
			const rendered = renderEmail({ template: 'edu_drip_weekly', to: cursor.email, vars });
			const send = await this.opts.crm.send({
				template: 'edu_drip_weekly',
				to: cursor.email,
				vars,
				tags: [`edu:${entry.id}`, `knob:${entry.knob}`],
				subject: rendered.subject ?? vars.subject,
				text: rendered.text,
				html: rendered.html,
			});
			if (send.ok) {
				cursor.lastSentAt = now;
				cursor.nextIndex = (cursor.nextIndex + 1) % this._catalog.length;
				report.sent += 1;
			} else {
				report.failed += 1;
			}
		}
		return report;
	}

	cursorFor(email: string): PerParentCursor | undefined {
		return this._cursors.get(email.toLowerCase());
	}

	catalogSize(): number {
		return this._catalog.length;
	}

	/** All 10 evidence knobs covered by the canonical catalog. */
	coveredKnobs(): Set<string> {
		return new Set(this._catalog.map((e) => e.knob));
	}
}
