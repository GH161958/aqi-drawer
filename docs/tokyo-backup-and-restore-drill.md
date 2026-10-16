# Tokyo Drawer · Full Volume Backup & Offline Restore Drill (candidate V1)

**Status: preparation only. No live backup, suspend, or restart is authorized by this document.**

Canonical production facts from the October migration: Tokyo Zeabur volume at /app/data, live Store at /app/data/drawer-production/pocket-store.json, local media in /app/data/drawer-production/media/. Railway and the October Mac archive are legacy rollback references, not a fresh backup of today's Tokyo data.

## Zeabur native Volume backup

Zeabur documents **Offline Offsite Backup** for mounted-volume services (Dev Plan and above). For a non-database stateful service, its documented sequence is: suspend the service, use its Backup tab, download the completed Volume archive, then restart the service. This causes bounded downtime and requires separate EE approval for the maintenance window.

Official documentation: https://zeabur.com/docs/en-US/operations/data/backup-restore

Zeabur retains temporary offsite copies for **7 days**; an Export Project YAML is NOT a data backup. The downloaded Volume backup includes everything mounted under /app/data, potentially including the original QA/migration folders, not only the current drawer-production data.

## Gate 0 — preflight, read only

1. Confirm Tokyo aqi-drawer is healthy and latest version is cc1e614 (PR #12); verify existing /app/data Volume and C_POCKET_DATA_DIR=/app/data/drawer-production. Do not alter env vars.
2. Select a maintenance slot when iPhone Shortcut and other writers are inactive. Offline point-in-time snapshot needs service suspension.
3. Verify available local Mac storage for original backup, a decrypted working file, extracted files and a separate temporary rehearsal copy.
4. Record today's live inventory independently if feasible; do not reuse the October 41 items / 179 media counts as if they were current.

## Gate 1 — official snapshot (requires NEW EE authorization to suspend)

1. In Zeabur, open the actual Tokyo aqi-drawer service. Settings → Suspend Service. Confirm suspended.
2. Select the service Backup tab → Backup; wait for SUCCESS.
3. Download the Volume archive to a private non-shared Mac directory; never upload it to ChatGPT, GitHub, public issue threads or shared cloud folders. Do not expose temporary download links.
4. In Zeabur Overview click Restart Service and confirm the original UI, /health and Store attachments are accessible. Restart even if snapshot/download fails.
5. Privately record backup timestamp, file size and its SHA-256 digest.

If the Backup tab is missing or a step fails, STOP; do not manually alter the Volume or attempt production restore.

## Gate 2 — verify and rehearse locally, NEVER on production

Extract the trusted Zeabur archive to a new private Mac directory, avoiding overwrites. Identify the unpacked directory containing BOTH pocket-store.json and media/ for drawer-production. The archive's filename and inner layout can vary; inspect it instead of guessing.

From an aqi-drawer checkout with this PR:

    node tools/verify-drawer-backup.mjs inspect "/absolute/path/to/unpacked/drawer-production"
    node tools/verify-drawer-backup.mjs rehearse "/absolute/path/to/unpacked/drawer-production"

The first command checks Store schema, both active and trashed objects, all media file hashes and sizes, local attachment references, and embedded hashes when provided; refuses symlinks and unsafe local media names. It returns a single aggregate SHA-256 fingerprint but no item text, attachment filenames or private URL.

The second command copies to a newly created system temporary directory, compares full checksums, initializes the actual PocketStore there, reads every item including Trash, and deletes only its own temporary fixture. It never opens a network listener or modifies the source. This is an **offline restore compatibility drill**, NOT a full Zeabur disaster-recovery drill.

If validation rejects missing/incorrect attachments or corrupted JSON, mark backup NOT ACCEPTED; do not repair it by deleting evidence.

## Gate 3 — encrypt and keep a truly independent offsite copy

Install the age command locally if needed (for example via Homebrew on macOS). Generate the private identity only on your own Mac in a protected directory:

    umask 077
    mkdir -p "$HOME/Drawer-Backup-Keys"
    age-keygen -o "$HOME/Drawer-Backup-Keys/drawer-identity.txt"

Print the PUBLIC recipient (safe to use, but the private file must remain secret):

    age-keygen -y "$HOME/Drawer-Backup-Keys/drawer-identity.txt"

Encrypt the original downloaded archive (substitute paths ONLY in your Mac terminal):

    RECIPIENT="$(age-keygen -y "$HOME/Drawer-Backup-Keys/drawer-identity.txt")"
    age -r "$RECIPIENT" -o "/private/path/backup-from-tokyo.age" "/private/path/downloaded-volume-archive"

Test a full decrypt roundtrip to a separate temporary private file; compare its SHA-256 with the original downloaded archive. Store the encrypted .age archive at a second independent location and keep a safely recoverable copy of the decryption identity **somewhere separate**. Do not share either private archive or private key through this conversation.

Zeabur's seven-day copy and the October migration archive alone do NOT meet the fresh encrypted offsite retention gate.

## Final acceptance checklist

- [ ] Authorized suspended-service backup succeeded and Volume archive downloaded.
- [ ] Service resumed and existing contents still accessible.
- [ ] Download SHA-256 + file size recorded privately.
- [ ] Full Store/media validation and isolated restore rehearsal PASS.
- [ ] Encryption + actual decrypt-and-hash roundtrip PASS.
- [ ] Encrypted copy stored offsite, recovery key independently and safely recoverable.
- [ ] Only then request separate permission for owner MCP writer lane config and one safe live capture.

This runbook never authorizes production restoration, Railway removal, changing existing MCP connection, new writer secrets, or destructive Store operations.
