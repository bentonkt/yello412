# yello412.com

The Yello 412 website and the demo line behind it. The site is plain HTML, CSS and JavaScript with a small build step. The home page sits on top of a 3D scene (a night-time Pittsburgh, drawn with three.js); browsers that can't draw it get the same page in its flat design. The demo line is a Retell voice agent plus a small Cloudflare Worker that texts the caller and alerts us. Everything deploys as one Cloudflare Worker.

## Run it

Needs Node 20 or newer.

```bash
npm install          # wrangler (Cloudflare's CLI), three.js and esbuild
npm run preview      # builds, then serves http://localhost:4120
```

`npm run dev` runs the same site inside Cloudflare's local runtime, with the real security headers.

Add `?3d=off` to the address to see the flat design, or `?3d=force` to get the 3D scene on a machine without a graphics card.

## Change the phone numbers, prices or email

Everything that might change lives in `site.config.json`:

| Key | What it does |
|---|---|
| `demoNumber` | The demo line. While empty, the demo section says "Demo line opens soon" and points people to Ryan's cell. Any format works (`412-555-0100`). |
| `contactName`, `contactCell`, `partnerName`, `partnerCell`, `contactEmail` | The text-us numbers in "Who you're dealing with", and the privacy page contact. |
| `priceLine`, `priceLineSite`, `trialLength`, `trialDays` | Prices and the free trial (`trialLength` is the wording, `trialDays` sets the first-charge day). |
| `cloudflareAnalyticsToken` | Optional. Paste the token from Cloudflare › Web Analytics to count visits (no cookies). |

Then rebuild (`npm run build`). Copy edits go straight into `src/index.html`.

## Deploy

```bash
npx wrangler login   # once
npm run deploy       # builds and publishes the Worker "yello412-site"
```

Then connect the domain. yello412.com is registered at Porkbun:

1. In Cloudflare, add the site yello412.com (free plan). Cloudflare gives you two nameservers.
2. In Porkbun › Domain › Authoritative Nameservers, replace Porkbun's with Cloudflare's. Takes minutes to a few hours.
3. In Cloudflare › Workers & Pages › yello412-site › Settings › Domains & Routes, add `yello412.com` and `www.yello412.com`.
4. Set up Cloudflare › Email Routing so `ryan@yello412.com` forwards to Ryan's inbox. The site already shows that address.

## Before launch

- [ ] Set `demoNumber` once the demo line is live (see "The demo line" below).
- [ ] `ryan@yello412.com` actually receives mail (step 4 above).
- [ ] Read `src/privacy.html` and confirm it matches how the line really works: 30-day deletion of recordings and transcripts, call summaries kept while the business is a customer, weekly summary text, emergency call, demo-line texts, and the vendor list (Retell, Twilio, Cloudflare). Twilio's texting registration asks for this page's URL. It's a plain-language draft, not legal advice.
- [ ] Open the site on a phone and click every link.

## Files

```
site.config.json      numbers, prices, email
src/index.html        home page
src/privacy.html      privacy and text-message terms
src/404.html          page-not-found
src/partials/         shared head, nav, footer
src/styles.css        all styles; brand tokens at the top
src/main.js           scroll effects (tape peel, ticker, reveals, phone steps); loads the 3D scene
src/scene/            the 3D scene (see "The 3D scene" below)
src/fonts/            Archivo and Inter, self-hosted (SIL Open Font License)
src/img/              favicon, app icon, social share image (og.png)
scripts/build.mjs     fills in config values, bundles the scene, writes dist/, robots.txt, sitemap, security headers
scripts/preview.mjs   local preview server
scripts/agent.mjs     pushes the demo agent to Retell
agent/                demo agent prompt and settings
worker/               demo line backend and its tests
wrangler.toml         Cloudflare config
```

## How the scroll effects work

`main.js` writes a few CSS variables and the stylesheet animates from them:

- `--p` goes 0 → 1 while the hero is pinned. Each tape strip has `--a` (when it starts peeling) and `--d` (how long it takes). Placements are the `.tape-*` rules in `styles.css`; they were tuned so no strip covers the headline or the logo from 1180px to 2560px wide.
- `--sy` moves the two ticker rows.
- `--e` goes 0 → 1 as the yellow section and the demo section enter, for the yellow wipe and the hazard-stripe unroll.
- `.rv` elements fade in once they're on screen. `data-step` on `<html>` switches the phone screen in "How it works".

If a visitor's device asks for reduced motion, or JavaScript is off, everything shows in its finished state.

## The 3D scene

Behind the home page is a stylised Pittsburgh at night: the three rivers, the yellow bridges, downtown, the stadiums, the incline. The logo hangs over the Point as a giant speech bubble. Rooftops light up red with calls nobody's answering. Halfway through scrolling the hero, the bubble picks up: it brightens and rings, and each call turns yellow and sends a beam to it. From there the camera flies to a new view for each section, the yellow section floods out of the bubble, and in "How it works" a beam lands on the phone each time the text arrives. Clicking or tapping the city places a call from that spot. A link to a far-off section (How it works, Pricing, Hear the demo) doesn't scroll there: yellow floods out from the link, the page and camera jump behind it, and it drains into the bubble. Hops shorter than a screen and a half scroll as normal.

**When it runs.** A short script in the home page's `<head>` adds `html.gl` if the browser has WebGL 2 with a real graphics card, the visitor hasn't asked for reduced motion or data saving, and the address doesn't say `?3d=off`. `main.js` then loads `scene.js`, and the scene adds `html.gl-ready` once it's drawing. Every 3D style in `styles.css` sits under `html.gl` (the last section of the file). If the scene fails to load, loses its graphics context, or can't hold about 30 frames a second after lowering its own quality three times, it removes `html.gl` and the page is the flat design again.

**Files** (`src/scene/`, bundled with three.js into `dist/scene.js`, 640 KB on disk and about 140 KB the way Cloudflare sends it, loaded after the page has painted):

| File | What it is |
|---|---|
| `index.js` | Starts everything, runs each frame, ties the scene to the scroll position, watches the frame rate. |
| `camera.js` | The list of camera shots, one per section. **Edit this to reframe a section.** |
| `geo.js` | The map: where the rivers, hills and street grids are, and where the bubble hangs. |
| `city.js` | Where each building stands; the hand-placed landmarks. |
| `world.js`, `shaders.js` | Ground, water, buildings, bridges, stadiums and lights, and the code that shades them. |
| `bubble.js` | The speech bubble and its rings. |
| `calls.js` | The calls: beacons, beams and job tags. The jobs on the tags are the `JOBS` list at the top. |
| `dom.js` | The parts in the page itself: the phone that turns, the cards that tilt. |

**Reframing a shot.** Each entry in `SHOTS` (`camera.js`) says where the camera is (`p`), what it looks at (`t`), the lens (`fov`), and how far to slide the picture sideways or up so it sits beside the text (`sx`, `sy`); `tall` overrides those on phones. To try values live, open the browser console on the preview and change `yello.scene.SHOTS[0].p`, then scroll a little. `yello.scene.replay()` plays the opening again.

**Before shipping a change to it:** look at the home page on a real phone and on an older laptop, not only on a fast desktop. The scene was tuned on a desktop graphics card; the automatic quality steps are there for slower machines but haven't been tried on many.

## The demo line

Someone calls the demo number. The agent asks their business name and answers as their line while they play a customer. It takes the job, then steps out of character and answers questions about Yello 412. When they hang up:

1. they get a text with exactly what the owner would get (Twilio),
2. if it was an emergency, their phone rings with the emergency call the owner gets,
3. we get an alert email with the business name, their number and the job,
4. if they reply YES to the text, we get a "LEAD" alert email.

| File | What it is |
|---|---|
| `agent/demo-prompt.md` | What the agent says and does. Edit this to change the script. |
| `agent/demo-agent.json` | Voice, model, opening line, 3-minute cap, and whether to text and ring the caller. |
| `scripts/agent.mjs` | `npm run agent`: pushes the two files above to Retell and points the demo number at the agent. |
| `worker/index.js` | The backend: `/api/demo/save-job` (the agent's tool), `/api/retell/webhook` (call ended), `/api/twilio/sms` (replies). |
| `worker/worker.test.mjs` | `npm test`: checks signatures, the text, the alerts and the YES reply with fake requests. |

Prices, the trial and Ryan's number in the agent's answers come from `site.config.json`, so they always match the site.

### Set it up (once)

1. **Keys.** Copy `.dev.vars.example` to `.dev.vars` and fill in `RETELL_API_KEY` (Retell › API Keys, the key with the webhook badge). Twilio and the alert emails can wait.
2. **Demo number.** In Retell › Phone Numbers, buy a 412 number (or import a Twilio one). Put it in `site.config.json` as `demoNumber`.
3. **Deploy the backend** so Retell has somewhere to send requests:
   ```bash
   npx wrangler login
   npm run deploy
   npx wrangler secret put RETELL_API_KEY
   ```
   Note the `https://yello412-site.<you>.workers.dev` address it prints.
4. **Push the agent.** Put the workers.dev address in `.dev.vars` as `PUBLIC_URL`, then:
   ```bash
   npm run agent
   ```
   `npm run agent -- --url https://yello412-site.<you>.workers.dev` does the same for one run. Without either, the agent points Retell at `siteUrl` (yello412.com), and nothing answers there until the domain is connected to the Worker (see Deploy). Once it is, empty `PUBLIC_URL` and run `npm run agent` again.

   **Which command after a change:**
   - `agent/demo-prompt.md`, or `voiceId` and the other voice settings in `agent/demo-agent.json`: `npm run agent`.
   - `textTheCaller` or `ringOnEmergency` in `agent/demo-agent.json`, or anything in `site.config.json`: `npm run deploy`, then `npm run agent`. The Worker reads these files when it's deployed, so it keeps the old values until you deploy again. For example, if you turn `textTheCaller` on and only run `npm run agent`, the agent promises a text that the Worker never sends.
5. **Pick a voice:** `npm run agent -- --voices`, put the one you like in `agent/demo-agent.json` as `voiceId`, run `npm run agent` again.
6. **Alert emails** (needs yello412.com on Cloudflare, see Deploy). In Cloudflare › Email Routing, turn routing on and add each inbox that should get alerts under Destination addresses, then click the link in the verification email. Uncomment the `[[send_email]]` block in `wrangler.toml`, then:
   ```bash
   npx wrangler secret put ALERT_TO
   npm run deploy
   ```
   `ALERT_TO` is those inboxes, comma-separated. Alerts come from `demo@yello412.com`; change it with `ALERT_FROM` in `wrangler.toml`. Until this is set up, each alert is written to the Worker log instead (`npx wrangler tail` shows it live), and every call is also in Retell's call history.
7. **Texts and the emergency ring (Twilio):** buy a Twilio number, put it in `wrangler.toml` as `TWILIO_FROM`, set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` as secrets, and in Twilio set that number's "A message comes in" webhook to `https://<your site>/api/twilio/sms`. Carriers block texts from business numbers until the number's texting registration (A2P 10DLC) is approved, and that registration asks for the privacy page URL. **Until it's approved, set `"textTheCaller": false` in `agent/demo-agent.json`, then run `npm run deploy` and `npm run agent`:** the agent then reads the text out loud at the end of the call instead of promising one. Once it's approved, set it back to `true` and run both again. The emergency ring is a voice call and works without the registration.
8. **Optional:** `npx wrangler kv namespace create DEMO_KV` and uncomment the block in `wrangler.toml` to stop duplicate texts and cap demo texts at 3 per number per day.

### Test it

- `npm test` checks the backend without any accounts.
- In Retell's dashboard, open the agent and use Test Audio to talk to it from your browser.
- Call the demo number from your phone. Run it 20 times before you print the number anywhere: the text should arrive within a minute every time, and the agent should never offer a time slot or a price.

The calls cost about $0.10 a minute in Retell, and each one is capped at 3 minutes.
