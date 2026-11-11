# yello412.com

The Yello 412 website and the demo line behind it. The site is plain HTML, CSS and JavaScript with a small build step. The home page sits on top of a 3D scene (a night-time Pittsburgh, drawn with three.js); browsers that can't draw it get the same page in its flat design. The demo line is a Retell voice agent plus a small Cloudflare Worker that texts the caller and alerts us. Everything deploys as one Cloudflare Worker.

## Run it

Needs Node 22 or newer (Cloudflare's CLI requires it).

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
| `textNumber` | The "Text us to start" number on the site's buttons, and the one the demo agent tells callers to text. |
| `contactName`, `contactCell`, `partnerName`, `partnerCell`, `contactEmail` | The names in "Who you're dealing with" and the privacy page contact. The two cells aren't shown anywhere; they only skip the demo line's daily call cap. |
| `priceLine`, `priceLineSite`, `trialLength`, `trialDays` | Prices and the free trial (`trialLength` is the wording, `trialDays` sets the first-charge day). |
| `cloudflareAnalyticsToken` | Optional. Paste the token from Cloudflare › Web Analytics to count visits (no cookies). |

Then rebuild (`npm run build`). Copy edits go straight into `src/index.html`.

## Deploy

```bash
npx wrangler login   # once
npm run deploy       # builds and publishes the Worker "yello412-site"
```

Then connect the domain. yello412.com is registered at Porkbun, and its email runs on Google Workspace (MX `smtp.google.com`). Moving the DNS has to bring the Google records along, or every @yello412.com inbox stops getting mail.

1. In Cloudflare, add the site yello412.com (free plan). Cloudflare copies the existing DNS records and gives you two nameservers. Fix the copied list before going on:
   - **Keep** Google's records: MX `@` → `smtp.google.com` (priority 1), TXT `@` → `v=spf1 include:_spf.google.com ~all`, and TXT `@` → `google-site-verification=…`.
   - **Delete** Porkbun's parking records: the A records on `@` (`207.207.210.x`), CNAME `www` → `uixie.porkbun.com`, and the wildcard CNAME `*` → `uixie.porkbun.com`. They point at Porkbun's link page and stop the Worker from taking the domain.
2. In Porkbun, turn DNSSEC off if it's on, then under Domain › Authoritative Nameservers replace Porkbun's with Cloudflare's. Wait until Cloudflare shows the site as Active (minutes to a few hours).
3. Uncomment the two `[[routes]]` blocks in `wrangler.toml` and run `npm run deploy`. That puts `yello412.com` and `www.yello412.com` on the Worker; Cloudflare makes their DNS records and certificates, so don't add A or CNAME records yourself. (The same by hand: Workers & Pages › yello412-site › Settings › Domains & Routes.)
4. Optional: Rules › Redirect Rules › the "Redirect from WWW to root" template, so `www` sends people to yello412.com instead of serving a second copy.
5. Point the demo line at the domain: empty `PUBLIC_URL` in `.dev.vars` and run `npm run agent` (see "The demo line").

**Email stays on Google Workspace.** Make `ryan@yello412.com` a Workspace user or an alias in Google Admin. Don't turn on Cloudflare Email Routing for yello412.com: it swaps Google's MX record for Cloudflare's and cuts Workspace off. The Worker's alert emails use Cloudflare Email Sending instead, which leaves the MX alone (see "The demo line", step 6). To keep mail out of spam folders, also turn on DKIM in Google Admin › Apps › Google Workspace › Gmail › Authenticate email and add the `google._domainkey` TXT record it gives you in Cloudflare.

## Before launch

- [ ] Set `demoNumber` once the demo line is live (see "The demo line" below).
- [ ] `ryan@yello412.com` actually receives mail (a Workspace user or alias, see Deploy).
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
src/main.js           section links, the call/text bar, scroll effects (tape peel, ticker, reveals, phone steps); loads the 3D scene
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

Behind the home page is a stylised Pittsburgh at night: the three rivers, the yellow bridges, downtown with its landmarks lit, the stadiums, the incline. The logo hangs over the Point as a giant speech bubble.

What a visitor sees:

- **Opening.** The city rises out of the ground. Three red beacons with job tags ("NO HEAT") come up one after another: calls nobody is answering. A call that goes unanswered flips its tag to "MISSED" before it fades.
- **The pick-up.** The bubble brightens and rings, the headline pulses with it, every waiting call turns yellow and sends a beam to the bubble, and the bridges come up to full brightness. On wide screens this happens a third of the way through scrolling the pinned hero. On phones it plays by itself about four and a half seconds in (or as soon as they start scrolling), because the hero scrolls away under the thumb.
- **Each section has its own camera shot**, and the camera rests on it while the section is being read.
- **How it works.** The phone turns as the steps change. At step 3 a beam leaves the bubble, lands on the phone, the phone buzzes once and the text message springs in.
- **The yellow section** floods out of the bubble once it has the window to itself and drains back before the next section.
- **The demo number** gets a beam from the bubble every few seconds and buzzes like a phone ringing.
- **Clicking or tapping the city** places a call from that spot.
- **A link to a far-off section** (How it works, Pricing) doesn't scroll there: yellow floods out from the link, the page and camera jump behind it, and it drains into the bubble. Short hops scroll as normal.

**When it runs.** A short script in the home page's `<head>` adds `html.gl` if the browser has WebGL 2 on a real graphics card, the visitor hasn't asked for reduced motion or data saving, and the address doesn't say `?3d=off`. `main.js` then loads `scene.js`, and the scene adds `html.gl-ready` once it's drawing. Every 3D style in `styles.css` sits under `html.gl` (the last section of the file).

**When it bows out.** The scene removes `html.gl`, and the page is the flat design again with the reader kept at the same place, if: the script doesn't load, a shader doesn't compile, the graphics context is lost and doesn't come back within five seconds, something throws, or the device can't hold about 23 frames a second. Before giving up on a slow device it lowers its own quality in steps (glow off, then fewer pixels). A steady 30 frames a second, which is what an iPhone in Low Power Mode gives, counts as fine.

**Two layouts.** *Side by side* (windows at least 1000px wide and 560px tall): copy on one side, the city on the other, hero pinned. *Stacked* (everything else): the city shows above each block of copy. The same media query, `(max-width: 999px), (max-height: 559px)`, is written in three places and they must agree: `styles.css`, `main.js` and `scene/index.js`.

**Files** (`src/scene/`, bundled with three.js into `dist/scene.js`, about 650 KB on disk and about 140 KB the way Cloudflare sends it, loaded after the page has painted):

| File | What it is |
|---|---|
| `index.js` | Starts everything, runs each frame, ties the scene to the scroll position, watches the frame rate, handles jumps and falling back. |
| `camera.js` | The list of camera shots, one per section. **Edit this to reframe a section.** |
| `geo.js` | The map: where the rivers, hills and street grids are, and where the bubble hangs. |
| `city.js` | Where each building stands; the hand-placed landmarks and how each is lit. |
| `world.js`, `shaders.js` | Ground, water, buildings, bridges, stadiums and lights, and the code that shades them. |
| `bubble.js` | The speech bubble and its rings. |
| `calls.js` | The calls: beacons, beams and job tags. The jobs on the tags are the `JOBS` list at the top. |
| `dom.js` | The parts in the page itself: the phone that turns and gets the text, the cards that tilt. |

**Reframing a shot.** Each entry in `SHOTS` (`camera.js`) says where the camera is (`p`), what it looks at (`t`), the lens (`fov`), and how far to slide the picture sideways or up so it sits beside the text (`sx`, `sy`); `tall` overrides those in the stacked layout. To try values live, open the browser console on the preview and change `yello.scene.SHOTS[0].p`, then scroll a little. `yello.scene.replay()` plays the opening again.

**Class names the scene adds to the page** must not match a class the flat design already styles. Two bugs came from exactly that (`.buzz` and `.ring`). The scene's are: `gl-ready`, `gl-called`, `gl-fell`, `wait`, `got-text`, `glow`, `tilting`, `is-ringing`, and `on` (on `.gl-cut`).

**Before shipping a change to it:** look at the home page on a real iPhone, a laptop and an iPad. It has been checked in Chrome and in Safari's engine at those three sizes on a desktop graphics card, not on the devices themselves.

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
6. **Alert emails** (needs yello412.com on Cloudflare DNS, see Deploy). Turn on Cloudflare Email Sending for the domain:
   ```bash
   npx wrangler email sending enable yello412.com
   npx wrangler email sending dns get yello412.com   # check its records are in
   ```
   It adds its records under `cf-bounce.yello412.com` plus a `_dmarc` record, and leaves Google's MX alone. Don't use Email Routing for this: on yello412.com it would take over the MX from Google Workspace. Uncomment the `[[send_email]]` block in `wrangler.toml`, then:
   ```bash
   npx wrangler secret put ALERT_TO
   npm run deploy
   ```
   `ALERT_TO` is the inboxes that get alerts, comma-separated. Alerts come from `demo@yello412.com`; change it with `ALERT_FROM` in `wrangler.toml` (it has to stay on yello412.com). Until this is set up, each alert is written to the Worker log instead (`npx wrangler tail` shows it live), and every call is also in Retell's call history.
7. **Texts and the emergency ring (Twilio):** buy a Twilio number, put it in `wrangler.toml` as `TWILIO_FROM`, set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` as secrets, and in Twilio set that number's "A message comes in" webhook to `https://<your site>/api/twilio/sms`. Carriers block texts from business numbers until the number's texting registration (A2P 10DLC) is approved, and that registration asks for the privacy page URL. **Until it's approved, set `"textTheCaller": false` in `agent/demo-agent.json`, then run `npm run deploy` and `npm run agent`:** the agent then reads the text out loud at the end of the call instead of promising one. Once it's approved, set it back to `true` and run both again. The emergency ring is a voice call and works without the registration.
8. **Optional:** `npx wrangler kv namespace create DEMO_KV` and uncomment the block in `wrangler.toml` to stop duplicate texts and cap demo texts at 3 per number per day.

### Test it

- `npm test` checks the backend without any accounts.
- In Retell's dashboard, open the agent and use Test Audio to talk to it from your browser.
- Call the demo number from your phone. Run it 20 times before you print the number anywhere: the text should arrive within a minute every time, and the agent should never offer a time slot or a price.

The calls cost about $0.10 a minute in Retell, and each one is capped at 3 minutes.
