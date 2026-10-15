# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: none. The local protocol of the fans has no password nor key,
  and the integration asks for no account.
- **Stored in `/data`**: `bigassfans-state.json`, the fans seen so far: their
  UUID, IP address, name, model, firmware version and which features they
  have. Nothing else (the MAC address and the Wi-Fi network name the fans
  report are neither kept nor logged).
- **Network**: one TCP connection to port 31415 of each fan of the local
  network (the addresses found by the discovery or typed in the
  configuration). The mDNS browse (`_api._tcp`) is done by the Gladys core on
  the integration's behalf (manifest `network_discovery`). The integration
  opens no listening port and calls no cloud service.

Anyone on the local network can drive the fans the same way: the Big Ass Fans
local protocol has no authentication. This is how the fans work, not something
the integration adds.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the fans and the Big Ass Fans app, and the other devices of your network.
