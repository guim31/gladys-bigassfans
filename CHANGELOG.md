# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- One Gladys device per Big Ass Fans fan or light (Haiku, i6, es6, Haiku L),
  found automatically on the local network through Gladys, or by IP address.
  No account, no cloud.
- Only what the device has: on/off, the fan's auto mode, the 7 speeds,
  direction and Whoosh (natural breeze); the light (downlight or uplight)
  with its auto mode, brightness and white; temperature, humidity and
  occupancy sensors.
- Changes made with the remote, the wall control or the Big Ass Fans app show
  in Gladys at once: the integration keeps a connection open to each fan and
  queries it every minute.
- A scene trigger "Fan switched outside Gladys" (off, on or auto, from the
  remote, the wall control, the app or the fan itself).
- A scene action "Boost the fan for a while": a speed for some minutes, then
  back to how the fan was.
- A "Search for fans" button in the configuration, reporting the fans found
  and the addresses that do not answer.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-bigassfans/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-bigassfans/releases/tag/v1.0.1
