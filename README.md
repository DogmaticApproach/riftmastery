# RiftMastery v0.1

RiftMastery is a zero-backend, offline-first PWA for personal Riftbound development tracking.

## Current build

- Local IndexedDB storage; no login or paid backend required
- iPhone-oriented installable PWA
- Editable Legend library
- Decks tied to Legends with deck-version history
- Paper and online sessions
- BO1, BO3, BO5 and Free Play
- Conquer / Hold / Effect point tracking
- Arbitrary Effect amounts and optional labels
- Undo last point event
- Per-game first/second/unknown tracking
- Timestamp-based timers
- Pause/resume
- Recovery after reload/app close
- Quick notes and post-match review
- Match history and filters
- Overall / Legend / Deck stats
- Per-Legend matchup matrix
- JSON backup and CSV export

## Data and privacy

This build stores match data in IndexedDB on the device using the app. The GitHub repository contains app code, not the user's local match history.

There is no cloud sync yet. Export JSON periodically until automatic backup is added.

## GitHub Pages

Publish the repository root from the `main` branch using GitHub Pages. Then open the Pages URL in Safari on iPhone and use **Share → Add to Home Screen**.

## Data model

Stores: `legends`, `decks`, `sessions`, `matches`, `games`, `pointEvents`, `notes`, `meta`.

Durable records use UUID `id`, `created_at`, `updated_at`, `deleted_at`, and `sync_status` fields so cloud sync can be added later.
