# Card image localization

Generate a card image for a printing ID and language from its English scan and the project's local resources. The renderer has no translation-service dependency. Simplified Chinese, Traditional Chinese, Japanese, European Spanish, and Turkish cover the 1,270 printings in the project deck catalog. This includes 34 basic Energy printings that share the English scan. The Traditional Chinese review sample covers 100 printings across classic, Sun & Moon, Sword & Shield, Scarlet & Violet, and Mega Evolution frames.

## In the game

Settings has separate, opt-in switches for downloading reviewed printings and generating card images on demand. The download switch shows the original image coverage for the current language as a fraction of the deck catalog. The count includes shared Energy images and counts each printing ID once. The game resolves only visible cards, follows the current language, and tries configured downloads first when both switches are on. Complete recipes use the shared repair and layout code in the browser, with results cached in IndexedDB. The packaged game includes the recipe data and the English scans. The static web build uses its existing English image URLs and depends on the image hosts allowing browser access.

The localhost server and the app builds supply the runtime data from the same locale packs and printed index. The server serves the manifests at `/card-image/data/{printed,recipes}/<locale>.json`, the summary at `/card-image/data/coverage.json`, and fetches approved resources through `/api/card-image-resource`. The desktop app reads the packaged manifests and uses the `card_image_resource` Tauri command. The static web build reads the published manifests and requests images directly from their sources. Restart the localhost Node process after changing the configuration or replacing local scans.

Manifest and image requests have deadlines. Changing the language or card image preferences releases the old requests from the visible-card queue. Temporary failures can be retried while the card is visible. The game keeps showing the English scan if it cannot obtain a localized image.

## Run the renderer

Use the project's Node version and macOS. Install `librsvg`, `pango` and `webp` with Homebrew. The source decoder uses `sips`. Run `npm run images` to obtain missing source scans, or pass an English PNG using `--input`.

```sh
node scripts/localize-card.mjs sv3-125 --locale zh-Hans --output /tmp/charizard.webp
node scripts/localize-card.mjs me3-62 --locale ja --strict --output /tmp/meowth-ja.webp
node scripts/localize-card.mjs sv1-167 --locale zh-Hant --json
node scripts/localize-card.mjs all --group zh-Hant-100 --locale zh-Hant --strict --out-dir /tmp/cards-zh-tw
node scripts/localize-card.mjs all --group catalog --locale zh-Hant --strict --out-dir /tmp/catalog-zh-tw
node scripts/localize-card.mjs all --locale zh-Hans --out-dir /tmp/cards-zh
node scripts/localize-card.mjs all --group catalog --locale zh-Hans --strict --out-dir /tmp/catalog-zh
node scripts/localize-card.mjs all --group pokemon --locale zh-Hans --out-dir /tmp/pokemon-zh
node scripts/localize-card.mjs all --group expansion --width 240 --out-dir /tmp/cards-zh-small
```

Omit the output argument to get the cached file path. The JSON response includes the requested and actual locales, cache hits and elapsed milliseconds. Classic and Sun & Moon basic Energy printings share the English scan across locales and satisfy strict mode. An uncovered printing, an unavailable locale pack or incomplete text returns the English image with a reason. Unknown IDs return an error. Supported output formats are WebP, PNG and SVG.

`--group catalog` takes the unique printing IDs from the project decks. `--strict` checks that every selected printing has a face for the requested locale before rendering. With `--json`, each result also records the actual locale and output path for batch verification.

The asynchronous entry point accepts the same rendering parameters. An image worker can serve the returned file.

```js
import { generateCardImage } from './scripts/card-localization/generate.mjs';

const { output, actualLocale, hit } = await generateCardImage({
  id: 'sv3-125',
  locale: 'zh-Hans',
  width: 600,
  cacheDir: '/var/cache/card-images',
});
```

## Prefer a released card image

```sh
node scripts/localize-card.mjs swsh5-88 --locale zh-Hans --prefer-printed --width 734 --json
node scripts/localize-card.mjs all --group catalog --locale zh-Hans --prefer-printed --out-dir /tmp/cards
```

With `--prefer-printed`, the script tries reviewed images for the requested locale, then renders a localized face from the English scan. If that locale has no face resources, it returns the English image or fails in strict mode. Use `--offline` with `--prefer-printed` to reuse cached downloads and render the other cards locally. JSON results identify the source and include the localized printing and source page when used.

The [Simplified Chinese](data/printed/zh-Hans.json), [Traditional Chinese](data/printed/zh-Hant.json), [Japanese](data/printed/ja.json), and [Spanish](data/printed/es.json) image indexes map English printing IDs to ordered lists of localized printings. An entry records the localized printing, source page, image dimensions, and SHA-256 of the reviewed file. Simplified Chinese official articles store the image path and resolve its current signed URL. Official card catalogs, campaign pages, and public mirrors can store a direct PNG, WebP, or JPEG URL. These sources use the same verified image cache. Turkish uses the generation pack and shared Energy scans.

To add an entry, compare the card name and art first, then compare the illustrator, form, HP, Energy cost, damage, Weakness, Resistance, Retreat Cost, and printed rules where applicable. Confirm the file has at least 600 × 825 pixels. Reviewed TCGdex high-resolution PNG and WebP images meet this size requirement. Inspect the title, rules and fine print for blur, signs of upscaling or overlaid watermarks. A request for a wider image skips smaller entries. Keep candidates in source preference order and leave unmatched variants to the renderer. An image export can be stored separately from the app and deck JSONs.

Manifest generation checks the index version and candidate fields, including the source, dimensions and SHA-256. Every indexed ID must appear in the deck catalog. When removing a printing from its last deck, remove the matching download entry. A bad index fails the build and produces an error response from the localhost card image route.

The Simplified Chinese copy uses the printed card wording when an applicable reference is available. For example, TCGdex's `CSMPiC-013`, `CSMPiC-014`, `CSMPiC-015`, `CSMPiC-026`, and `CSMPiC-031` were checked against the English printings for Gible, Gabite, Garchomp, Guzma, and Cynthia. TCGdex's language code alone does not identify a Simplified Chinese printing. Some card data served at `zh-cn` matches the `zh-tw` response, including printed Traditional Chinese text. Match by actual release and compare the effect against the English original before adopting text or terminology. Keep this research outside the runtime renderer, which uses local copy.

The [Traditional Chinese sample review](data/reviews/zh-Hant-100.json) and [catalog review](data/reviews/zh-Hant-catalog.json) record the Taiwan official printings and the copy fields checked against them. Some sample records include a TCGdex cross-check. Other copy fields use the project's Traditional Chinese terms and adapted Simplified Chinese copy. A readable rules reference can supply wording even when its scan is too small to register as an image. Names stay in the content catalog. The locale pack supplies card face copy and can use a printing-specific trainer body when the shared effect is worded differently.

The [Japanese](data/reviews/ja-catalog.json), [Spanish](data/reviews/es-catalog.json), and [Turkish](data/reviews/tr-catalog.json) reviews record the sources used for individual fields. The Japanese review also includes the printing crosswalk checked against the Pokémon TCG AI Battle Challenge data. Japanese uses the official card catalog, the challenge data, API metadata, and community transcriptions. Spanish uses the European Spanish TCG Live copy, TCGdex, and Pokédex data. Where matching references were unavailable, the packs use direct English translations authored before the build. Turkish uses those translations with the project's established names and terminology. Image downloads continue to use external source links.

## Add a printing or a language

- **Names and shared labels** come from [the content name catalog](../../public/content-i18n/) and [game strings](../../public/i18n/). Use printing overrides for names that vary by printing. A name used inside body text can be referenced as a variable. Keep category labels specific to the printed card face in the locale packs.
- **English scan layout** lives in [layouts.json](data/layouts.json), keyed by printing ID. Use a shared profile for a matching layout. A bespoke printing can provide erase regions, the coordinate grid, source icon crops, text styles and positions. Store unlocalized numeric facts and measured species data alongside that printing. An erase region uses x, y, width, height, mode, threshold and dilation. The outlined mode detects dark text with a white edge and uses the surrounding edge direction to reconstruct the underlying image.
- **Additional Trainer and Energy printings** use [scan-layouts.json](data/scan-layouts.json). The shared scan profiles position the title, category, effect and rule text using the printing's geometry. The locale pack supplies each effect and uses the project name catalog for the title.
- **Shared effects** in [effects.json](data/effects.json) define the numbers and required inline icon tokens for matching printings. The [locale packs](data/locales/) provide the full printed effect and rules, category labels, and per-printing flavor text or legacy text segments. Values such as `{a}` and `{icon.lightning}` are supplied at render time. If a reprint changes its effect, use a distinct effect entry. Keep the card text draft with its printing or shared effect so it can be reviewed independently of the interface's gameplay summaries.
- **Sample groups** in [cohorts.json](data/cohorts.json) control batch exports. A supported printing can be generated directly by ID regardless of sample group membership.

Existing emblems such as ex and VMAX, attack cost icons, and the fine print use the scan or a crop of it. Classic layouts redraw the printed level and Pokédex number in the original notation. If the card has flavor text, the numbers follow the translated description. Classic layouts retain the English `TRAINER` heading and the inline attack name. Bespoke layouts can define paragraph boxes for text that wraps around inline symbols and headings that place an original emblem after the measured text. The `sm12-156` layout uses both for its GX attack. Check the layout at full size when adding a locale.

The [Pokémon profiles](../../public/card-image/pokemon.js) share styles by card frame. Their [printing geometry](data/pokemon-layouts.json) records positions of English text and reserved areas for headings, body, labels and rule text. This batch used local OCR to derive the positions in a 245 × 342 coordinate grid. The final image keeps the scan's aspect ratio. Render-time inputs are the reviewed geometry, the deck data and the locale pack. Ability and attack paragraphs flow in their reserved areas. On modern frames the ability heading clears the full printed tab, including its border. A printing's `inlineIcons` entries select round, dark ink, light ink, or outlined source symbols. The renderer erases each source box and any additional occurrences in `erase` before placing the symbols inline. Chinese counts, icons and their associated nouns wrap together. V and VMAX rule text uses two localized lines in the corresponding source positions.

For VMAX printings, `vmaxForm` records the form label key and the colors of the original badge. The localized label uses the shared slant, outline thickness and baseline for the printed strip.

On classic frames the renderer detects the artwork and flavor-box edges to constrain repairs and keeps horizontal divider lines out of the repair and its background samples. On printed text over relatively even surfaces, the ink masks use local contrast for both dark and light letters. For ex and V name strips the renderer isolates the original mark and places it after the measured localized title. If the outline cannot be isolated reliably, the original mark stays at its printed position.

Run `npm run test:i18n` to check both Chinese locales against the deck catalog, then render and review changed printings at full size.

Trusted legacy recipe modules can still be passed through `--recipe`, with `--input` for scans outside the project.

## Cache and measure

The browser keeps one generated image per language and printing in IndexedDB. An image is reused when its individual recipe, English scan and renderer versions match. The desktop build and localhost server hash their local scans. The hosted game hashes the scan returned by the CDN or the browser's HTTP cache. When a recipe manifest loads, the browser removes obsolete generated entries for that language. Hosted scan changes are checked when the card is next loaded. The browser also removes legacy generated keys when it opens the cache. Verified downloads remain keyed by their reviewed SHA-256.

The cache has two layers under `.cache/card-localization`. The prepared background uses the English scan bytes, erase and cutout definitions, and the renderer revision. The final image additionally uses the resolved language, copy, layout, font and output parameters. Changing only a language or its text can reuse the prepared background. Concurrent requests coordinate on disk and completed files are published atomically. Set `TCG_CARD_IMAGE_CACHE` or pass `--cache-dir` to change the root. Bump `TCG_CARD_FONT_REVISION` when changing the worker's installed fonts or rendering toolchain. Old versions can be removed from the cache directory.

```sh
node scripts/localize-card.mjs all --group initial --benchmark 5 --format webp
```

The benchmark bypasses both disk caches and reports the median and P95 for local conversion and for rendering with a prepared background. It excludes scan retrieval, request queueing, startup and authoring time. Compare with a normal batch run and its repeat to measure the cold and warm cache paths in the intended deployment environment.
