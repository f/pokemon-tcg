# Chinese offline fonts

- Simplified Chinese: [LXGW 975 Yuan SC](https://github.com/lxgw/975Yuan), 400W and 700W.
- Traditional Chinese: [Chiron GoRound TC](https://github.com/chiron-fonts/chiron-go-round-tc), Regular 400 and ExtraBold 800.

These are full character sets, not subsets of the currently translated UI text.
The upstream fonts were converted from TTF to WOFF2 without editing glyphs,
names, or character coverage. The game uses Nunito before the Chinese body face,
and Baloo 2 before the Chinese display face, to preserve its Latin typography.
Static font faces are declared with their actual weights in `../../chinese-fonts.css`.
The browser chooses the nearest available face for intermediate bold weights.

`manifest.json` records original source URLs, versions, character and glyph counts,
SHA-256 hashes of the original TTFs and of the packaged WOFF2s, and converter versions.
To reproduce a conversion, download the exact original TTF from the recorded URL,
verify its `sourceSha256`, and use an isolated Python environment with
`fonttools[woff]==4.60.2` and `brotli==1.2.1`:

```python
from fontTools.ttLib import TTFont

font = TTFont("original.ttf")
characters = font.getBestCmap()
font.flavor = "woff2"
font.save("converted.woff2")
assert TTFont("converted.woff2").getBestCmap() == characters
```

The included OFL license files are copied unchanged from their respective upstream
projects. Both `scripts/build-dist.mjs` and `scripts/build-web.mjs` copy this directory,
including the licenses, into their outputs. Fonts load from local relative URLs;
changing the UI language does not require a font CDN.
