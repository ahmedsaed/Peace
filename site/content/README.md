# Site content

The words of peace.merope.dev that matter most, kept as markdown beside the code they describe, so
a change to what leaves the phone and a change to the policy land in the same PR.

| File | Becomes | Used by |
|---|---|---|
| [privacy.md](privacy.md) | `peace.merope.dev/privacy/` | Play Console › App content › Privacy policy |
| [data-safety.md](data-safety.md) | not published — the answers for Play's Data safety form | Play Console › App content › Data safety |

`site/app/data/page.tsx` is the plain-language "Your data" page; it must agree with both files.

**When to touch these:** any change that adds a network call, a permission, a third-party SDK, or
a new kind of data in a backup. `grep -rn "https://" src` lists every endpoint the app calls, and
`scripts/allowed-permissions.txt` lists every permission the release may request.

**Placeholders** like `[SUPPORT EMAIL]` are allowed while drafting — the site builds — but the
deploy refuses to publish `privacy.md` while one remains.
