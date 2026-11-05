# Deploying Deal Broker

Everything here can be done in a phone browser — no terminal needed. Hosting is Vercel's free
(Hobby) plan with a Neon Postgres database; scheduled jobs run on GitHub Actions (free).

## 0. Before you start

- The code you want live must be on the `main` branch, and `main` must be the repository's
  default branch (GitHub → repository → Settings → General → Default branch). Vercel deploys
  the default branch to production, and GitHub only runs scheduled jobs from it.
- Have these ready (each is a private value — only paste it into Vercel or GitHub):
  - `BETTER_AUTH_SECRET`: a random string of at least 32 characters.
  - `CRON_SECRET`: another random string of at least 32 characters.
  - Optional now, needed for notifications: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
    `VAPID_SUBJECT` (a `mailto:` address), from `npm run push:keys`.

## 1. Create the Vercel project

1. Go to vercel.com and sign up **with GitHub**.
2. **Add New → Project**, and import the `deal-finder` repository (allow Vercel access to it
   if asked).
3. Leave the framework (Next.js), root directory and build settings as they are — the
   repository's `vercel-build` script runs database setup and the build.
4. Open **Environment Variables** and add `BETTER_AUTH_SECRET` and `CRON_SECRET` (and the
   three `VAPID_…` values if you have them).
5. Press **Deploy**. This first deploy is expected to **fail** with a database error — there
   is no database yet. That's fine.

## 2. Add the database

1. In the project, open **Storage → Create Database → Neon** (Serverless Postgres).
2. Choose the **London (eu-west-2)** region and the free plan, and connect it to this project
   for all environments. Vercel then adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED`
   automatically.
3. Go to **Deployments**, open the failed one, and choose **Redeploy**. This time the build
   creates the tables, adds the categories and the (paused) Amazon UK retailer, and goes live.
4. Open the site address Vercel shows (e.g. `https://deal-broker.vercel.app`). The site uses
   that address automatically; set `NEXT_PUBLIC_SITE_URL` only when you add your own domain.

## 3. Make yourself the admin

1. On the live site, **Create an account** with your email.
2. In Vercel → **Storage → your Neon database → Open in Neon**, open the **SQL Editor** and
   run (with your email):

   ```sql
   UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
   ```

3. Reload the site: the header now shows **Admin**.

## 4. Turn on the scheduled jobs

1. GitHub → repository → **Settings → Secrets and variables → Actions → New repository
   secret**. Add:
   - `SITE_URL`: the live address, e.g. `https://deal-broker.vercel.app`
   - `CRON_SECRET`: exactly the same value as in Vercel.
2. Test it: **Actions → Scheduled jobs → Run workflow**, choose `process-alerts`, run. A green
   tick with a short JSON report means it works. From now on the jobs run on their own
   (prices every 10 minutes, deal checks hourly, catalogue daily). GitHub may start scheduled
   runs a few minutes late.

## 4b. Faster price checks (recommended for price errors)

Price errors often last minutes. GitHub runs scheduled jobs on a best-effort basis — at busy
times a "every 10 minutes" job can start late or be skipped. For the price checks, use a free
dedicated scheduler as well:

1. Sign up at **cron-job.org** (free).
2. **Create cronjob**:
   - URL: `https://YOUR-SITE/api/cron/refresh-prices`
   - Schedule: every **10 minutes**
   - Advanced → Headers: add `Authorization` with the value `Bearer YOUR-CRON_SECRET`
     (the word Bearer, a space, then the same CRON_SECRET as in Vercel)
   - Request timeout: the maximum allowed.
3. Save, then "Test run": the response should be a short JSON report with `"status":"completed"`.

Runs that overlap are skipped safely (each job has a lock), so GitHub and cron-job.org can both
call it. Each run checks up to 250 products (25 Amazon requests); the Amazon page in the admin
shows how long a full round of your tracked products takes. Every 10 minutes is about 3,600
Amazon requests a day. Amazon's starting allowance has been about one request a second and
8,640 a day (it grows with your sales) — so don't go below 10 minutes until Associates Central
shows a higher limit.

Also set **Admin → Retailers → Amazon UK → "Auto-publish big drops & price errors"** (the
default for a new install): otherwise each deal waits for you to approve it before anyone is
alerted.

## 5. On your iPhone

1. Open the site in **Safari → Share → Add to Home Screen**.
2. Open it from the new icon, sign in, go to **Price alerts** and tap **Turn on notifications
   on this device**. As the admin you'll also get "tap to tweet" alerts for price errors.
3. Your visitors don't need an account: the **Get price error alerts — no account needed**
   button on the homepage signs their phone up for every price error (or big drops too), with
   optional quiet hours. Up to 60 of these go out a day.

## Later

- **Amazon:** add `AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET`,
  `AMAZON_CREATORS_CREDENTIAL_VERSION`, `AMAZON_ASSOCIATE_TAG` in Vercel, redeploy, then follow
  "Going live with Amazon" in the README.
- **Fully automatic X posts:** add the four `X_…` keys (README, "Posting deals to X").
- **Your own domain:** Vercel → Settings → Domains. Then set `NEXT_PUBLIC_SITE_URL` in Vercel
  and update the `SITE_URL` secret in GitHub to the new address, and redeploy.
- Changing an environment variable in Vercel only takes effect after a **Redeploy**.
