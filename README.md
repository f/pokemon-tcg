# Pokémon TCG Academy

Learn the Pokémon Trading Card Game with real decks — 26 classic decks from 1999–2000 and 83 modern ones, up to the newest Mega Evolution decks — in **English, Turkish, Japanese and Spanish**.

- **Gary** is your opponent: he plays every move against you.
- **The Professor** is your coach: rates your options while you play, marks the best one, comments on the move you made and tracks your chances of winning.

Both think with the engine you pick: the built-in **CPU** engine, a decision model that runs on your own Mac (**[Kev](https://github.com/jaredpalmer/kev)**), or the hosted **Jev** model. With the CPU engine or a local model the game works fully **offline**.

## Install the macOS app

```bash
brew install --cask f/tap/pokemon-tcg
```

That's **Pokemon TCG** in your Applications folder (Apple Silicon, macOS 11+). The app has no title bar: drag the window by its top area. Everything it needs ships inside it (card images, fonts, icons), so it plays with no internet connection; Jev is switched off while you're offline and the CPU engine or your local model plays instead. Your Jev API key, if you use Jev, is kept in the **macOS Keychain**.

The app isn't signed with an Apple Developer ID; the cask clears the download quarantine for you. If you install the DMG from the [releases](https://github.com/f/pokemon-tcg/releases) by hand, right-click the app and choose **Open** the first time.

## Run the web version

You need Node 21.7+, and for local models [uv](https://docs.astral.sh/uv/) and an Apple Silicon Mac (or a CUDA GPU).

```bash
npm install
npm run images         # downloads the card images (and makes the WebP copies; needs `brew install webp`)
npm start              # → http://localhost:8787
```

## Build the app

```bash
npm install
npm run images
npm run app:build      # → src-tauri/target/release/bundle/dmg/Pokemon-TCG_<version>_aarch64.dmg
```

The app is a [Tauri 2](https://tauri.app) shell around the same `public/` folder (copied to `dist/` without the PNG originals). `src-tauri/src/main.rs` takes the place of `server.js`: it answers the game's `/api` calls, keeps the Jev key in the Keychain, and runs the local model server. `npm run app:dev` starts it in development mode.

## Decision engines

The engine is chosen in **Settings** (the gear button, or click the engine badge under the title).

| Engine | What it is | Needs |
| --- | --- | --- |
| **CPU** | A rule-based player that runs in the page. It also powers the Professor's ratings and the win meter. | Nothing; works offline |
| **Jev** | TypeSafe's hosted decision model | Internet and a Jev API key, entered in Settings: the app keeps it in the macOS Keychain, the web version in `.env` (never sent back to the browser) |
| **Local model** | An open decision model from Hugging Face, downloaded once and run on your Mac | [uv](https://docs.astral.sh/uv/), disk space and RAM for the model; then works offline |

Local models:

| Model | Download | Notes |
| --- | --- | --- |
| [Kev-0.8B](https://huggingface.co/jaredpalmer/kev-0.8b) | 1.8 GB | Fast, weaker reasoning |
| [Kev-4B](https://huggingface.co/jaredpalmer/kev-4b) | ~9 GB | Balanced |
| [Kev-9B](https://huggingface.co/jaredpalmer/kev-9b) | 19.5 GB | Strongest that fits a 32 GB+ Mac (recommended) |
| [Laya](https://huggingface.co/convaiinnovations/laya) | ~2.3 GB | Tiny encoder, near-instant, much weaker at game decisions |

The first time you pick a Kev model, [Kev](https://github.com/jaredpalmer/kev) is cloned and installed (the web server puts it in `../kev`, or `KEV_DIR`; the app in its Application Support folder), download progress shows in Settings, and the model runs on port 8009. Laya runs through `uvx`. The weights stay in the Hugging Face cache, so the web version and the app share them. While a model is downloading or loading, Gary plays with the CPU engine.

### Why these models

Kev is a family of open decision models (Apache-2.0) built on Qwen3.5 that speaks the same System One API as Jev: yes/no, choice and score questions, with calibrated probabilities. On its authors' held-out "new sources" benchmark, Kev-9B scores 0.82 / 0.85 (dev / test), against 0.86 for Jev. Smaller encoder models such as Laya and Von are much faster but scored far lower on reasoning-heavy decisions; Von is not offered because its own benchmark puts it well behind.

## Languages

English, Turkish (Türkçe), Japanese (日本語) and Spanish (Español): every screen, rule explanation, card effect explanation, deck description and the How to play page. Card, attack, Ability and deck names stay as printed on the English card images. Japanese and Spanish follow the official Pokémon TCG terms of those languages (バトル場, サイド, きぜつ… / Pokémon Activo, cartas de Premio, Fuera de Combate…). Switch with EN · TR · JA · ES in the header or on the home screen.

## Decks and rules

There are 109 60-card decks. The start screen has two tabs: **Classic** (26 decks from 1999–2000, played with the rules of that time) and **Modern** (83 Mega Evolution, Scarlet & Violet, Sword & Shield and Sun & Moon decks, played with today's rules). Classic decks:

- **Anime trainers:** **Ash**, **Brock** and **Misty**, built from the Pokémon each of them owns in the anime (e.g. Brock's Onix, Misty's Starmie).
- **1999 Base Set theme decks:** Brushfire, Overgrowth, Zap! and Blackout.
- **Jungle:** Water Blast and Power Reserve. **Fossil:** LockDown and BodyGuard.
- **Base Set 2:** Grass Chopper, Hot Water, Lightning Bug, Psych Out and Thunderstorm.
- **Team Rocket:** Devastation and Trouble (Dark Pokémon).
- **Gym Heroes:** Brock's Rock, Misty's Water, Lt. Surge's Lightning and Erika's Garden.
- **Gym Challenge:** Sabrina's Psychic, Koga's Poison, Blaine's Fire and Giovanni's Earth.

Modern decks:

- **30th Celebration (September 2026):** the Espeon ex and Umbreon ex Battle Decks.
- **Mega Evolution:** Mega Gengar ex and Mega Diancie ex Mega Battle Decks, and the Mega Lucario ex and Mega Greninja ex (Chaos Rising) League Battle Decks.
- **Rival Battle Decks:** Marnie and Steven.
- **Deluxe Battle Decks:** Meowscarada ex, Quaquaval ex, Ninetales ex, Zapdos ex, Koraidon ex and Miraidon ex.
- **ex Battle Decks:** Ampharos ex, Lucario ex, Chien-Pao ex, Tinkaton ex, Greninja ex, Kangaskhan ex, Houndoom ex, Melmetal ex, Victini ex, Miraidon ex, Tapu Koko ex and Iron Leaves ex.
- **League Battle Decks:** Miraidon ex, Gardevoir ex, Charizard ex, Dragapult ex and Team Rocket's Mewtwo ex.
- **Sword & Shield League Battle Decks (2020–2022):** Zacian V, Inteleon VMAX, Rapid Strike and Single Strike Urshifu VMAX, Ice Rider and Shadow Rider Calyrex VMAX, Mew VMAX and Origin Forme Palkia VSTAR.
- **Sword & Shield V Battle Decks (2021–2022):** Venusaur V, Blastoise V, Victini V, Gardevoir V, Rayquaza V, Noivern V, Lycanroc V, Corviknight V, Mewtwo V, Melmetal V, Zeraora V and Deoxys V.
- **Sword & Shield theme decks (2019–2020):** Rillaboom, Cinderace, Inteleon, Zacian, Zamazenta, Galarian Darmanitan, Galarian Sirfetch'd, Charizard and Drednaw.
- **Sun & Moon theme decks (2017–2019):** the 23 theme decks from Forest Shadow, Roaring Heat and Bright Tide to Lightning Loop and Battle Mind, including Let's Play, Pikachu! and Let's Play, Eevee!.

Modern decks only download their cards when you pick one. **Modern rules** apply automatically when both decks are modern:

- **Supporters:** only 1 per turn, and none on the first player's first turn.
- **Items:** any number per turn.
- **Pokémon Tools:** 1 per Pokémon, and they stay attached.
- **Stadiums:** 1 per turn.
- **Abilities:** they work even while the Pokémon is Asleep, Confused or Paralyzed.
- **Prize cards:** Pokémon ex, V, VSTAR and GX give up 2 Prize cards; Mega Evolution Pokémon ex, VMAX and TAG TEAM 3.
- **Once per game:** each player can use 1 GX attack and 1 VSTAR Power.
- **Also:** the Lost Zone, Ultra Beasts, Rapid Strike, Single Strike and Fusion Strike Pokémon with their own Energy, Stadiums and Trainers; Tera Pokémon take no damage on the Bench, the Burned condition, Ancient and Future Pokémon with their Booster Energy Capsules, Rare Candy, the Forest Seal Stone VSTAR Power, Technical Machines, and the Darkness, Metal and Dragon types.

The Sword & Shield and Sun & Moon theme decks use their exact lists from the dataset below. The other modern decklists (including the Sword & Shield V Battle and League Battle Decks) come from Bulbapedia, because the dataset has no Scarlet & Violet or Mega Evolution decklists. Their card data comes from the dataset, except four promo cards it doesn't have yet, which come from [TCGdex](https://tcgdex.dev). The 30th Celebration Battle Decks use the lists published by [Coded Yellow](https://www.codedyellow.com/30th-celebration-battle-decks-espeon-umbreon/), which name the cards but not their prints: the Pokémon are the 30th Celebration prints where that set has them (e.g. Eevee, Zeraora, Toxtricity), the rest are the newest Mega Evolution prints.

All official classic theme decks use their exact decklists from the [PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) `decks/` folder. Every card works as printed:

- **Attacks:** about 120 attack effects, from coin-flip variants and Bench damage to Metronome, Amnesia, Leech Life, Mirror Shell, Super Fang, Psychic Exchange and attacks that shuffle the Pokémon back into the deck.
- **Trainers:** 48 Trainers, including the Gym Leader cards (Blaine, Giovanni, Koga, Sabrina, Misty, Lt. Surge, Erika, Brock).
- **Stadiums:** the eight City Gym Stadiums. A Stadium stays in play in the middle bar and is replaced by the next one.
- **Pokémon Powers:** 14 Powers, such as Toxic Gas, Psylink, Energy Charge, Pollen Defense, Flee, Bench Guard and Energy Burn. The ones you activate appear in the move list under Pokémon Powers.
- **Special Energy:** Double Colorless Energy, Potion Energy and Full Heal Energy.

Each deck is one file, `public/data/decks/<deck>/cards.json`: its name, types and featured cards, then every card with its count, stats, image, how each attack works (`effect`), any Pokémon Power (`power.kind`) and what each Trainer does (`trainer`). `index.json` lists the decks in order, plus the order of the start screen's groups. To add a deck, add a folder and list it there.

Games use 6 Prize cards and today's turn structure, so the first player can't attack on their first turn. Base Set Trainers can be played without limit each turn, as they were in 1999. Confusion follows the modern rule: on tails, the attack fails and the Pokémon takes 30 damage.

## Coins and dice

- **Coins:** before the game you call heads or tails, and the coin decides who goes first. Every later coin flip opens an animated coin with the reason for the flip and what heads and tails each mean. When the coin lands, the outcome that applies is highlighted. Multi-coin attacks like Twineedle flip one coin at a time and keep a running count of heads.
- **Dice:** damage is shown with six-sided dice on the card, the way players track damage counters on a real table. Each pip is 10 damage, and a second die is added past 60. The dice roll whenever the damage changes.
- **Attached cards:** Energy cards, PlusPower and Defender are tucked under the Pokémon with a strip showing, like on a real table. Hover over a Pokémon to enlarge it and fan the tucked cards out. On Gary's side they peek out towards him.
- **Numbered dice:** damage dice come with pips or with printed numbers. Choose the style under Damage dice in the Coach panel. The How to play page has a chart of every face in both styles and the damage it stands for.
- **Drawing:** cards fly from the deck, or from a Prize card, into the hand. Yours flip face up on the way, and Gary's stay face down.
- **Bench and Trainers:** a Basic Pokémon flies from the hand to its Bench slot. When Gary plays a Trainer card it flips face up at centre stage with what it does, then goes to his discard pile (click to skip).
- **Prize cards:** pick a face-down Prize from a fanned row; it rises, spins and flips to reveal itself, then glides into your hand.
- You can turn the animations off with the toggle in the Coach panel.

## Attacks and the tutorial

- **Attack arena:** when either side attacks, both Active Pokémon rise from the mat into the middle of the board under a banner with the attack name. The attacker lunges into the defender with a burst in its type colour. Damage dice tumble onto the defender, the damage floats up with any Weakness or Resistance noted, and both cards go back to the mat. Coin flips show as a compact panel at the bottom, so the arena stays visible. Misses, blocked damage, recoil, bench damage and Poison are animated too.
- **Guided tour:** on your first game, a 13-step tour spotlights each part of the table (Active, Bench, hand, Prize cards, piles, Gary's side, turn bar, move list, card viewer, coach, log) and ends with how a turn works. You can replay it with the **Tutorial** button.
- **How to play** includes a numbered diagram of a real card, a worked example turn and a glossary, in all four languages.

## Playing

- **Drag and drop:** drag a card from your hand and only the places it can legally go light up (Energy → your Pokémon, evolutions → what they evolve from, Basic Pokémon → your Bench, Gust of Wind → Gary's Bench, Bill → a play zone). Drop it to make the move. Cards that can't be played show why. Clicking a move in the list still works.

## Layout and saving

- The table always fits the window with no page scrolling: cards resize to the window, and the hand overlaps when it gets full. Below 900px wide, the sidebar moves under the board.
- The game is saved to localStorage before every decision. Reloading the page resumes at your latest move. The save is cleared when a game ends or a new one starts.

## Testing

```bash
npm test
```

Runs the rules engine headless (no browser) on every deck:

- `tests/rules.mjs` — 257 hand-built board checks, one per card rule that changes a number or a legal move (Abilities, Tools, Stadiums, special Energy, Prize values, Supporter and Stadium limits…).
- `tests/prizes.mjs` — checks every Knock Out gives the right number of Prize cards (1, 2, 3, or 1 fewer with Shadowy Concealment).
- `tests/coverage.mjs` — thousands of bot games; reports any attack effect, Trainer, Ability, Stadium, Tool or special Energy that never ran, and checks every game keeps 60 cards per player.
- `tests/restore.mjs` — saves games mid-turn, restores them and plays them out.
- `tests/endless.mjs` — every deck pairing in both formats must finish (no stalled games).

```bash
npm run test:kev
```

Plays 40 full games with the local **Kev** model as the opponent (the model server on port 8009 that the game server starts; your Settings aren't touched). It reports model errors, illegal moves, crashes, card-count problems and which card rules came up. `node tests/model.mjs ping` checks that the model answers; `DECIDE_URL=<url>` points it at another model server.



- Card data and images come from the [Pokémon TCG API](https://pokemontcg.io) dataset ([PokemonTCG/pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data)). It lives in the per-deck files under `public/data/decks/`.
- Decklists are from Bulbapedia.
- UI icons are from [Lucide](https://lucide.dev) (ISC). Energy symbols are [Pokémon type icons by duiker101](https://github.com/duiker101/pokemon-type-svg-icons) (MIT). Fonts: Baloo 2, Nunito and Dela Gothic One (SIL OFL). All are copied into `public/vendor/` (by `scripts/vendor-assets.mjs`) so the game works offline.
- The code is MIT-licensed (see `LICENSE`). Pokémon, the Pokémon logo, card names, card text and the card images are © Nintendo / Creatures / GAME FREAK / The Pokémon Company. This is a fan-made, non-commercial learning tool and is not affiliated with or endorsed by them. The repository doesn't contain the card or logo images: `npm run images` downloads them from the public [Pokémon TCG API](https://pokemontcg.io) image service.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Static server, decision engine switching and local model process management |
| `public/data/decks/` | One folder per deck with its `cards.json`, plus `index.json` (deck order, groups, and summaries of the modern decks) |
| `public/img/` | Every card image (normal and large), the card back and logos, downloaded by `scripts/fetch-images.mjs` |
| `scripts/fetch-images.mjs` | Downloads the card images the decks use and points the deck files at the local copies (`node scripts/fetch-images.mjs`; safe to re-run) |
| `public/cards.js` | Loads the deck files into cards and decks for the engine |
| `public/engine.js` | Rules engine with no DOM code. The UI and the AI connect to it as controllers. |
| `public/engine-modern.js` | Modern (Scarlet & Violet) rules: Supporters, Tools, Abilities, multi-Prize Pokémon, modern Trainers and attack effects |
| `public/engine-mega.js` | Cards of the newest decks: Mega Evolution ex, Ancient/Future Pokémon, Burned, and their Trainers, Tools, Stadiums and Abilities |
| `public/engine-swsh.js` | Cards of the Sword & Shield decks: their Trainers (Leon, Nessa, Dan's Rock-Paper-Scissors…), Abilities and attack effects |
| `public/engine-swsh-v.js` | Cards of the Sword & Shield V Battle and League Battle Decks: Pokémon V/VMAX/VSTAR, a TAG TEAM-GX, Rapid/Single/Fusion Strike, and their Trainers, Stadiums, Tools and Special Energy |
| `public/engine-sm.js` | Cards of the Sun & Moon theme decks: Ultra Beasts, the Lost Zone, and their Abilities, Trainers, Stadiums and Tools |
| `public/ai.js` | Gary's controller: the CPU engine, and the state and questions sent to a decision model |
| `public/i18n.js` | Translation lookup (`t()`) and language switching |
| `public/i18n/en.js`, `public/i18n/tr.js` | All strings for one language each, plus its How to play page (Turkish also has its card texts) |
| `public/ui.js` | Playmat, hand, action list, coach and log |
| `public/api.js` | The game's backend calls: the Node server in the browser, the Rust side in the app |
| `public/i18n/ja.js`, `public/i18n/es.js` | Japanese and Spanish strings and How to play pages |
| `public/vendor/` | Local copies of the icons and fonts (offline) |
| `src-tauri/` | The macOS app: `tauri.conf.json` (window without a title bar, bundle), `src/main.rs` (engines, Keychain, local models), `icons/` |
| `scripts/build-dist.mjs` | Builds `dist/` (what the app ships) from `public/` |
| `scripts/webp-images.mjs`, `scripts/make-icon.py` | WebP card images; the app icon |
| `public/rps.js`, `public/rps.css` | The anime-style Rock-Paper-Scissors stage for Dan (the pick, the chant, the impact frame and the result) |
