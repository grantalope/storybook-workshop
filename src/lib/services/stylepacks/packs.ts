// @graph-layer: private
// @rationale: public-safe style metadata; no child PII

import type { StylePack } from './types';

const legacyPacks: StylePack[] = [
	{
		id: 'octopath-hd2d',
		displayName: 'Octopath HD-2D',
		legacy: true,
		inspirations: [],
	},
	{
		id: 'flat-painted',
		displayName: 'Flat Painted',
		legacy: true,
		inspirations: [],
	},
	{
		id: 'pixel-pure',
		displayName: 'Pixel Pure',
		legacy: true,
		inspirations: [],
	},
];

const artHistoryPacks: StylePack[] = [
	{
		id: 'ukiyo-e-woodblock',
		displayName: 'Ukiyo-e Woodblock',
		era: { start: 1700, end: 1860 },
		cultureTag: 'japan',
		respectNote:
			'Ukiyo-e printmaking grew in Japan during the Edo period. Use this pack to notice carved-line and ink-layer techniques, not to flatten Japanese art into one look.',
		inspirations: [
			{ name: 'Hokusai', died: 1849 },
			{ name: 'Hiroshige', died: 1858 },
		],
		promptRecipe: {
			positivePrefix:
				'public-domain Edo-period woodblock print technique, flat color planes, crisp ink contours, asymmetrical composition, visible carved woodgrain',
			positiveSuffix:
				'layered ink registration, quiet negative space, patterned water and cloud shapes, limited hand-printed color',
			negativeAdditions:
				'photorealistic, airbrushed, oil paint, 3d render, modern comic styling, plastic texture',
			palette: ['#1f4e79', '#c94c2f', '#f2d49b', '#2d6a4f', '#111827'],
		},
		educationalCard: {
			kidExplainer:
				'Ukiyo-e artists made pictures by carving designs into wood blocks, then pressing ink onto paper. Look for bold outlines, flat colors, and waves or clouds that feel like they are dancing.',
			funFact:
				'One picture could need several wood blocks, one for each color.',
			lookFor:
				'Flat areas of color, strong outlines, and patterns in water, trees, and sky.',
			tryItYourself:
				'Draw one big wave with only three colors and a thick outline.',
			famousWorkDescription:
				'A famous public-domain wave print shows a huge curling wave with tiny boats beneath it and a small mountain far away.',
		},
	},
	{
		id: 'impressionist-garden',
		displayName: 'Impressionist Garden',
		era: { start: 1870, end: 1926 },
		inspirations: [{ name: 'Monet', died: 1926 }],
		promptRecipe: {
			positivePrefix:
				'public-domain impressionist garden painting technique, loose broken brushstrokes, outdoor light, soft edges, dappled color',
			positiveSuffix:
				'fresh air atmosphere, shimmering reflections, gentle flower shapes, visible paint touches, bright natural light',
			negativeAdditions:
				'photorealistic, hard vector edges, black outlines, heavy shadows, glossy 3d render, neon colors',
			palette: ['#8ab17d', '#f4a261', '#e9c46a', '#7aa6c2', '#f1f5db'],
		},
		educationalCard: {
			kidExplainer:
				'Impressionist painters tried to catch a quick sparkle of light before it changed. Their pictures can look a little blurry up close, then bright and lively when you step back.',
			funFact:
				'Many artists painted outside so they could watch real sunlight move.',
			lookFor:
				'Tiny brush marks, soft garden colors, and light that seems to flicker.',
			tryItYourself:
				'Use short dabs to paint a flower patch without drawing hard outlines first.',
			famousWorkDescription:
				'A public-domain garden scene shows floating water lilies and soft reflections on a pond.',
		},
	},
	{
		id: 'post-impressionist-swirl',
		displayName: 'Swirling Starlight',
		era: { start: 1885, end: 1905 },
		inspirations: [{ name: 'Van Gogh', died: 1890 }],
		promptRecipe: {
			positivePrefix:
				'public-domain post-impressionist paint technique, energetic curved brushstrokes, thick impasto texture, expressive sky rhythms',
			positiveSuffix:
				'swirling stars, rolling hills, lively outlines, visible ridges of paint, bold complementary color accents',
			negativeAdditions:
				'photorealistic, smooth airbrush, flat vector art, grey low contrast, glossy plastic, 3d render',
			palette: ['#1d3557', '#f1c453', '#2a9d8f', '#e76f51', '#f8f4e3'],
		},
		educationalCard: {
			kidExplainer:
				'Some painters used color and brush marks to show feelings, not just shapes. In this style, skies can swirl, stars can glow, and fields can wiggle with energy.',
			funFact:
				'Thick paint can leave little ridges that you can almost imagine touching.',
			lookFor:
				'Curvy brush marks, bright night colors, and shapes that feel full of motion.',
			tryItYourself:
				'Make a night sky using only spirals, dashes, and dots.',
			famousWorkDescription:
				'A public-domain night painting shows a village under a sky filled with glowing swirls and stars.',
		},
	},
	{
		id: 'cutout-collage',
		displayName: 'Paper Cutout Collage',
		era: { start: 1940, end: 1954 },
		inspirations: [{ name: 'Matisse', died: 1954 }],
		promptRecipe: {
			positivePrefix:
				'public-domain paper cutout collage technique, hand-cut organic shapes, flat gouache color, crisp scissor edges, playful arrangement',
			positiveSuffix:
				'layered colored paper pieces, simple silhouettes, joyful spacing, visible paper overlap, clean poster-like composition',
			negativeAdditions:
				'photorealistic, shaded modeling, pencil sketch, 3d render, glossy gradients, busy tiny detail',
			palette: ['#005f73', '#ee9b00', '#ca6702', '#94d2bd', '#fefae0'],
		},
		educationalCard: {
			kidExplainer:
				'Cutout collage is like drawing with scissors. Artists cut bright paper shapes and move them around until the picture feels just right.',
			funFact:
				'Large cutout pictures could be arranged on a wall before being glued down.',
			lookFor:
				'Flat bright shapes, simple leaves or stars, and edges that look hand cut.',
			tryItYourself:
				'Cut three wiggly paper shapes and arrange them into a dancing creature.',
			famousWorkDescription:
				'A public-domain cut-paper work shows bold leaf and sea shapes floating across a bright background.',
		},
	},
	{
		id: 'watercolor-botanical',
		displayName: 'Watercolor Botanical',
		era: { start: 1880, end: 1945 },
		inspirations: [{ name: 'Potter-era natural-history school', died: 1943 }],
		promptRecipe: {
			positivePrefix:
				'public-domain natural-history watercolor technique, delicate transparent washes, fine botanical linework, careful observation',
			positiveSuffix:
				'soft paper grain, pale layered color, tiny leaf veins, gentle animal details, airy white space',
			negativeAdditions:
				'oil paint, neon color, heavy black outline, 3d render, glossy plastic, harsh comic shading',
			palette: ['#6b8f71', '#d8c99b', '#b56576', '#f4f1de', '#7f5539'],
		},
		educationalCard: {
			kidExplainer:
				'Botanical watercolor artists looked very closely at plants and small animals. Their pictures feel quiet because the colors are thin, soft, and full of tiny true details.',
			funFact:
				"Artists from Beatrix Potter's time often studied real leaves, mushrooms, and animals before painting them.",
			lookFor:
				'Gentle color washes, thin lines, and little details like veins in a leaf.',
			tryItYourself:
				'Paint one leaf with watery green, then add its tiny lines after it dries.',
			famousWorkDescription:
				'A public-domain natural-history page might show a small rabbit or plant painted with careful, soft detail.',
		},
	},
	{
		id: 'stained-glass',
		displayName: 'Stained Glass Window',
		era: { start: 1150, end: 1500 },
		inspirations: [],
		promptRecipe: {
			positivePrefix:
				'public-domain medieval stained glass technique, leaded outlines, jewel-tone glass pieces, luminous flat shapes, window-panel composition',
			positiveSuffix:
				'black leading lines, glowing colored panes, simple symbolic shapes, mosaic-like divisions, light shining through glass',
			negativeAdditions:
				'photorealistic, soft watercolor wash, pencil sketch, 3d render, muddy color, thin low-contrast lines',
			palette: ['#0b3d91', '#c1121f', '#fca311', '#2a9d8f', '#111111'],
		},
		educationalCard: {
			kidExplainer:
				'Stained glass pictures are made from colored pieces of glass held together by dark lines. When light shines through, the colors can glow like treasure.',
			funFact:
				'Old windows often told stories for people who could not read books.',
			lookFor:
				'Dark lead lines, bright glass colors, and shapes divided like a puzzle.',
			tryItYourself:
				'Draw a picture with thick black lines, then color each space a different jewel color.',
			famousWorkDescription:
				'A public-domain cathedral window might show a story scene built from many glowing blue, red, and gold panes.',
		},
	},
	{
		id: 'illuminated-manuscript',
		displayName: 'Illuminated Manuscript',
		era: { start: 800, end: 1500 },
		inspirations: [],
		promptRecipe: {
			positivePrefix:
				'public-domain illuminated manuscript technique, hand-lettered border design, mineral pigments, gold-leaf accents, decorative margins',
			positiveSuffix:
				'ornate initial letters, tiny pattern borders, flat medieval perspective, parchment texture, careful ink flourishes',
			negativeAdditions:
				'photorealistic, modern sans-serif poster, 3d render, neon glow, loose messy scribbles, glossy plastic',
			palette: ['#7b2cbf', '#d4af37', '#1b4332', '#b08968', '#f7ead1'],
		},
		educationalCard: {
			kidExplainer:
				'Before printed books, some books were copied and painted by hand. Illuminated pages used bright colors and shiny gold to make important words feel special.',
			funFact:
				'One fancy page could take many careful hours to finish.',
			lookFor:
				'Gold details, decorated first letters, borders, and parchment-colored backgrounds.',
			tryItYourself:
				'Write the first letter of your name very large and fill it with tiny patterns.',
			famousWorkDescription:
				'A public-domain manuscript page might show a big decorated letter surrounded by vines, animals, and gold shapes.',
		},
	},
	{
		id: 'persian-miniature',
		displayName: 'Persian Miniature',
		era: { start: 1300, end: 1600 },
		cultureTag: 'persia',
		respectNote:
			'Persian miniature painting comes from book arts made in Persian-speaking courts and workshops. This pack focuses on page design, fine brushwork, and mineral color traditions.',
		inspirations: [{ name: 'Behzad', died: 1535 }],
		promptRecipe: {
			positivePrefix:
				'public-domain Persian miniature painting technique, fine brush lines, mineral pigments, layered garden architecture, flattened perspective',
			positiveSuffix:
				'intricate floral borders, patterned tiles, precise small figures, balanced page layout, rich lapis and rose colors',
			negativeAdditions:
				'photorealistic, oil impasto, 3d render, blurred detail, empty modern minimalism, plastic texture',
			palette: ['#1d4e89', '#b23a48', '#e9c46a', '#2a9d8f', '#f4e3b2'],
		},
		educationalCard: {
			kidExplainer:
				'Persian miniatures are small, detailed paintings made for beautiful books. They often show gardens, buildings, and people with careful lines and bright mineral colors.',
			funFact:
				'The word miniature can mean small, but the tiny details can make the world feel huge.',
			lookFor:
				'Fine lines, patterned borders, flat space, and colors like lapis blue and warm gold.',
			tryItYourself:
				'Draw a tiny garden with a border of repeating flowers around it.',
			famousWorkDescription:
				'A public-domain miniature page might show a garden gathering with patterned walls, trees, and many carefully painted details.',
		},
	},
	{
		id: 'mexican-amate-folk',
		displayName: 'Amate Folk Painting',
		era: { start: 1500, end: 1900 },
		cultureTag: 'mexico',
		respectNote:
			'Amate painting grows from Indigenous bark-paper traditions in Mexico, later joined by village painting practices. This pack points to materials, line, and community craft rather than pretending one style speaks for all of Mexico.',
		inspirations: [],
		promptRecipe: {
			positivePrefix:
				'public-domain bark-paper painting technique, amate paper texture, bold flat animal and plant shapes, rhythmic village craft composition',
			positiveSuffix:
				'visible fibrous paper, bright outlined birds and flowers, repeating decorative marks, warm handmade surface',
			negativeAdditions:
				'photorealistic, glossy digital gradients, 3d render, oil impasto, muted grey palette, mass-produced poster look',
			palette: ['#0a9396', '#ee9b00', '#bb3e03', '#ae2012', '#fefae0'],
		},
		educationalCard: {
			kidExplainer:
				'Amate paintings are often made on bark paper with bright animals, flowers, and village scenes. The paper itself is part of the art because you can see its warm, fibrous texture.',
			funFact:
				'Amate paper is made from tree bark fibers pressed into sheets.',
			lookFor:
				'Bright birds, plants, bold outlines, and a handmade paper surface.',
			tryItYourself:
				'Draw a bird and fill the space around it with leaves, dots, and flowers.',
			famousWorkDescription:
				'A public-domain-style amate scene might show birds and flowers arranged across textured bark paper.',
		},
	},
	{
		id: 'scandinavian-rosemaling',
		displayName: 'Rosemaling',
		era: { start: 1750, end: 1900 },
		cultureTag: 'scandinavia',
		respectNote:
			'Rosemaling grew in rural Norway and neighboring Scandinavian communities as decorative painting on wood. This pack focuses on scrollwork, brush technique, and household craft history.',
		inspirations: [],
		promptRecipe: {
			positivePrefix:
				'public-domain rosemaling decorative painting technique, flowing scrollwork, stylized flowers, symmetrical brush curves, painted wood surface',
			positiveSuffix:
				'curled acanthus leaves, teardrop brush strokes, balanced floral flourishes, matte handmade paint, cheerful carved-wood setting',
			negativeAdditions:
				'photorealistic, 3d render, neon colors, harsh black comic lines, glossy plastic, urban graffiti texture',
			palette: ['#1f6f78', '#c44536', '#f2cc8f', '#283618', '#f7f3e3'],
		},
		educationalCard: {
			kidExplainer:
				'Rosemaling is decorative painting with curling stems, leaves, and flowers. People painted it on useful things like bowls, chests, and walls to make everyday life feel special.',
			funFact:
				'Many rosemaling designs start with one graceful S-shaped curve.',
			lookFor:
				'Curly flower stems, teardrop brush marks, and painted wood colors.',
			tryItYourself:
				'Draw one big curling vine, then add leaves that follow the curve.',
			famousWorkDescription:
				'A public-domain painted chest might show red and blue flowers curling across a dark wooden panel.',
		},
	},
	{
		id: 'art-nouveau-poster',
		displayName: 'Art Nouveau Poster',
		era: { start: 1890, end: 1939 },
		inspirations: [{ name: 'Mucha', died: 1939 }],
		promptRecipe: {
			positivePrefix:
				'public-domain art nouveau poster technique, flowing botanical linework, elegant flat color, decorative halo shapes, lithograph poster layout',
			positiveSuffix:
				'long curling plant forms, graceful border frame, soft ink texture, hand-lettered poster feeling, warm muted color blocks',
			negativeAdditions:
				'photorealistic, 3d render, harsh neon, cluttered modern ad layout, chrome texture, heavy grunge',
			palette: ['#6a994e', '#bc4749', '#f2e8cf', '#a7c957', '#7f4f24'],
		},
		educationalCard: {
			kidExplainer:
				'Art Nouveau posters love lines that curl like vines. The pictures often feel decorative from edge to edge, with flowers, frames, and smooth shapes working together.',
			funFact:
				'Many posters were made with lithography, a print process that helped art travel through city streets.',
			lookFor:
				'Vine-like lines, flower borders, flat colors, and a poster-shaped design.',
			tryItYourself:
				'Frame a drawing with curling stems that grow from the corners.',
			famousWorkDescription:
				'A public-domain poster might show a figure surrounded by flowers, circles, and flowing plant lines.',
		},
	},
	{
		id: 'bauhaus-geometric',
		displayName: 'Bauhaus Shapes',
		era: { start: 1919, end: 1944 },
		inspirations: [
			{ name: 'Klee', died: 1940 },
			{ name: 'Kandinsky', died: 1944 },
		],
		promptRecipe: {
			positivePrefix:
				'public-domain Bauhaus geometric design technique, clean circles triangles and rectangles, primary color accents, balanced abstract composition',
			positiveSuffix:
				'playful shape rhythm, flat poster color, clear grid alignment, simple forms, crisp educational design feeling',
			negativeAdditions:
				'photorealistic, ornate decoration, oil impasto, 3d render, soft fantasy haze, busy background texture',
			palette: ['#e63946', '#f1faee', '#1d3557', '#ffbe0b', '#111111'],
		},
		educationalCard: {
			kidExplainer:
				'Bauhaus artists liked to build pictures from simple shapes. A circle, triangle, and square can feel like a whole playground when the colors and spacing are just right.',
			funFact:
				'The Bauhaus school taught art, design, furniture, buildings, and everyday objects together.',
			lookFor:
				'Circles, triangles, rectangles, primary colors, and neat spacing.',
			tryItYourself:
				'Make a picture using only three circles, three triangles, and three rectangles.',
			famousWorkDescription:
				'A public-domain geometric work might arrange bright circles and lines so they feel like music on paper.',
		},
	},
];

export const STYLE_PACKS: readonly StylePack[] = Object.freeze([
	...legacyPacks,
	...artHistoryPacks,
]);
