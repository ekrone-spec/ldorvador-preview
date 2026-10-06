# Taking bookings on the website

Hannah, this is how bookings work now. Travelers can reserve a spot and pay their deposit online, and you manage everything from one admin page. Nothing goes live on a trip until you tick the box described in section 1.

## 1. Opening bookings on a trip

In CloudCannon, open the trip (for example the Temple Beth Elohim journey) and fill in these fields:

- **Trip reference**: the code that starts every booking number, built as arrival date + organizer code + trip number (Temple Beth Elohim is 20270303TBE01). Bookings cannot open without it.
- **Trip package price per traveler** and **Single supplement**: in US dollars, numbers only.
- **Deposit per traveler**: in US dollars. A double room pays two deposits, one per traveler.
- **Open bookings**: tick this to show the "Reserve Your Spot" button on the trip page. Untick it to close bookings; the button and the reserve page disappear, and existing bookings are not affected.

Save and publish as usual. The button appears after the site rebuilds, usually within a couple of minutes.

## 2. What travelers see

1. They press **Reserve Your Spot** and fill in the form: names, contact details, single or double room (a double asks for the roommate's name and bed type), any extra nights they want before or after, an emergency contact, dietary needs, and a tick to accept the Terms and Conditions.
2. They go to a Stripe payment page and pay the deposit by card or US bank account.
3. They land on a thank-you page showing their booking reference.
4. Once the payment clears they get a confirmation email from us. Bank payments can take a few business days, and the email waits until then.
5. The confirmation email includes a private link to a details form for passport information and flights. You are also emailed when a traveler sends their details.

Extra nights are requests only. They are added to the balance after you confirm them (section 4).

## 3. The admin page

Go to https://www.ldorvadortravel.com/admin/ . Enter your email, and Cloudflare sends a one-time code to connect@ldorvadortravel.com. Type the code in and you are in.

The first page lists trips that have bookings. Click a trip to see its bookings with status, deposit date, balance and whether details have arrived. A trip with no bookings yet is opened with the box at the bottom of the first page (type the trip's web name, for example temple-beth-elohim).

Statuses: Pending (waiting for payment), Deposit paid, Deposit failed, Balance sent, Balance paid, Cancelled.

## 4. What each action does

- **Add booking**: for someone who is booking with you directly (phone, check, tour leaders). It creates the booking without a Stripe deposit. Tick "Send the confirmation email" if you want them to receive the confirmation and details link.
- **Tour leader**: tick this on a booking for a rabbi or leader. They appear on the rooming list and are flagged in the admin.
- **Edit** (click a booking): change names, room, bed, dates, dietary, room number, internal notes or status, then Save changes.
- **Cancel booking**: marks it Cancelled. It does not refund anything; see section 7.
- **Confirm extra nights**: on the booking, tick "Extensions confirmed" and enter the confirmed before/after dates. Only confirmed nights are charged in the balance and shown on the rooming list.
- **Balance**: opens the balance review for that booking. It lists the package, single supplement, confirmed extra nights and optional tours, minus the deposit. You can change any amount or add a line (for example an extension price that is not set yet). **Create link and send** makes a Stripe payment link and emails it to the traveler. **Resend email** sends the same link again.
- **Resend details link**: emails the traveler their private details-form link again.
- **Export travelers (CSV)**: every booking that is not cancelled, with every field, for your records.
- **Export rooming list (CSV)**: columns are booking reference, guest 1, guest 2, room number, room type, bed type, arrival, departure, dietary requirements/special requests. Cancelled bookings are left out; extra nights show in the arrival and departure columns once confirmed.

## 5. When to send balances

Send balances when you are ready to collect them, and only after you have confirmed any extra nights, so the amount is final. Check the review page before pressing send: it is the exact breakdown the traveler will see.

## 6. Terms and Conditions

The terms live at https://www.ldorvadortravel.com/terms.html and are edited in CloudCannon under Terms and Conditions. Each booking records the version the traveler accepted. If you change the wording, change the **Version** date as well, so new bookings are recorded against the new text and old ones keep the old version.

## 7. Refunds

Refunds are done in the Stripe dashboard (Payments, find the payment, Refund). L'Dor Vador absorbs the Stripe fee, so the traveler gets back the full amount. After refunding, cancel the booking in the admin page so the rooming list stays correct.

## 8. If a bank debit fails

The booking shows **Deposit failed** and you get an email. Contact the traveler, tell them the debit did not go through, and ask them to try again with a card or a different account by submitting a new reservation. Then cancel the failed booking in the admin so it does not clutter the list. For a failed balance payment, the booking keeps its status and a note is added; resend the balance email once they have sorted it out.
