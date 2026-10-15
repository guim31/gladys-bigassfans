# Big Ass Fans for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[Big Ass Fans](https://www.bigassfans.com) ceiling fans and lights: Haiku (H/I
Series, with downlight, uplight or no light), i6, es6 and Haiku L lights,
driven over the local network with the protocol of the current Big Ass Fans
app. No account, no cloud.

> **Developed without the hardware: feedback welcome.** Everything was built
> from the protocol as the open-source library aiobafi6 and the Home Assistant
> `baf` integration describe it, and tested against a simulated fan on a real
> TCP socket, not against a real fan. Please report what works and what does
> not on the [Gladys forum](https://community.gladysassistant.com) or in the
> [issues](https://github.com/guim31/gladys-bigassfans/issues).

## Features

- **Automatic discovery**: Gladys captures the mDNS announcements of the fans
  (`_api._tcp`) for the integration. IP addresses can be typed for the fans
  automatic discovery does not reach.
- **One Gladys device per fan**, named as in the Big Ass Fans app, with only
  what the device has:
  - on/off, the fan's own auto mode, the 7 speeds;
  - direction (forward / reverse) and Whoosh (natural breeze), when the fan
    reports them;
  - the light (downlight or uplight): on/off, its auto mode, brightness, and
    the white in kelvins on the lights that report their range;
  - temperature, humidity and occupancy sensors, on the fans that have them.
- **Live**: the fans push their changes on the connection the integration
  keeps open (remote, wall control, app), and every property is queried once a
  minute.
- **Scene trigger** _Fan switched outside Gladys_: off, on or auto, from the
  remote, the wall control, the app or the fan itself — never for a change
  Gladys made, so a scene cannot loop.
- **Scene action** _Boost the fan for a while_: a speed for some minutes, then
  back to how the fan was (off, its speed or auto), unless someone changed it
  meanwhile.
- English, French, German and Spanish, in the interface, the feature names and
  the [documentation](docs/en.md) ([fr](docs/fr.md), [de](docs/de.md),
  [es](docs/es.md)).

## Requirements

- Gladys Assistant **5.1.0** or later.
- Fans set up in the current Big Ass Fans app, on the network of Gladys:
  Haiku with **firmware 3.0 or later**, i6, es6, Haiku L. Gladys must reach
  them on TCP port 31415.

## Installation

In Gladys, open **Integrations**, then **Install from GitHub**, and enter the
address of this repository:

```
https://github.com/guim31/gladys-bigassfans
```

Then open the **Discover** tab of the integration and add the fans. The
[documentation](docs/en.md) details the options and the scenes.

## How it works

- The protocol (from aiobafi6): protobuf messages framed with SLIP on a TCP
  connection to port 31415. A `Query` asks for every property; the fan answers
  in several `QueryResult` messages and then pushes each change; a `Commit`
  writes one property. The few messages are encoded by hand
  ([src/baf/proto.js](src/baf/proto.js)): no protobuf library in the 256 MB
  sandbox.
- The commands write the properties Home Assistant writes (`fan_mode`,
  `speed`, `reverse_enable`, `whoosh_enable`, `light_mode`,
  `light_brightness_level`, `light_color_temperature`), one commit each.
- The integration runs in an isolated container on a Docker bridge, which mDNS
  never reaches: the Gladys core browses `_api._tcp` for it (mediated
  discovery declared in the manifest) and relays the raw records; the
  integration reads their TXT entries (`uuid`, `model`, `api version`,
  `name`) and joins each fan in unicast TCP.
- **Push, plus a query every minute**: Gladys never polls these devices
  (`should_poll: false`, core issue #3198); `onPoll` is only a fallback that
  asks for a query. Unchanged values are published again every 6 hours.
- Each fan is identified by the UUID of its announcement (`dns_sd_uuid`), like
  Home Assistant: a fan that changes IP address keeps its Gladys device. The
  fans seen are kept in `/data/bigassfans-state.json`, so they are known at
  once after a restart, even switched off.
- What a device gets follows its capability flags and the properties it
  reports, never its model name (the rules of aiobafi6 and Home Assistant):
  a light from `has_light` or `has_uplight`, the temperature and occupancy
  sensors from Auto Comfort, occupancy from API version 5.

## Checked, and what was not

Checked:

- the wire format against the byte strings of aiobafi6's tests (including a
  real answer of a Haiku) and the messages aiobafi6 sends;
- five kinds of device (Haiku with downlight and sensors, Haiku with uplight
  only, i6, es6, Haiku L light), against the rules of the Gladys core (feature
  couples, bounds, units, poll frequencies) in the four languages;
- the whole integration against the fake Gladys of the SDK and fake fans on
  real TCP sockets: discovery, commands, pushes, trigger, boost, loss and
  return of a fan, DHCP change, restart.

Not checked, for want of hardware or of a Gladys instance:

- a real fan: the exact property sets each model and firmware reports, the
  name of the models, how a fan takes several commits in a row, whether it
  accepts several connections at once;
- the mDNS capture through a real Gladys core on a real LAN;
- the rendering of the devices and of the scene cards in the Gladys interface.

`scripts/probe.mjs <ip>` reads a real fan (one query, never a write) and prints
the Gladys device the integration would build from it, with the private values
masked: the first thing to run on real hardware.

## Limitations

- The former SenseME protocol (Haiku before firmware 3.0, UDP) is not
  supported.
- Sleep mode does not exist in this protocol; schedules, rooms, the Auto
  Comfort settings, the eco mode, the LED indicators and the beep are settings
  of the Big Ass Fans app and are not exposed. The RPM is not published.
- A boost in progress is not restored after a restart of the integration.
- The manual addresses must be IPv4 addresses (Home Assistant refuses IPv6
  fans too).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

`node scripts/fake-fan.mjs [fixture] [port]` runs the simulated fan of the
tests on 127.0.0.1, to try `scripts/probe.mjs` or the integration without a fan
(see [CLAUDE.md](CLAUDE.md)).

## Credits

- [aiobafi6](https://github.com/jfroy/aiobafi6) (Apache License 2.0, jfroy):
  the protocol, its message and field numbers (proto/aiobafi6.proto), the SLIP
  framing, the capability rules, and the real Haiku answer used as a test
  vector.
- The [Home Assistant Big Ass Fans integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/baf)
  (Apache License 2.0, bdraco and jfroy): the discovery, which properties to
  write, the speed and light conversions, which sensors to show.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is not affiliated with, endorsed by or connected to Big Ass Fans.
Big Ass Fans, Haiku, i6 and es6 are trademarks of their owner.

## License

[Apache License 2.0](LICENSE).
