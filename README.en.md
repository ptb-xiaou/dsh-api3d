# dsh-api3d

[中文](README.md) · **English**

Wires the **API3D ([api3d.cn](https://api3d.cn))** relay into DeepSeek Harness as one
pi-ai route. The base URL, the API key and the outbound-compatibility switches all live
on the plugin's settings card — no file editing, no reinstall. The site address is already
baked into `lib/site.js`, so it works out of the box.

This is a **skeleton**: the core path (route survival + outbound fence + credential write +
settings card + key/model wizard) is complete and runnable. The four ops rows — balance /
usage / billing / health probe — have explicit seams waiting to be filled.

Once installed, a new **API3D** row appears in the sidebar right below **Plugins**: enter
your key once, tick the models the site serves, and you are done. See
[the key and model wizard](#key-and-model-wizard).

## Design tradeoffs

In one sentence: **the protocol, the model catalog and the reasoning tiers are
configuration, not code; the plugin exists only to make the relay actually accept the
request.**

- **No custom `LlmAdapter`.** Writing a provider adapter means reimplementing the whole
  harness ↔ pi-ai translation layer (the official one is ~1000 lines: context assembly,
  StreamChunk translation, replay state, context-overflow detection). Not worth it for a
  single site. So the route is **declarative**: one `llm-pi-ai.providers.api3d` entry in
  `cordis.patch.yml`, reusing the official adapter.
- **But declarative routes have two traps, and this plugin exists for them** (below).

### Trap 1: the profile patch layer replaces the whole route

A profile's own `llm-pi-ai.providers` patch is applied **after every bundle layer**, and the
loader merges one level deep: the patch's `config` is an **assignment**, not a deep merge,
so the entire `providers` dictionary is replaced. Any profile that ships its own provider
(the `desktop` profile that DSH itself distributes does) loses the route this plugin
declares.

The host half cannot observe when that happens, so it hooks the resolution:
`ctx.on('internal/config', …, { global: true })` puts the route back, then
`ctx.get('loader')` finds the `llm-pi-ai` entry and `entry.update({ config })` writes it
home.

> Why not write it once: the host profile's watcher re-reads the patch file seconds after
> startup and rolls a one-shot write back. It has to be re-applied on every resolution.

### Trap 2: baseURL is resolved per request, but the adapter cannot see this plugin's settings

Two namespaces. So the route's `baseURL` points at a host that deliberately does not exist
(`upstream.api3d.invalid`, an RFC 2606 reserved TLD), and the fence rewrites it to the real
address from settings on the way out.

The upside of that detour is that "switch data centre" becomes one write on the settings
card. The downside is that **the fence must be on the request path** for every real
endpoint — otherwise DNS fails loudly (deliberately loud: much better than silently
hitting some real server).

The fence also carries the outbound compatibility a relay usually needs:

| Outbound compatibility | Why it is needed |
| --- | --- |
| rewrite baseURL | see above |
| optional `User-Agent` replacement | some sites authenticate by UA, while the adapter strips profile headers that conflict with its own attribution header |
| optional direct connection (bypass the process proxy) | site WAFs commonly challenge data-centre egress IPs and answer with 200 HTML instead of SSE |
| optional `required: []` fill-in | when the site forwards to a strict upstream, tool schemas without `required` are rejected |
| optional silent retry | relays forward across multiple channels, and some channels turn a retryable request into a 400 |
| 402 quota hint | sites report exhausted quota with 402 plus a JSON body mislabelled `text/event-stream` |

## Layout

| Path | Purpose |
| --- | --- |
| `lib/site.js` | **single source of identity constants**: package name, row id, provider name, sentinel host, default credential reference. Change this first when moving to another site |
| `cordis.patch.yml` | bundle patch layer: declares the `api3d` route and inserts the plugin row. **The model catalog is hand-written here** |
| `lib/index.js` | host half: fence, route survival, quota annotation, settings namespace |
| `lib/client.js` | browser half: settings card (base URL, API key, compatibility switches, reserved ops rows), sidebar entry, key/model wizard |
| `lib/route.js` | **generated** by `npm run gen-route`; `test/route-parity.test.mjs` keeps it from drifting away from the YAML |
| `lib/direct-fetch.js` | direct transport (`node:http`/`node:https`, bypassing the process proxy) |
| `scripts/gen-route.mjs` | generates `lib/route.js` from `cordis.patch.yml` and checks the sentinel host matches |
| `scripts/probe-models.mjs` | one real `GET {baseURL}/models` with a real key, to verify the site's actual catalog against what is declared |
| `test/` | 105 assertions, see below |

## Install and distribution

Install into a profile. [中文](README.md)

| Route | Command | Notes |
| --- | --- | --- |
| **GitHub** | `dsh plugin --profile web add github:ptb-xiaou/dsh-api3d` | `lib/` in the repo is the built artifact — there is no build step, so it runs as installed |
| **npm** | `dsh plugin --profile web add dsh-api3d` | lookup order: the registry configured in the profile, then `registry.npmmirror.com` |
| **tarball** | `dsh plugin --profile web add https://github.com/ptb-xiaou/dsh-api3d/releases/download/v0.1.0/dsh-api3d-0.1.0.tgz` | an absolute local `.tgz` path works too |
| **local path** | `dsh plugin --profile web add E:\path\to\dsh-api3d` | for development; install into an isolated instance, not into the one you are working in |

**Restart DSH afterwards**: the plugin row is part of the boot graph, so hot reload does
not pick it up.

Three facts verified on a clean instance (`DSH_HOME=E:\DSH\probe-home`) by installing the
tarball produced by `npm pack` through the real install path:

1. `add` appends `dsh-api3d` to that profile's `package.json`
   `dsh.profile.bundles` by itself — no hand-editing — and writes `dependencies` too.
2. The installed package is a **real directory** at
   `profiles/<profile>/node_modules/dsh-api3d`, and **it needs no `node_modules` of its
   own**: the host half's `import '@deepseek-ai/schemastery'` is routed by the profile's
   resolution layer to the copy the app ships. Only local development (plugin outside the
   profiles tree) needs host dependencies linked by hand — see
   [Development](#development).
3. The browser half is picked up as well: the HTML the instance serves lists `dsh-api3d`
   in its module manifest (`url: plugins/??dsh-api3d/client.js&rev=…`, with an `inject`
   list), and the startup log prints
   `api3d: 路由 api3d → https://api3d.cn/v1，模型目录 1 个（内置）：deepseek-v4.1-flash`.

About the **version compatibility gate**: the plugin manager checks every
`peerDependencies` entry whose name starts with `@deepseek-ai/dsh` against the running DSH
version and refuses the install when it does not match (unless an exact-version exemption
is granted in the profile's `compatibility.json`). This package only declares
`@deepseek-ai/cordis` / `@deepseek-ai/schemastery`, which the gate does not look at, so it
never blocks an install — at the cost of **no runtime version assertion**: if a major DSH
upgrade breaks the plugin, please open an issue.

> **Security note**: this package's host half runs inside the DSH process, is **not
> confined by the workspace sandbox**, and does receive your API key. Read `lib/index.js`
> before installing.

### Releasing (maintainers)

`lib/` (including the hand-written `lib/client.js` and the generated `lib/route.js`) is a
**committed artifact**, which is why `github:` installs need no build step.

- **npm**: `npm pack` was checked to contain exactly 11 files — 5 under `lib/` plus
  `cordis.patch.yml`, `README.md`, `README.en.md`, `LICENSE`, `NOTICE` and `package.json`
  (56.0 kB packed / 157.8 kB unpacked); `test/`, `scripts/` and `docs/` are kept out by
  the `files` allowlist. After `npm publish`, `add dsh-api3d` works. If the name is taken
  on npm, switch to a scoped name and update the commands in this document.
- **GitHub Releases**: upload the tgz `npm pack` produces, and users can install it with
  the tarball route above.
- Before tagging, run `npm test` (105 assertions) and `npm run gen-route` (to confirm the
  generated file has not drifted).

## Key and model wizard

After installing you do **not** have to know any field names first: a new **API3D** row
appears under **Plugins** in the sidebar; clicking it opens the wizard (it pops up
automatically the first time the panel is opened and no models have been imported yet):

1. Enter the site key (the base URL is pre-filled with `https://api3d.cn/v1`) and click
   **确认并查询模型** ("confirm and query models"). If you do not have a key yet, the line
   **"还没有 API Key？前往 api3d.cn 获取"** under the input opens the site's signup page in
   your system browser (the host treats it as an external link; it does not run an embedded
   window).
2. The host half takes that key to `GET {baseURL}/models` and lists the models the site
   actually serves.
3. Tick the ones you want and click **导入所选模型** ("import selected models").

Import does three things: writes the key into `$DSH_HOME/.credentials.yaml`, writes the
ticked catalog into this plugin's `models` setting, and has the host install that catalog
back into the `llm-pi-ai` route. The model picker sees them immediately, with no restart.

Why the query goes through the host: `api3d.cn`'s `/v1/models` returns no
`access-control-*` headers at all, so a direct browser request is blocked by the
cross-origin preflight with a 403. The two host routes behind the wizard are:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/api3d.models` | POST `{apiKey, baseURL?}` | query the site's model catalog host-side; returns normalized `{id, displayName}` |
| `/api/api3d.apply` | POST | install the catalog already stored in settings back into the `llm-pi-ai` route |

Both are registered on `connection.fetch`'s exact-route table, so they automatically carry
DSH's Host/Origin fence and browser session authentication; unauthorized requests never
reach the handlers.

The fields on the settings card still work (an equivalent entry point). The wizard just
automates "enter the key + pick the models"; the outbound compatibility switches (UA,
direct connection, schema fill-in, silent retry, quota hint) stay on the settings card.

This path has been run end to end in an isolated development instance with a real key
(enter key → query → tick → import):

| Step 1: enter the key | Step 2: tick models | Import done |
| --- | --- | --- |
| ![Entering the API key](docs/wizard-step1-key.png) | ![Ticking the models to import](docs/wizard-step2-models.png) | ![Import finished](docs/wizard-step3-done.png) |

After importing, restarting the development instance changes the log line from
`模型目录 1 个（内置）` to `模型目录 1 个（从站点导入）`, which proves the catalog really
was persisted and read back.

## Configuration

After installing, find the plugin on the **Plugins** page and fill in its settings card:

| Field | Default | Notes |
| --- | --- | --- |
| base URL `baseURL` | `https://api3d.cn/v1` | the site address, already filled in. **Clearing it explicitly is not "use the default": the fence stops rewriting, requests hit the sentinel host and DNS fails** |
| credential reference `apiKeyEnv` | `API3D_API_KEY` | the **key name** of where the secret is stored, not the secret. Must match `apiKeyEnv` in `cordis.patch.yml` |
| API key | — | a separate button writes it into `~/.dsh/.credentials.yaml`. Write-only; no read path ever fetches it back |
| imported catalog `models` | empty = built-in list | the JSON catalog written by the wizard, **not meant to be typed by hand**. Empty means use the one hand-written in `cordis.patch.yml` |
| User-Agent | empty | empty keeps the harness attribution header (recommended). Fill it only when the site explicitly demands a value |
| direct policy `directMode` | `auto` | `auto` = connect directly only when the process really has proxy variables set; `always` / `never` are for troubleshooting |
| fill tool schema | on | adds `required: []` to object nodes of outbound tool schemas |
| silent retry `silentRetry` | off | resend inside the plugin when the site rejects a request as an upstream transient error. Off by default: silently hiding a real 400 trades a visible error for a confusing empty turn |
| retry attempts `silentRetryAttempts` | 3 | including the first send, 1–10 |
| quota hint `quotaHint` | empty | text appended to a 402 quota-exhausted error. Empty disables it |

`claimRoute` (default on) and `announce` (default on) are not settings-card fields; change
them in `cordis.patch.yml` or in a profile patch.

### Moving to another site

(API3D's address and models are already filled in; read this only when switching site or
channel.)

The models currently declared come from a real check, not from guessing:

| Model id | Context | Max output | Reasoning tiers |
| --- | --- | --- | --- |
| `deepseek-v4.1-flash` | 1,000,000 | 384,000 | off / minimal / low / high / xhigh / max |

Measured on 2026-10-20: `GET https://api3d.cn/v1/models` returns only
`deepseek-v4.1-flash`, and sending `chat/completions` with the same key confirms it works.
**`deepseek-v4.1-flash-1017` on api3d.cn belongs to a welfare group and needs a different
key** (`SUB2API_ONLINE_WELFARE_KEY`); asking for it with the main key returns
`404 model_not_found`. A different group means different credentials, which should be a
separate provider route — it must not be merged into the same route's model list.

Verify before editing the catalog, and do not guess from the vendor name:

```bash
npm run probe-models                      # GET {baseURL}/models with $API3D_API_KEY
npm run probe-models -- --ref SUB2API_API_KEY   # or take a reference from the credential store
```

The script performs one read-only GET, diffs the site's self-reported ids against what the
patch layer declares, and prints a `models:` block you can paste. Once the check passes,
run `npm run gen-route && npm test`.

1. **The `models` list in `cordis.patch.yml`** — replace it with the model ids the site
   actually serves (`GET {baseURL}/models`). A hand-declared pi-ai route inherits nothing:
   capacity, reasoning tiers and the `compat` switches all have to be restated.
   **Without `models`, pi-ai tries automatic discovery against the sentinel host and is
   guaranteed to fail.**
2. **The spelling of `reasoningEfforts`** — the key is the tier offered by the picker, the
   value is the `reasoning_effort` actually sent. `off:` left empty = offer Off and do not
   send the field. Some sites demand an explicit `none` and reject `off`; fill in what you
   measure.
3. **`lib/site.js`** — only needed if you want to change the sentinel host, the default
   credential reference or the provider name. Afterwards you must run
   `npm run gen-route`, otherwise `test/route-parity.test.mjs` fails.

## Reserved seams: balance / usage / billing / health probe

The settings card already has four placeholder rows: **balance / usage / billing / health
probe**, currently rendering "not wired".

The seam's granularity is the **row**, not the number: `OPS_ROWS` defines which rows exist,
and all values go through `opValue`. Wiring real data touches `opValue` only, never the
layout.

Two implementation routes:

- **Management-plane only (do this first)** — if you have something like
  `GET /api/user/balance`, write a plain management-plane plugin: `Config` +
  `slots.register` card + one host-side polling fetch. No provider registration and no
  touching `globalThis.fetch`.
- **Remote service** — when the browser half needs on-demand queries, the host half extends
  `@deepseek-ai/dsh-typert-protocol`'s `TypertRemoteService`
  (`super(ctx, serviceKey, { namespace })` + `@Remote` decorated methods) and the browser
  half calls `ctx.remote.$mount(…)` itself. The constraints are strict: the descriptor's
  codec must be `mode: 'strict'` (otherwise `$mount` throws), host method parameters must be
  plain identifiers, and `signal` may only come last. `@deepseek-ai/dsh-typert-generator` is
  not installed on this machine, so descriptors have to be hand-written — which is why this
  skeleton does not do it yet.

## Development

```bash
npm run gen-route     # required after editing cordis.patch.yml
npm run probe-models  # verify the site's real ids before and after changing the catalog
npm test              # node --test "test/*.test.mjs"
```

Dependencies are **junction-linked to the host's `node_modules`**
(`@deepseek-ai/schemastery` / `js-yaml` / `react`), because harness packages must be the
host's **same instance** (`instanceof` safety) and cannot be installed as a real copy from
the registry. `@deepseek-ai/cordis` and `@deepseek-ai/schemastery` are declared as optional
peers.

Test coverage:

| File | Coverage |
| --- | --- |
| `route.test.mjs` | route survival: re-declared after the patch squeezes it out, state classification |
| `fence.test.mjs` | fence: rewriting, allowlist, pass-through of non-target requests, cleanup restoring only this plugin's fetch |
| `tool-schema.test.mjs` | `required: []` fill-in and skipping `strict: true` |
| `silent-retry.test.mjs` | transient-failure classification, backoff, attempt ceiling |
| `claim.test.mjs` | `entry.update` write-back |
| `direct-transport.test.mjs` | direct transport against a real loopback stand-in: header fidelity, no redirect following, abort tearing down the connection |
| `integration.test.mjs` | **end to end**: fence + direct transport really deliver the request to a TCP server; the boundaries of 402 quota annotation |
| `client-bundle.test.mjs` | browser-half loading contract: both halves' settings namespaces must be literally equal, six slots (including the sidebar entry and the `shell.overlay` wizard), dictionaries, the address and `target`/`rel` of the wizard's "get one at api3d.cn" link, and **the form controller keeping `this` when it is provided as prototype methods** (a real-machine crash regression) |
| `models.test.mjs` | the wizard's host half: catalog normalization, `discoverModels` failure classification, `applyImportedModels` write-back, registration and auth boundaries of the two `/api/api3d.*` routes |

## Known limitations

- **Single site.** Only one base URL is supported. For several sites use a generic gateway
  provider plugin.
- **Model catalog: built-in list + wizard import.** By default it uses the one hand-written
  in `cordis.patch.yml`; the wizard's catalog lives in the plugin's `models` setting (and
  therefore in the profile patch layer, so it survives a restart). The adapter's own
  automatic discovery is still unused — it would discover against the sentinel host and
  fail; see trap 2.
- **The key is written by the wizard.** The wizard writes it into `$DSH_HOME/.credentials.yaml`
  as `API3D_API_KEY`; you can also enter it by hand on the settings card or under
  Settings → Models → API3D, and the two paths are equivalent. The "clear key" button only
  appears once a key is configured.
- **Balance / usage / billing / health probe are not wired.** The seams are in place, see
  above.
- **`directMode: never` fails when the site's WAF blocks data-centre egress.** That is the
  expected behaviour.

## Origin and license

MIT. Derived from [aqiu817/dsh-llm-agentrouter](https://github.com/aqiu817/dsh-llm-agentrouter)
(MIT, Copyright (c) 2026 aqiu817) — the fence, route self-healing, silent retry, direct
transport and settings-card skeleton come from that project, restructured for the
single-site case with credential writing and the ops seams added. `LICENSE` stays the
standard MIT text (including the original copyright notice) while the derivation and
reference-implementation notes live in `NOTICE` — that way GitHub's license detection
still reports MIT without dropping the attribution.

The reference implementation [Luck9Star/dsh-gateway-provider](https://github.com/Luck9Star/dsh-gateway-provider)
(MIT, Copyright (c) 2026 Luck9Star) provided the "register a provider route at runtime"
route; this skeleton takes the declarative route instead, for the reasons at the top.
