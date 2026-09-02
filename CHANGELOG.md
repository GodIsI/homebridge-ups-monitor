## [1.19.0](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.18.4-beta.408...v1.19.0) (2026-09-02)

### Bug Fixes

* address PR [#242](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/242) review — empty replies, cross-UPS chart bleed, tab tests ([1b6a0d6](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/1b6a0d6fbda60ddef8698f7d628d54f648e05eec)), closes [#241](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/241)
* close three diagnostic-rendering and history gaps from [#241](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/241) ([7342a39](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/7342a3977c6c6f28caec9402f92f5f9d73d8cd23)), closes [#238](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/238) [#237](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/237)
* make dashboardScript.js's <script> extraction regex case-insensitive ([fca6837](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/fca6837999c11aff39be8293460b73c0234ddf80))
* surface NUT protocol errors with actionable diagnostics ([32c6773](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/32c6773fef7a9f9dc5ff53ade58acfce6be313e1)), closes [#237](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/237)

## [1.18.4-beta.408](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.18.3-beta.405...v1.18.4-beta.408) (2026-08-16)

## [1.17.1-beta.389](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.17.0...v1.17.1-beta.389) (2026-08-16)

## [1.16.9-beta.373](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.16.8-beta.370...v1.16.9-beta.373) (2026-06-27)

## [1.15.0](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.14.3-beta.320...v1.15.0) (2026-06-27)

## [1.14.3-beta.320](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.14.2-beta.317...v1.14.3-beta.320) (2026-06-06)

## [1.13.2-beta.308](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.13.1-beta.304...v1.13.2-beta.308) (2026-06-06)

### Bug Fixes

* harden telemetry route dispatch against unvalidated dynamic method call ([26dc7c8](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/26dc7c88f71b5191760bfd1f423720ac34e64ff3))
* refresh dashboard history rendering ([b3e881a](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/b3e881a9bc5dd158a92b7d94ae20e3e03d67841d))

## [1.12.2-beta.298](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.12.1-beta.292...v1.12.2-beta.298) (2026-06-05)

### Features

* add outage timeline ([802f18c](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/802f18c6c02d7d848dba3c37cfe6b81b1c2e4700))
* export outage timeline ([e642b5d](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/e642b5d278f7e5fee73f6f0db232f662268d330f))

## [1.11.8-beta.286](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.11.7-beta.283...v1.11.8-beta.286) (2026-06-04)

### Features

* **export:** add battery % and runtime to 30-day CSV ([0f56fff](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/0f56fff0e88826ee3c8c9db0c01fa341ff336888))

### Bug Fixes

* **dashboard:** draw real voltage instead of smoothing it away ([1249469](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/1249469f9bf1f09e1403b5e4334d334b2795a987))
* **lifecycle:** clean up poll timers and dashboard server on shutdown ([a3d0568](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/a3d0568805c1e42e648936a05fb1d77e09a87ad7))
* **poll:** validate interval and prevent overlapping polls ([ef487b7](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/ef487b79443e9fca362a6995639f192c815f90c6))

## [1.10.7-beta.257](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.10.6-beta.252...v1.10.7-beta.257) (2026-06-01)

### Bug Fixes

* use HAP-valid runtime tile name and repair cached accessories ([7629c80](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/7629c8029f3637cfaf9b92176f7d674a31daf275))

## [1.9.1-beta.224](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.9.0...v1.9.1-beta.224) (2026-06-01)

### Bug Fixes

* make storage writes lazy and migration safe across instances ([7ac8c27](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/7ac8c2755e3154527a0c9b2337cc22b245635eb0))

## [1.8.1-beta.218](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.8.0...v1.8.1-beta.218) (2026-06-01)

### Features

* reclaim history/CSV logs from previous storage location ([271af8f](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/271af8fb86eb574384ed6746d2d29a2124e45f09))

### Bug Fixes

* resolve storage path via api.user.storagePath() ([8525d4a](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/8525d4aedd0163dfe493589c6bded90fc5a9a341))

## [1.7.1-beta.211](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.7.0...v1.7.1-beta.211) (2026-06-01)

### Bug Fixes

* address Homebridge verification check failures ([8fefc13](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/8fefc13c6ad6db7e8afd395a3d69a579a9ed1a8e))

## [1.6.1-beta.203](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.6.0...v1.6.1-beta.203) (2026-06-01)

## [1.5.1-beta.197](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.5.0...v1.5.1-beta.197) (2026-06-01)

### Features

* NUT control commands — audible-alarm switch + low-battery threshold sync (opt-in) ([aef88fe](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/aef88fe9fe3e5c989503e13c8bdb87235b05f0a3))
* reactive dashboard link in settings UI (Feature 7) ([#91](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/91)) ([7a3d57f](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/7a3d57f4c47613c3a1e8fe689a24a4d2b2df3140))
* store data files in a dedicated subdirectory (Feature 10) ([#97](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/issues/97)) ([f2ecb1a](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/f2ecb1a50f57dfdf83a1ab7ea4fe1c541398a22b))

## [1.4.9-beta.184](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.4.8-beta.182...v1.4.9-beta.184) (2026-05-31)

### Features

* automate CHANGELOG from commits; align beta npm version with release tag ([9d62bf6](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/9d62bf64a1ac18c92ec41c64f7b9f5efef4e1756))
* validate standalonePort range in index.js with tests ([dd54a24](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/dd54a246e94109e64d5203dc0bfc4b86b96507d3))

### Bug Fixes

* render standalonePort as numeric input instead of slider ([28a7efe](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/28a7efebf35a3afa4e0da3961e77531037ca372e))
* set singular:true in config.schema.json ([cb1b3ef](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/cb1b3ef864f3745bcf730a29f1298575f56002dd))
* standalone dashboard config, chart time-range with 12h option, and ~24h history retention ([743ec8d](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/743ec8d60c9e35ec97c918e3ae46f9dc62277e79))
* standalone dashboard config, chart time-range with 12h option, and ~24h history retention ([8a5a841](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/8a5a84121b39445add8bcd4ae61fda61fbe27c5b))

## [1.3.5-beta.139](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.3.4-beta.77...v1.3.5-beta.139) (2026-05-30)

## [1.2.1-beta.68](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.2.0...v1.2.1-beta.68) (2026-05-30)

### Features

* **2b/2c:** add DailyLog for 30-day per-day CSV history ([cbe84e1](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/cbe84e13ffd5a7257b048ebcc32368e740d01a49))
* **3:** log export — CSV download from dashboard ([3cedd75](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/3cedd75f86515f4c8755eb38b23604badf960523))
* add ESLint (flat config, CI lint job, zero errors) ([65097ca](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/65097ca24eb7129cd6b47757ab926f76067f613d))
* Feature 4 — Export & Share with Web Share API ([9367a35](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/9367a356b089b0ac5ddee0b713bc949fda355dc2))
* npm publish on release + beta, add CI badge ([94a6236](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/94a6236f61a24e100dac212d6330607b3c932bec))
* standalone dashboard server (Feature 5) ([9b6e873](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/9b6e873e03fe2708c7e967b4f7a270fefd2b4765))

### Bug Fixes

* deploy.sh — use /var/lib/homebridge path and install UI dependency ([4f28a41](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/4f28a41686a061ebe9301bc096db6d82699210ee))
* pin @homebridge/plugin-ui-utils to ^2.0.0 (fixes Socket wildcard dep flag) ([01e5114](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/01e5114df972201345518403caefeecade393796))
* quote if-expressions in beta.yml and release.yml to fix YAML syntax error ([f5cae04](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/f5cae04262c1a5b8700d93ba41517f713b69b04a))
* replace getPluginConfig() with direct config.json read ([c250e19](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/c250e1948af5927d5454267ac8b17c8ff09c0add))
* use direct download on desktop, native share sheet on mobile only ([d8d059b](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/d8d059bea4a912e7e96425c6883de3732e40601b))
* use PAT_VERSION_BUMP for create-pull-request action ([19d8439](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/commit/19d8439aa139054fe329ebefca95a1522322a4b0))

## [1.0.0-beta.6](https://github.com/Plimmerton-Labs/homebridge-ups-monitor/compare/v1.0.0-beta.5...v1.0.0-beta.6) (2026-05-26)
