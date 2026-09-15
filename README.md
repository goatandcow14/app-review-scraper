# App Review Scraper — Mobile Setup Guide (Android, no computer)

4 files total, all in one flat folder — no subfolders, so uploading from a
phone is simple: `server.js`, `package.json`, `.gitignore`, this `README.md`.

---

## 0. Which of the 3 methods are we using? (you asked me to just pick)

**Method 2 — already built into server.js, already free, zero extra signup.**
It pages through the store itself and only stops once it has your target
number of matching (e.g. 1-3 star) reviews, or genuinely runs out. Nothing
left to decide or set up for this part — it's done. Don't touch Method 1 or
3 unless this one starts failing you regularly (see the honesty section at
the bottom for when that would be).

---

## Before you start

You need two free accounts, both usable entirely from your phone's browser
(Chrome or whatever your default is) — no apps to install:
- A GitHub account — github.com
- A Render account — render.com (sign up with your GitHub account, it's one tap and skips a separate password)

Do all of the following **in your phone's browser**, not inside any app.

---

## PART A — Put the code on GitHub (no git, no terminal)

**A1. Download the files from this chat onto your phone**
In this conversation, tap each of the 4 files I generated (`server.js`,
`package.json`, `.gitignore`, `README.md`) and save/download each one. On
Android they'll land in your **Downloads** folder by default — remember that.

**A2. Create the repository**
1. Open your browser, go to **github.com**, log in.
2. Tap the **+** icon (top-right corner of the screen, near your profile picture).
3. Tap **New repository**.
4. In "Repository name," type: `app-review-scraper` (or anything, no spaces).
5. Leave "Public" selected (simplest — Render's free tier reads public repos
   without extra setup).
6. Do **not** tick "Add a README file" — you're uploading your own.
7. Scroll down, tap the green **Create repository** button.

**A3. Upload the 4 files**
1. You're now on your new empty repo's page. Look for a link/button that says
   **"uploading an existing file"** (GitHub shows this on empty repos), or tap
   **Add file** near the top of the file list, then **Upload files**.
2. Tap the upload area — this opens your phone's normal file picker.
3. Navigate to **Downloads** (or wherever they saved), select all 4 files
   (tap each one — Android lets you multi-select, usually by long-pressing
   the first file then tapping the rest).
4. Once all 4 are attached, scroll down. There's a message box ("Commit
   changes") — leave the default text or type "initial upload."
5. Tap the green **Commit changes** button.
6. Confirm you now see all 4 files listed on the repo's main page.

You now have a working GitHub repo with no command line involved.

---

## PART B — Deploy it on Render (free)

**Reminder before you start:** Render's free tier sleeps after 15 minutes of
no traffic and takes 30-60 seconds to wake up on the next request. That's
normal, not broken — see the honesty section if it bothers you later.

1. Go to **render.com**, tap **Get Started** or **Log In**, choose **Sign in
   with GitHub**, approve the connection.
2. Once in your Render dashboard, tap the **New +** button (usually top-right
   or in a menu icon if the screen is narrow — if you don't see it, tap the
   menu/hamburger icon first).
3. Tap **Web Service**.
4. It will ask to connect a repository — find and tap **app-review-scraper**
   (the repo you just made), then tap **Connect**.
5. You'll land on a setup form. Fill in:
   - **Name:** anything, e.g. `app-review-scraper`
   - **Region:** pick the one closest to you
   - **Branch:** leave as `main`
   - **Runtime:** should auto-detect **Node**. If it shows a dropdown, pick Node.
   - **Build Command:** type `npm install`
   - **Start Command:** type `node server.js`
6. Scroll down to **Instance Type** — leave/select **Free**.
7. Scroll further to **Environment Variables**. Tap **Add Environment
   Variable**. In the "Key" box type: `MCP_API_KEY`. In the "Value" box,
   type a long random password of your own choosing — mix letters and
   numbers, at least 20 characters (this is your server's secret key —
   write it down somewhere safe right now, e.g. your Notes app, because
   you'll need to type it again in Part C).
8. Scroll to the bottom, tap **Create Web Service** (or **Deploy Web Service**).
9. You'll now see a black log screen with text scrolling — this is it
   building and starting. Wait until you see a line like
   `app-review-scraper listening on port 10000` or the status badge at the
   top turns to **Live**. This can take 2-5 minutes the first time.
10. Near the top of the page, you'll see your app's URL, something like
    `https://app-review-scraper-xxxx.onrender.com`. Tap/copy it.
11. Test it: open a new browser tab, go to
    `https://app-review-scraper-xxxx.onrender.com/healthz` — you should see
    the word `ok`. If it just spins for a while first, that's the free-tier
    wake-up — wait, don't panic.

Your MCP address for Claude is that same URL **with `/mcp` added on the end**:
`https://app-review-scraper-xxxx.onrender.com/mcp`

---

## PART C — Connect it to Claude

**Do this in your phone's browser at claude.ai, not the Claude Android app.**
Anthropic's own help pages currently say installing connectors from the
mobile app is still in beta, while the web version is the reliable path —
using claude.ai in Chrome on your phone gets you the full, working version
of this feature, even though you're still on your phone.

1. Open Chrome (or your browser), go to **claude.ai**, log in.
2. Tap your profile icon or the menu icon (varies slightly by screen size —
   look in a corner, usually top-left or top-right) to open the side menu.
3. Look for **Settings**, tap it.
4. Inside Settings, find and tap **Connectors**.
5. Look for a button that says **Add connector** or **Add custom connector**
   — tap it.
6. If it asks you to choose a type, tap **Remote**.
7. Fill in:
   - **Name:** `app-review-scraper`
   - **Server URL:** paste `https://app-review-scraper-xxxx.onrender.com/mcp`
     (your real URL from Part B, step 10, with `/mcp` on the end)
8. Tap **Advanced settings** (may be a small link or arrow you need to expand).
9. Find **Transport** — select **Streamable HTTP** if there's a choice.
10. Find the **Headers** section (sometimes labeled "Headers helper"). Add
    one header:
    - Key: `x-api-key`
    - Value: the exact same random password you set as `MCP_API_KEY` in
      Part B, step 7.
11. Tap **Add** (or **Save**) to finish.
12. You should now see `app-review-scraper` listed as a connector. Tap into
    it — under **Tools**, leave everything on "Ask each time" for now (safer
    while you're testing).
13. Start a **new chat** and try: *"Search Play Store for Notion and get me
    10 reviews for the top result."* Claude should ask to use the connector's
    tool — approve it, and you should get real review data back.

**If any label you actually see doesn't match what I wrote above** — tell me
the exact word you see instead, and I'll adjust. App UIs get redesigned
often; I sourced these steps from Anthropic's current help docs, not a
screenshot of your exact screen, so there's a real chance of small wording
drift even though the flow itself is correct.

---

## Honesty notes (still true)

- `google-play-scraper` is unmaintained upstream — works today, may break
  silently later if Google changes its page structure.
- App Store reviews cap at 500/app/country — Apple-side limit, not fixable here.
- I still can't run this code myself — no network in my sandbox. The
  `/healthz` check in Part B is your first real proof it's alive.
- Free Render tier sleeping after 15 min idle is the real cost of "free" —
  upgrade to the $7/mo tier later only if the wake-up delay actually annoys you.
- Don't screenshot or share your `MCP_API_KEY` value anywhere public — it's
  the only thing stopping a random stranger who finds your URL from running
  up your free-tier hours.
