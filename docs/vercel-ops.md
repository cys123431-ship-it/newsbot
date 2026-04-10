# Vercel Operations

This repository now supports two separate public deployment surfaces:

- Vercel: primary production surface for news freshness
- GitHub Pages: push-based backup surface

## Recommended Vercel Project Settings

- Repository: `cys123431-ship-it/newsbot`
- Branch: `main`
- Framework Preset: `Other`
- Install Command:
  - Leave blank and let Vercel auto-install from the repo root `requirements.txt`
- Build Command:
  - `python scripts/vercel_build.py`
- Output Directory:
  - `site-dist`

The repository-level `vercel.json` already contains the build/output settings and cache headers for `/assets`, `/data`, and `/generated`.

## Environment Variables

Mirror the static-build secrets already used in GitHub Actions.

- `NEWSBOT_TELEGRAM_API_ID`
- `NEWSBOT_TELEGRAM_API_HASH`
- `NEWSBOT_TELEGRAM_SESSION_STRING`
- `NEWSBOT_NAVER_CLIENT_ID`
- `NEWSBOT_NAVER_CLIENT_SECRET`
- `NEWSBOT_STATIC_MIN_ARTICLES_TO_PUBLISH`
- `NEWSBOT_STATIC_MAX_TOTAL_ARTICLES`
- `NEWSBOT_STATIC_FETCH_CONCURRENCY`
- Any other provider/API keys already required by the static build

Recommended `NEWSBOT_STATIC_ARCHIVE_URL`:

- `https://newsbot9.vercel.app/data/site-data.json`

Use the production URL as the single archive seed for both Vercel and backup builds. If the URL has no prior archive yet, the static build will still proceed without archive seeding.

## Deploy Hook + External Scheduler

Use a Vercel Deploy Hook instead of Vercel Hobby Cron.

1. In Vercel, open the project.
2. Go to `Settings -> Git -> Deploy Hooks`.
3. Create one hook named `news-refresh`.
4. Point it to the `main` branch.
5. Copy the generated hook URL.

Then configure `cron-job.org`:

- Method: `POST`
- Target URL: the Vercel Deploy Hook URL
- Interval: every 12 minutes
- Retry policy: enabled
- Timeout: keep the default unless your account plan requires a custom value

The deploy hook does not need a custom request body.

GitHub Actions should not own the Vercel freshness cadence. Keep GitHub Actions for:

- push-based GitHub Pages backup deploys
- manual backup rebuilds
- manual freshness diagnostics

## Verification Checklist

After the first deployment:

1. Open the Vercel production URL.
2. Confirm `/data/site-data.json` responds with a recent `generated_at`.
3. Confirm `/markets/crypto/` loads live Binance data normally.
4. Confirm a fallback manifest can be reached from:
   - `/markets/crypto/`
   - `/markets/crypto/signals/`
   - `/markets/crypto/multi-timeframe/`
5. Confirm the news hero timestamp is within roughly 15 minutes after a scheduled hook trigger.

## Failure Triage

If the news timestamp stalls:

1. Check the latest Vercel deployment log for `python -m newsbot.site_builder`.
2. Confirm all required environment variables are still present.
3. Confirm `cron-job.org` shows successful `POST` executions.
4. Confirm `NEWSBOT_STATIC_ARCHIVE_URL` still points to `https://newsbot9.vercel.app/data/site-data.json`.
5. Run `.github/workflows/news-freshness-watchdog.yml` manually to compare Vercel and GitHub Pages freshness.

If the coin fallback breaks on Vercel but not on GitHub Pages:

1. Open `/data/scanner/manifest.json` on the Vercel deployment directly.
2. Confirm `/generated/scanner/` assets exist on the same deployment.
3. Confirm the deployed `markets.js` is the latest version and not a stale browser cache.
