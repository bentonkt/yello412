# yello412.com

Marketing site for Yello 412. Plain HTML, CSS and JavaScript, with a tiny build step and Cloudflare for hosting. No framework, no runtime dependencies.

## Run it

Needs Node 20 or newer.

```bash
npm install          # only installs wrangler (Cloudflare's CLI)
npm run preview      # builds, then serves http://localhost:4120
```

`npm run dev` runs the same site inside Cloudflare's local runtime, with the real security headers.

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

- [ ] Set `demoNumber` once the demo line is live.
- [ ] `ryan@yello412.com` actually receives mail (step 4 above).
- [ ] Read `src/privacy.html` and confirm it matches how the line really works: 30-day deletion of recordings and transcripts, call summaries kept while the business is a customer, weekly summary text, emergency call, and the vendor list (Retell, Twilio, Cloudflare). Twilio's texting registration asks for this page's URL. It's a plain-language draft, not legal advice.
- [ ] Open the site on a phone and click every link.

## Files

```
site.config.json      numbers, prices, email
src/index.html        home page
src/privacy.html      privacy and text-message terms
src/404.html          page-not-found
src/partials/         shared head, nav, footer
src/styles.css        all styles; brand tokens at the top
src/main.js           scroll effects (tape peel, ticker, reveals, phone steps)
src/fonts/            Archivo and Inter, self-hosted (SIL Open Font License)
src/img/              favicon, app icon, social share image (og.png)
scripts/build.mjs     fills in config values, writes dist/, robots.txt, sitemap, security headers
scripts/preview.mjs   local preview server
wrangler.toml         Cloudflare config
```

## How the scroll effects work

`main.js` writes a few CSS variables and the stylesheet animates from them:

- `--p` goes 0 → 1 while the hero is pinned. Each tape strip has `--a` (when it starts peeling) and `--d` (how long it takes). Placements are the `.tape-*` rules in `styles.css`; they were tuned so no strip covers the headline or the logo from 1180px to 2560px wide.
- `--sy` moves the two ticker rows.
- `--e` goes 0 → 1 as the yellow section and the demo section enter, for the yellow wipe and the hazard-stripe unroll.
- `.rv` elements fade in once they're on screen. `data-step` on `<html>` switches the phone screen in "How it works".

If a visitor's device asks for reduced motion, or JavaScript is off, everything shows in its finished state.

## Adding the phone-line backend here later

The architecture spec puts the backend (Retell webhooks, owner texts) in one Cloudflare Worker. It can be this one: add `main = "src/worker.js"` and `run_worker_first = ["/api/*"]` under `[assets]` in `wrangler.toml`, and the site keeps working as is.
