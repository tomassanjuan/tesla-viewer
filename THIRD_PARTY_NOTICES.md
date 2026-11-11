# Third-party notices

I am not a lawyer; this file is a good-faith summary, not legal advice.

## Bundled third-party files
None. All files in this repository are original work under the [MIT License](LICENSE). No third-party source, fonts, images or icons are copied in (icons are inline SVG drawn for this project).

## Format references (not bundled)
Code here was written against, not copied from, these public references:
- [teslamotors/dashcam](https://github.com/teslamotors/dashcam): telemetry SEI protobuf schema.
- [XGxF3/tesla-dashcam-decrypt](https://github.com/XGxF3/tesla-dashcam-decrypt): reverse-engineered notes on the encrypted-clip layout used by the experimental decryptor.

## Runtime services
- **OpenStreetMap tiles** (opt-in, off by default): when enabled, the browser requests tiles from `tile.openstreetmap.org`. Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [ODbL](https://opendatacommons.org/licenses/odbl/). Tile use is subject to the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **dashcam.tesla.com**: only contacted if you use the optional key-fetch feature with your own token.

## Dependencies
Runtime: none (vanilla ES modules, no bundler).
Development only (not shipped to users): `@playwright/test` and `playwright-core`, licensed under Apache-2.0. Install with `npm ci` and see `node_modules/*/LICENSE` for the full text. Transitive dependencies are listed in `package-lock.json`.

## Trademarks
Tesla, TeslaCam and Sentry Mode are trademarks of Tesla, Inc. This project is independent and is not affiliated with, endorsed by or sponsored by Tesla, Inc. Names are used only to describe file formats and compatibility. OpenStreetMap is a trademark of the OpenStreetMap Foundation.
