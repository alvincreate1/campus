# Campus v1.0.1

Personal application and course tracker. Static app hosted on GitHub Pages; Supabase handles account sign-in and per-user sync. No ChatGPT login.

## Publish

In this repository, select Settings → Pages → Deploy from a branch → main → / (root) → Save. No build step or Actions configuration is required. Publish only these app files, never browser records or backups.

## Data transfer

Before switching addresses, export a backup from the old Campus site. Wait for Synced there if sync is enabled. On the new site sign in with the same Campus email/password and Enable sync. If records were local only, import your backup. Keep the backup until records and documents are verified.

## Install

On iPhone: open the Pages address in Safari → Share → Add to Home Screen. Open the new icon, sign in to Campus and Enable sync. On Mac: Safari → File → Add to Dock. Installed apps can have separate browser storage; sign in within the app.

## Offline and privacy

Works offline after the first successful online visit. Changes sync while the app is open. Keep backups outside browser storage. The repository and app shell are public; passwords, sessions, records and attachments are not shipped with it. The Supabase publishable key is public by design. Database and document access are controlled by existing per-account policies.

## Update

Copy CampusWeb/dist to the repository root, retain .nojekyll, and commit. GitHub Pages republishes the branch. Browser storage keys stay stable across releases at the same origin. Changing the hosting address creates a separate local store and requires sync or backup transfer.
