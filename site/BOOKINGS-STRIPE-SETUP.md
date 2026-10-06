# Stripe setup for bookings (Erik)

Do everything in **test mode** first (Stripe dashboard, switch to Test mode / Sandbox), run the checklist at the end, then repeat steps 2 to 4 with live values. Commands run from `site/`.

Verified against docs.stripe.com on 2026-10-06: restricted key creation, webhook (event destination) creation, ACH test numbers and settlement, US bank account enablement link. Not verified (dashboard is login-gated): exact wording of Settings menu entries.

## 1. Payment methods

Dashboard, Settings, Payment methods (dashboard.stripe.com/settings/payment_methods). Turn on **Cards** and **US bank account** (ACH Direct Debit). Both need USD, which the code uses.

## 2. Restricted API key

Developers, API keys, **Create restricted key**. Name it `ldv-bookings`. Set **Write** on: Checkout Sessions, Payment Links, Prices, Products. Leave everything else **None**. Click **Create key**, complete the two-factor prompt, copy the `rk_test_...` value (it cannot be shown again).

## 3. Webhook endpoint

Workbench, Webhooks tab, **Create an event destination**:

1. Select **Your account**, pick the API version, then select these four events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`.
2. Continue, choose **Webhook endpoint** as the destination type, Continue.
3. Endpoint URL: `https://www.ldorvadortravel.com/api/stripe/webhook`.
4. On the settings page click **Reveal secret** and copy the `whsec_...` value.

Test and live modes have separate endpoints and secrets; create one in each.

## 4. Worker secrets

Run each and paste the value when prompted:

```
npx wrangler versions secret put STRIPE_SECRET_KEY
npx wrangler versions secret put STRIPE_WEBHOOK_SECRET
npx wrangler versions secret put BOOKING_TOKEN_SECRET
```

`BOOKING_TOKEN_SECRET` is any long random string (`openssl rand -base64 48`). Do not rotate it after links have been emailed. Then deploy the version. Use `npx wrangler secret put NAME` instead if there are no undeployed versions.

## 5. Database migration

```
npx wrangler d1 execute ldorvador-interest --remote --file=migrations/0004_bookings.sql
```

## 6. Cloudflare Access

Zero Trust, Access, Applications, open the existing application that protects `/api/interest/*`. Add two paths: `/admin` and `/api/admin`. Keep the same policy (connect@ and your email). Check that https://www.ldorvadortravel.com/admin/ now asks for a one-time code.

## 7. Test-mode end-to-end checklist

Set `bookings_open` true on the trip, publish, then at /groups/temple-beth-elohim/reserve/:

| Step | Expected |
|---|---|
| Submit a single-room reservation | Redirect to Stripe Checkout; admin shows the booking as **Pending** |
| Pay with card 4242 4242 4242 4242, any future expiry, any CVC | Thank-you page with the reference; admin **Deposit paid**; confirmation email with details link arrives; internal notification arrives |
| Open the details link, submit | Admin shows "Yes" under details; notification email arrives |
| New reservation, pay with US bank account: choose the test bank / enter routing 110000000, account 000123456789 | Admin stays **Pending** (note "awaiting bank debit") until Stripe sends the async success, then **Deposit paid** |
| New reservation, bank account 000111111113 (closed account) | Admin **Deposit failed**; failure email arrives |
| Add booking in admin, then Balance, Create link and send | Status **Balance sent**; email with Pay the balance button |
| Pay the balance with 4242 | Status **Balance paid** |
| Export both CSVs | Files download; rooming list has the 9 columns |

Stripe may require microdeposit verification for manually entered bank accounts; test amounts 32 and 45 verify the account. Test bank payments settle instantly in test mode.

Also confirm in Webhooks, Event deliveries, that every delivery shows 200. Then untick `bookings_open` or delete the test bookings before going live (cancel them in admin; the database rows remain, so use a distinct note).

## 8. Going live

1. Switch the dashboard to Live mode and repeat sections 1 to 3 (live key `rk_live_...`, new live `whsec_...`).
2. Re-run the three `npx wrangler versions secret put` commands for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the live values (leave `BOOKING_TOKEN_SECRET` alone), and deploy.
3. Place one real small booking with your own card, confirm it reaches **Deposit paid**, then refund it in the Stripe dashboard and cancel it in admin.
4. Replace the placeholder Terms and Conditions text before opening bookings to the public.
