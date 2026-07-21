# Asset Attribution

YiYi is a clean-room project. The files in `参考图/` are design references only and must never be embedded, cropped, or shipped as production assets.

## Current production assets

- YiYi mark and interface illustrations: original SVG/CSS implementation created in this repository for YiYi.
- Interface icons: Lucide, ISC License, https://lucide.dev/.
- System typefaces: iOS/macOS system font stack; no Apple font files are bundled.

## Style calibration v2 research assets

- `public/style-calibration/v2/*.webp`: six original pairwise calibration boards generated for YiYi with OpenAI built-in imagegen on 2026-07-19. Each board uses two faceless, identical matte-white mannequins in a controlled studio composition and contains no requested or visibly observed logos, brand marks, faces, hair, or third-party reference-image content.
- `public/style-calibration/v2/manifest.json` is the machine-readable provenance record. It includes the v2 concept pairs, dimensions, byte lengths, SHA-256 hashes, normalized audit reconstructions of the executed prompts, human-review status, and known bias flags. These controls reduce model, photography, and pose confounds; they do not make the synthetic calibration set bias-free.

## Style calibration v3 direction tracks

- `public/style-calibration/v3/womenswear/*.webp` and `public/style-calibration/v3/neutral/*.webp`: twelve original controlled pair boards generated for YiYi with OpenAI built-in imagegen on 2026-07-21, using YiYi's own v2 boards only as semantic/composition references. They preserve the six canonical A-left/B-right questions while providing womenswear and neutral/no-label presentation tracks. The existing v2 boards are retained as the menswear track; Mixed alternates womenswear and menswear deterministically.
- `public/style-calibration/v3/manifest.json` records track intent, dimensions, SHA-256 hashes, shared controls, human-review scope, and known remaining bias. The assets contain no requested or visibly observed text, logo, brand mark, face, hair, or third-party reference content.

## Demo wardrobe

- `public/demo-wardrobe/wardrobe-sprite.webp`: original AI-generated e-commerce-style clothing sprite created for YiYi with OpenAI image generation on 2026-07-17. The source was generated on a flat chroma-key background and converted locally to transparent WebP. It contains no copied reference-image content, logos, or third-party brand marks.
- `public/demo-wardrobe/white-sneakers-clean.webp`: original isolated white-sneaker demo asset generated for YiYi with OpenAI built-in imagegen on 2026-07-20, using YiYi’s own wardrobe sprite only as a subject/angle reference. It was generated on a flat chroma-key background, converted locally to transparent WebP, and reviewed to contain no baked floor/contact shadow, logo, text, or third-party brand mark.
- `public/style-calibration/style-grid.webp`: original AI-generated six-look style-calibration board created for YiYi with OpenAI image generation on 2026-07-17. It contains no copied reference-image content, labels, logos, or third-party brand marks.
- `public/style-calibration/style-grid-menswear.webp`: original AI-generated six-look menswear calibration board created for YiYi with OpenAI image generation on 2026-07-17. It uses the same restrained studio system, contains no copied reference-image content, labels, logos, or third-party brand marks, and is selected according to the user’s wardrobe direction.
