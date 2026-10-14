# Play Console — Data safety answers

The answers to give in **Play Console › App content › Data safety**, derived from
[privacy.md](privacy.md). The form and the policy must say the same thing; if one changes, change
both in the same PR. The same answers, in the form Play Console imports, are
[`store/data-safety.csv`](../../store/data-safety.csv) — that file changes with this one too.
Google's definitions decide the wording here, not ours:

- **Collected** = transmitted off the device by the app, *including* to a third party such as
  Google's Gemini API, even when we never see it.
- **Shared** = transferred to a third party — EXCEPT a transfer the user initiates and would
  reasonably expect (Google lists "user-initiated action" as an exemption). Every transfer Peace
  makes is one the user switched on and triggered, so nothing is declared as *shared*.
- **Optional** = the user can use the app without it. Every collection below is optional.

## Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (the optional AI and backup features transmit data) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — every request is HTTPS |
| Do you provide a way for users to request that their data is deleted? | **Yes** — see *Deletion* below |

## Data types

| Data type (Play's category) | Collected | Shared | Ephemeral | Required? | Purposes | Why |
|---|---|---|---|---|---|---|
| **Financial info › Purchase history** | Yes | No | No | Optional | App functionality | Records and ledger figures go to Gemini when Penny answers; the ledger goes to the user's own Drive in a backup |
| **Financial info › Other financial info** | Yes | No | No | Optional | App functionality | Account and category names in AI requests and backups |
| **Messages › SMS or MMS** | Yes | No | No | Optional | App functionality | Text of bank SMS from senders the user listed, sent to Gemini to be read. Read from the default SMS app's notifications, never the inbox — but the DATA is SMS, and the form asks about the data |
| **Photos and videos › Photos** | Yes | No | No | Optional | App functionality | Receipt photos sent to Gemini to be read, and included in Drive backups |
| **Files and docs** | Yes | No | No | Optional | App functionality | Files attached to a Penny question; the backup file itself |
| **App activity › Other user-generated content** | Yes | No | No | Optional | App functionality | Notes, questions to Penny |

**Not collected** (answer *No* for each): Location, Personal info (name, email, user IDs —
Google Sign-In is used only to authorise the Drive folder and the account details are not sent
anywhere by Peace), Health and fitness, Contacts, Calendar, Audio, Web browsing, App info and
performance (no crash or analytics SDK), Device or other IDs.

*Ephemeral* is answered **No** throughout, conservatively: a user on Gemini's free tier is subject
to Google's retention terms, which we do not control.

## Deletion

Peace holds no user data on any server of ours, so there is no account to delete. The form still
asks for a "delete data URL" when the answer is Yes: it is **https://peace.merope.dev/delete/**,
written to Play's three requirements (names the app and developer, gives the steps, says what is
deleted or kept). In short: uninstalling or clearing storage deletes everything on
the phone; Drive backups are removed from Google Drive › Settings › *Manage apps*; requests sent
to Gemini are governed by the user's own API key and Google's terms.

## Judgement calls to re-check before submitting

1. **Firebase Messaging is in the binary** (pulled in by `expo-notifications`) but never
   initialised — there is no `google-services.json`, so no FCM token is created and nothing is
   sent. If that ever changes, *Device or other IDs* becomes **Yes**.
2. **Drive backups as "collected".** They go to the user's own storage, but Google's definition
   counts any off-device transfer, so they are declared rather than argued about.
3. If Peace Cloud ships (v1.1), requests pass through **our** server and the answers change: data
   is then *collected by us*, and the policy needs a server section.
