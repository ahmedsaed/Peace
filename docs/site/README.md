# peace.merope.dev — source text

Drafts of the pages Play requires a public URL for, kept beside the code they describe so a change
to what leaves the phone and a change to the policy land in the same PR.

| File | Becomes | Used by |
|---|---|---|
| [privacy.md](privacy.md) | `peace.merope.dev/privacy` | Play Console › App content › Privacy policy; the About screen |
| [data-safety.md](data-safety.md) | not published — the answers for Play's Data safety form | Play Console › App content › Data safety |

**When to touch these:** any change that adds a network call, a permission, a third-party SDK, or
a new kind of data in a backup. `grep -rn "https://" src` lists every endpoint the app calls; the
merged manifest (`android/app/build/outputs/logs/manifest-merger-release-report.txt`) lists every
permission and which library brought it in.
