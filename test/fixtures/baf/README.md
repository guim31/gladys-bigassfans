# Big Ass Fans fixtures

Property sets of five kinds of device, as the integration decodes them from a
fan's answer to a query (`Properties` of `proto/aiobafi6.proto`, field names of
aiobafi6). The fake fan of the tests (`test/helpers/fakeFan.js`) serves them on
a real TCP socket, encoded with the integration's own codec.

**Reconstructed, not recorded.** No real dump of a fan's properties is
published (aiobafi6 and Home Assistant only test with mocks). Each file was
written from:

- the field numbers and units of aiobafi6's proto (temperature in hundredths of
  a degree, humidity in %, speed 0-7, light level 0-16...);
- the capability rules of aiobafi6 and Home Assistant: `has_light` or
  `has_uplight` for the light, `has_comfort1` and `has_comfort3` for Auto
  Comfort, API version 5 for occupancy, a humidity outside 1-100 % when the fan
  has no sensor (aiobafi6 drops it);
- the only real bytes available: the answer of a fan named "Living Room" in
  aiobafi6's `wireutils_test.py`, used as is in `test/proto.test.js`.

The model names (`Haiku H/I Series`, `i6`, `es6`, `Haiku L Series`) are
illustrative: the code never reads them. Addresses are in 192.0.2.0/24
(documentation range), MAC addresses in the locally administered `02:00:5e`
range, UUIDs and the Wi-Fi name invented.

| File                              | Device                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| `haiku-hi-downlight-comfort.json` | Haiku with downlight, Auto Comfort, sensors, occupancy (API 5)     |
| `haiku-hi-uplight-only.json`      | Haiku with uplight only, in auto mode, reversed, below 0 °C, API 4 |
| `i6-no-light.json`                | i6 switched off, whoosh on, sensors                                |
| `es6-basic.json`                  | es6 without Auto Comfort, humidity out of range                    |
| `haiku-l-light.json`              | Haiku L light without fan, white range 2200-5000 K, auto mode      |

Run `node scripts/probe.mjs <ip> --raw` on a real fan to replace a file with
recorded values (the private ones are masked).
