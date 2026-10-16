# Home Buying Planner

A small web app for testing whether (and how) to buy a home: build funding scenarios, see future cash flow, savings and net worth month by month, and compare up to three scenarios with a recommendation. Works the same on desktop and mobile browsers. No server, no account; data stays in your browser until you export it.

## Run it on your PC

**Easiest:** double-click `index.html`. It opens in your browser and works offline.

**Or with a local web server** (handy if your browser restricts local files):

```
cd home-planner-app
python3 -m http.server 8080
```

Then open http://localhost:8080. To try it on your phone over the same Wi-Fi, open `http://<your-PC's-IP>:8080`.

## Deploy later

It is a plain static site (HTML, CSS, JS; Chart.js is bundled in `vendor/`). Upload the whole folder to any static host: GitHub Pages, Netlify, Cloudflare Pages, Vercel, or an S3 bucket. Nothing to build.

Each browser/device keeps its own copy. To keep PC and phone in step, turn on **Data → Sync with GitHub** (below), or move data by hand with **Export all planners** / **Import from file**.

## Sync with GitHub (secret gist)

1. Create a GitHub token with only the `gist` scope: https://github.com/settings/tokens/new?scopes=gist&description=Home%20Buying%20Planner (pick an expiry, Generate, copy it).
2. In the app open **Data → Sync with GitHub**, paste the token and press **Connect**. The first device creates a secret gist named `home-planner-data.json`; on other devices the same token finds it automatically.
3. After that every change is saved to the gist a few seconds later, and the app pulls the latest version when it starts or when you come back to the tab. If two devices changed at once, it asks which version to keep. Every save is a gist revision, so older versions can be recovered from the gist's Revisions page.

Notes: a secret gist is unlisted, not private; anyone with its link can read it, so don't share the link. The token is stored only in that browser's localStorage and only sent to api.github.com. Disconnecting removes the token from that browser.

## How to use it

1. **Create a planner** (e.g. "Buying the rented flat") and pick the currency.
2. **Profile**: fill in your income, expenses, current rent, Home 1, Home 2 (loan + remaining builder demands), savings and investments, and the flat you want to buy. Fields marked * are required; the rest have suggested defaults (shown as *auto*) that you can override. You can type amounts like `1.5cr`, `45L`, `60k`.
3. **Create starter scenarios**: Buy using savings, Buy by selling Home 1, Keep renting. Or use **New scenario** to pick a template.
4. **Editor**: open a scenario and change anything. Changes apply only to that scenario and are marked *changed* (↺ resets to the profile value). The **Quick what-if** sliders and every input update the numbers and charts live. **Save** overwrites, **Save as new** keeps the original and stores the tweak under a new name. Names are generated from the settings unless you type your own.
5. **Compare**: tick up to three scenarios to get a recommendation, a side-by-side table (best value highlighted), charts and a year-by-year table.
6. **Data**: switch between multiple planners, rename/duplicate/delete them, export/import backup files, reset everything, and choose light/dark theme.

## What the model assumes

- Monthly projection from the start month for the chosen number of years.
- Salary (in-hand) rises every year in the hike month; the bonus is paid once a year in the bonus month and grows at its own rate.
- Expense lines grow every January at their own rate (blank = general inflation). Lines marked *Investment (SIP)* are counted as outflows but added to the chosen investment.
- Current rent rises at the renewal month and stops the month after you buy the new flat (or at Home 2 possession if you choose "move in" and don't buy).
- **Home 2 loan**: bank-paid builder demands are added to the loan when disbursed. In *full EMI* mode the EMI is recalculated on the amount disbursed so far over the remaining tenure (so it climbs to its peak at the last disbursement). In *pre-EMI* mode you pay interest only until possession, then the full EMI starts.
- **New flat**: stamp duty/registration, loan processing fee and other costs are paid upfront with the down payment. The EMI starts the month after purchase. If you sell Home 1, its value at the sale month minus selling costs and your capital gains tax estimate is used first; any extra is invested.
- Monthly surplus fills your cash up to the "cash to keep aside" buffer, then goes into your first investment. Shortfalls are taken from cash, then investments in the order listed. If everything runs out, the app flags a shortfall.
- Property values grow at their appreciation rates. Net worth = cash + investments + property values − loans.
- **Buy vs keep renting** compares each buying scenario with the same inputs without the purchase and splits the difference into rent saved, Home 1 rent and growth given up, purchase costs, loan interest, maintenance, new-flat appreciation and investment returns.
- **Recommendation**: scenarios that never run out of savings and keep your safety-buffer months rank first; among those, the highest net worth at the end wins. It is a guide based on your assumptions, not financial advice.
- Taxes: enter income and rents after tax. Home-loan tax deductions are not modelled; if they matter, add them to "Other monthly income".

## Files

- `index.html` – the page
- `css/app.css` – styles (light and dark)
- `js/engine.js` – the calculation engine (no UI; also runs in Node for testing)
- `js/schema.js` – the input form definition and what-if sliders
- `js/charts.js` – chart helpers
- `js/sync.js` – optional GitHub gist sync
- `js/app.js` – screens, storage, import/export
- `vendor/chart.umd.min.js` – Chart.js 4.4.4 (MIT licence)

Data is stored in the browser's localStorage under the key `homeBuyingPlanner.v1`. Export files are JSON (`"app": "home-buying-planner"`).
