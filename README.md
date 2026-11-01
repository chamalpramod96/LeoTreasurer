# Leo Treasurer

A small web app for the club's **monthly treasurer report**. Pick a month, enter the opening cash in hand and bank balance, record every amount received or paid during the month, and the app works out the closing cash in hand and bank balance, a balance summary, a per-project breakdown, a printable report and a CSV export.

Only the 8 executive-committee positions can sign in:

| Position | Access |
|---|---|
| President | View |
| Immediate Past President | View |
| Vice President | View |
| Secretary | View |
| Treasurer | Edit, finalize months, manage the committee list |
| Assistant Treasurer × 3 | Edit |

## Do we need a database?

Yes — a small one. GitHub Pages can only serve static files, so on its own it can't do logins or let 4 people save entries that everyone else sees. Keeping the data in the Git repo or a shared spreadsheet would mean either giving everyone write access to the repo or a weak login.

This app uses **Firebase** (Google) for that part:

- **Firebase Authentication** — email + password login, email verification, "forgot password".
- **Cloud Firestore** — stores the months and entries.
- **Security rules** ([`firestore.rules`](firestore.rules)) — enforced on Google's servers, so view-only members really can't edit, even with browser tricks.

The free **Spark plan** is more than enough (50,000 reads and 20,000 writes per day; a club uses a few hundred). No credit card needed, and unlike some free tiers it doesn't pause when idle between monthly meetings.

The website itself (HTML/CSS/JS) is hosted free on **GitHub Pages** from this repo.

## Try it now (demo mode)

While `js/config.js` has no Firebase settings, the app runs in demo mode with sample data stored only in your browser.

```bash
node tools/serve.mjs
```

Open http://localhost:8080 and pick any position to sign in as.

## Go live — one-time setup (about 20 minutes)

### 1. Create the Firebase project

1. Go to https://console.firebase.google.com and **Add project** (e.g. `leo-treasurer`). Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (leave "Email link" off).
3. **Build → Firestore Database → Create database** → *Production mode* → location `asia-south1 (Mumbai)` (closest to Sri Lanka; it can't be changed later).
4. **Firestore → Rules**: replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app (no hosting) and copy the `firebaseConfig` values into [`js/config.js`](js/config.js). Also set your club name there.

### 2. Add the first Treasurer

The Treasurer manages everyone else from inside the app, but the first one has to be added by hand:

1. **Firestore → Data → Start collection** → collection ID `members`.
2. Document ID: the treasurer's email in **lower case**, e.g. `treasurer@gmail.com`.
3. Fields: `name` (string) = `Leo Your Name`, `position` (string) = `treasurer`.

### 3. Publish on GitHub Pages

1. Commit and push this repo to GitHub.
2. **Repo → Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
3. After a minute the site is at `https://<your-github-username>.github.io/LeoTreasurer/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.

### 4. First sign-in

1. The Treasurer opens the site → **First time? Set up your account** → same email → chooses a password.
2. Clicks the verification link that arrives by email (check spam), then **I've verified — continue**.
3. Goes to **Committee**, fills in the name and email for the other 7 positions and presses **Save** on each row.
4. Each of them does the same "First time? Set up your account" step with their own email.

People not on the Committee list can't read anything, even if they create an account.

## Monthly workflow

1. **Months** → pick the month → **Start month**. Opening balances are pre-filled from last month's closing balances.
2. **Add entry** for every amount received or paid: date, project, income/expense, cash in hand or bank, amount, optional details and receipt/voucher number.
   - Depositing cash into the bank, or withdrawing it, is a **Transfer** — it moves money between cash and bank without counting as income or expense.
3. The balance summary and cash book update straight away, with running cash and bank balances after every entry.
4. At the end of the month the Treasurer checks the closing figures against the cash count and bank statement and presses **Finalize**. Assistants can no longer change a finalized month; the Treasurer can **Reopen** it.
5. **Print** gives a one-document treasurer's report with signature lines (choose "Save as PDF" to share it). **CSV** opens in Excel / Google Sheets.

## New committee each Leo year

The outgoing Treasurer replaces the emails on the **Committee** page. When the Treasurer position itself changes, the outgoing Treasurer enters the new Treasurer's email in that row last — they lose access as soon as they save. If nobody with Treasurer access is left, the Firebase project owner can fix the `members` collection in the Firebase console.

## Settings

[`js/config.js`](js/config.js): club name, currency symbol, number format and the month the Leo year starts (July).

## Project layout

```
index.html          page shell
css/styles.css      black / crimson / gold theme, mobile layout, print layout
js/config.js        Firebase config + club settings
js/app.js           screens: sign-in, months, cash book, committee
js/backend.js       Firebase (live) and localStorage (demo) data layers
js/lib.js           positions, month maths, money formatting, balance calculation
firestore.rules     server-side access rules
tools/serve.mjs     local preview server
assets/logo.webp    club logo
```
