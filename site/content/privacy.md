<!--
  DRAFT for peace.merope.dev/privacy. Fill in the effective date and the support
  email (the bracketed placeholders below) before publishing. Every claim is checked against the
  code — if a feature changes what leaves the phone, this page changes in the
  same PR (see site/content/README.md).
-->

# Peace — Privacy Policy

**Effective [EFFECTIVE DATE]** · Peace is made by Merope ([merope.dev](https://merope.dev)).

## The short version

Peace is a **local-first** expense tracker. Your records, accounts, budgets, receipts and settings
are stored **on your phone**, in the app's private storage. We do not run a server that receives
them, we have no accounts, and the app contains **no analytics, advertising or crash-reporting
SDKs**.

Nothing leaves your phone unless you turn on a feature that needs to — and each of those features
is off until you do. They are listed below, with exactly what each one sends and to whom.

## Features that send data off your phone

### Reading with AI — Google Gemini (optional)

If you add your own **Gemini API key** in Settings, Peace can:

- **Read a receipt** you photograph or pick: the image is sent to Google's Gemini API.
- **Read a bank message** (see *Bank notifications* below): the message's text, the names of your
  accounts and categories, and any reading rules you wrote are sent to Gemini.
- **Answer questions with Penny**, the assistant, which is a separate switch in Settings: your
  question, the conversation so far, files you attach to it, and the parts of your ledger Penny
  looks up to answer (amounts, dates, notes, and the names of accounts, categories and tags) are
  sent to Gemini.

These requests go **directly from your phone to Google**, authenticated with **your** key. They
do not pass through any server of ours, and we never see them. Google's handling of them is
governed by the [Gemini API terms](https://ai.google.dev/gemini-api/terms) for your key. Note
that on Google's **free** tier, Google may use requests to improve its products; on a paid tier
it does not. Your key is stored in Android's encrypted storage and is **never** included in a
backup.

### Bank notifications (optional)

If you grant Peace **notification access** and list the senders you want read (for example your
bank's short code), Peace reads text messages arriving through **your default SMS app** so they
can become records.

- Messages from **senders you did not list are discarded on your phone** the next time Peace
  opens; they are never sent anywhere. With an empty sender list, nothing is read at all.
- A message from a listed sender is stored on your phone and, if you have a Gemini key, sent to
  Gemini to be read as described above.
- Notifications from other apps are ignored.

You can withdraw notification access at any time in Android's settings.

### Google Drive backup (optional)

If you connect Google Drive, Peace uploads backups of your data (your ledger and any attached
receipt images) to the **app-data folder of your own Google Drive**, a hidden folder only Peace
can read. You can choose a **passphrase** to encrypt backups before they leave your phone; without
one, the backup is protected by Google Drive's own security but is not encrypted by us.

Peace uses Google Sign-In only to obtain permission for that one folder
(`drive.appdata`). It does not read your other files, and it does not send your Google account
details anywhere. Disconnecting stops backups and leaves existing backups in place; you can delete
them from Google Drive's settings (*Manage apps*).

### Exchange rates (optional, on request)

When you record an amount in another currency and ask Peace to fill in the rate, it requests that
one rate from [Frankfurter](https://frankfurter.dev), a free service publishing central-bank rates.
The request contains the two currency codes and nothing else.

### Update check (GitHub version only)

The version of Peace distributed on GitHub checks GitHub's public releases API for a newer
version. The request contains no personal data. The version on Google Play does not do this —
Play delivers its updates.

## Permissions

| Permission | Used for |
|---|---|
| Camera | Photographing a receipt, only when you tap the camera button |
| Notifications | The optional daily reminder, scheduled on your phone |
| Notification access | The optional bank-message reading described above |
| Internet | The optional features above |

## Your data, your control

- **Export** everything as CSV or as a full backup at any time, from Settings.
- **Delete** everything by uninstalling the app or clearing its storage. Because we hold none of
  your data, there is nothing for us to delete on our side; backups in your Google Drive are
  removed from Drive's *Manage apps* settings.
- Peace is not directed at children under 13.

## Changes

If what Peace sends off your phone changes, this page changes with it, and the effective date at
the top moves.

## Contact

[SUPPORT EMAIL]
