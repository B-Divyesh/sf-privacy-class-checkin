# Botanical field guide — visual thesis

Privacy Class Check-in should feel like a teacher's annotated field notebook: observant without being invasive, orderly without pretending that a mark is proof. The interface uses specimen labels, fine rules, leaf silhouettes, and roomy paper rather than surveillance dashboards, maps, faces, or security theatre. It is deliberately single-mode: warm paper is intrinsic to the field-guide metaphor, explicitly painted at every level, and its contrast has been checked as a cohesive light treatment.

## Tokens

- Palette: `paper #F4F0E5`, `paper-raised #FFFCF3`, `ink #183228`, `ink-muted #53635C`, `fern #246347`, `fern-dark #164330`, `moss #B8C69F`, `light-moss #C9D8B5`, `pressed-leaf #D9E1C8`, `ochre #8B4D12`, `rust #923D32`, `focus #005FCC`. Paper and forest ink are sampled conceptually from herbarium sheets and archival green cloth. Body contrast is at least 7:1; muted text is at least 5:1.
- Type: Georgia for editorial/display labels and the system sans stack for instructions, controls, and tabular data. No webfont files or remote requests are required; the familiar, bookish serif plus efficient sans is appropriate to a classroom utility.
- Scale: 13 / 16 / 18 / 24 / 36 / clamp(44–68) px. Body never falls below 16 px.
- Spacing: an 8 px base rhythm (`4, 8, 16, 24, 32, 48, 64, 96`), with 1 px botanical rules and 12 px clipped-corner radii. Content measure is 72 characters; operational screens cap at 1180 px.
- Depth: a faint fibrous paper texture is authored in CSS; raised sheets use one short olive shadow. Borders and proximity group related observations before surfaces do.

## Interaction grammar

Primary buttons resemble inked specimen labels: forest fill, ivory type, clipped lower-right corner. Secondary actions are quiet ruled labels. A session code is the sole oversized numerical specimen on its screen. State is always written (Present, Late, Absent), never color-only. On phones, teacher tools stack, nonessential illustration notes disappear, tables become labeled rows, and the code remains visible without sticky overlays.

Actions respond within 180 ms through small transform changes; native disclosure states change immediately and predictably. Nothing loops. With `prefers-reduced-motion`, transitions and smooth scrolling become instant while hierarchy, borders, and written state remain intact.

## Original asset plan and provenance

The hero uses one original generated botanical plate: an overhead arrangement of fern fronds, seed pods, three blank paper attendance tags, and a dark green pencil on warm archival paper. It explains anonymous tokens as labels rather than identities. It must contain no people, devices, legible text, logos, QR codes, fingerprints, maps, or cameras. Small icons and leaf dividers are hand-authored SVG/CSS and not copied from an icon set.

Prompt sheet: “Editorial botanical field-guide plate, overhead view, pressed maidenhair fern and native seed pods arranged around three blank cream specimen labels and a dark green pencil, warm archival paper with subtle fibers, forest green, moss, ochre, quiet natural north-window light, crisp macro detail, restrained negative space, screen-print and scientific illustration sensibility, no people, no faces, no phones, no cameras, no fingerprints, no maps, no QR codes, no legible text, no numbers, no logos, no watermark, no brand marks.”

Generated with the factory image model (`factory-image`, Azure OpenAI image generation) on 2026-08-27. Output is original for this product. Source PNG and prompt sidecar are retained under `assets/src/`; optimized WebP is shipped under `frontend/public/`. The footer discloses AI-assisted botanical artwork.
