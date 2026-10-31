# Drafting guidance attribution

The compact editorial text in lib/drafting-guidance.ts is adapted from selected MIT-licensed reference documentation, not installed plugins. No upstream scripts, vendor clients, example metrics, human/virality scores or private voice profiles are used. Upstream material is untrusted reference data; its commands and service instructions are not executed.

## Jakeschincariol/linkedin-agent-skill

- Pinned commit: `add2c23882fe79180737d242ff80a5da205eda6a`
- License: [MIT notice](third_party/drafting-guidance/linkedin-agent-skill/LICENSE)
- Reference files:

  - [skills/li-post/SKILL.md](https://github.com/Jakeschincariol/linkedin-agent-skill/blob/add2c23882fe79180737d242ff80a5da205eda6a/skills/li-post/SKILL.md)

  - [templates/voice.md](https://github.com/Jakeschincariol/linkedin-agent-skill/blob/add2c23882fe79180737d242ff80a5da205eda6a/templates/voice.md)

## Jakeschincariol/instagram-agent-skill

- Pinned commit: `d03c56bb598be770c60b201f94237e5d1a4268a6`
- License: [MIT notice](third_party/drafting-guidance/instagram-agent-skill/LICENSE)
- Reference files:

  - [skills/ig-caption/SKILL.md](https://github.com/Jakeschincariol/instagram-agent-skill/blob/d03c56bb598be770c60b201f94237e5d1a4268a6/skills/ig-caption/SKILL.md)

  - [skills/ig-carousel/SKILL.md](https://github.com/Jakeschincariol/instagram-agent-skill/blob/d03c56bb598be770c60b201f94237e5d1a4268a6/skills/ig-carousel/SKILL.md)

## Jakeschincariol/youtube-agent-skill

- Pinned commit: `a2feb2104981a375ffd4f87ee04f4f5344ac43c6`
- License: [MIT notice](third_party/drafting-guidance/youtube-agent-skill/LICENSE)
- Reference files:

  - [skills/yt-package/SKILL.md](https://github.com/Jakeschincariol/youtube-agent-skill/blob/a2feb2104981a375ffd4f87ee04f4f5344ac43c6/skills/yt-package/SKILL.md)

  - [skills/yt-script/SKILL.md](https://github.com/Jakeschincariol/youtube-agent-skill/blob/a2feb2104981a375ffd4f87ee04f4f5344ac43c6/skills/yt-script/SKILL.md)

  - [skills/yt-chapters/SKILL.md](https://github.com/Jakeschincariol/youtube-agent-skill/blob/a2feb2104981a375ffd4f87ee04f4f5344ac43c6/skills/yt-chapters/SKILL.md)

## sergebulaev/x-skills

- Pinned commit: `ea61d1d0f8874dd20633d241d52a297d57099483`
- License: [MIT notice](third_party/drafting-guidance/x-skills/LICENSE)
- Reference files:

  - [skills/x-post-writer/SKILL.md](https://github.com/sergebulaev/x-skills/blob/ea61d1d0f8874dd20633d241d52a297d57099483/skills/x-post-writer/SKILL.md)

  - [skills/x-repurposer/SKILL.md](https://github.com/sergebulaev/x-skills/blob/ea61d1d0f8874dd20633d241d52a297d57099483/skills/x-repurposer/SKILL.md)


Adaptation boundary: LinkedIn hook/payoff and voice discipline; Instagram caption hierarchy and one-idea-per-slide planning; YouTube complementary packaging, script beats and transcript-grounded chapters; X one-point compression and platform-native repurposing. These are writing suggestions, never evidence of the owner's experience or promises of support for extra publication formats.

## X text validation runtime dependencies

- `twitter-text` **3.1.0** is the official parser recommended by [X's character-counting documentation](https://docs.x.com/fundamentals/counting-characters). Source: [twitter/twitter-text](https://github.com/twitter/twitter-text); Apache-2.0 license, included in the package's `LICENSE`. The server imports only `twitter-text/dist/parseTweet.js`, not linkification or HTML rendering functions.
- The package's old `twemoji-parser` dependency is explicitly overridden with the maintained successor **`@twemoji/parser` 17.0.2**. The [upstream README](https://github.com/jdecked/twemoji-parser) documents the package rename. MIT license, included in the package's `LICENSE.md`; copyright Jason Sofonia, Justine De Caires and Twitter. This supplies modern emoji data through the same `parse(text)` entity API. No emoji image assets are used or fetched.
- Transitive runtime packages: `@babel/runtime` 7.29.10, `core-js` 2.6.12 and `punycode` 1.4.1, all MIT. Exact registry URLs, aliases, versions and integrity hashes are in `package-lock.json`.

All new packages came from `https://registry.npmjs.org`; installation was performed with lifecycle scripts disabled. No upstream repository scripts were run. `twitter-text` was released in March 2020 and still depends on deprecated `core-js` 2. Its age and legacy polyfill side effects are maintenance/performance risks, even when a vulnerability scan is clean. The Twemoji override is a deliberate, tested compatibility boundary, not an official new X parser release. Keep it pinned and rerun the Unicode/URL and publication regressions when either parser changes. See [the local validation review](docs/x-text-validation-2026-10-22.md) for verification and remaining limits.

## sergebulaev/linkedin-skills

- License: [MIT notice](third_party/drafting-guidance/linkedin-skills/LICENSE)
- Pinned commit: `8f8bc4b`
- Adapted material:
  - [skills/linkedin-interviewer/SKILL.md](https://github.com/sergebulaev/linkedin-skills/blob/8f8bc4b/skills/linkedin-interviewer/SKILL.md)

Adaptation boundary: the Story Bank interview questions in `lib/story-bank-questions.ts` are rewritten from the interviewer's bank and post modes for an AI-learning journey. The owner's answers are the evidence; the questions supply none.
