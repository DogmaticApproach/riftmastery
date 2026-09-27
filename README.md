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


## v0.3 Development Lab

RiftMastery now also includes a local Development Lab:

- Testing blocks with target game counts, focus matchups, and hypotheses
- Automatic 10-match development review prompts
- Recurring review-pattern tracking from explicit tags and note text
- Persistent matchup notebooks with confidence ratings and favorites
- Tournament events with fixed decks, round tracking, prep checklists, and event records
- A/B deck experiments with before/variant samples and list diffs
- Goals and milestones for matches, games, matchup reps, and hours
- Personal training-area ratings and notes
- Rolling last-10 / last-25 / last-50 form
- Going-first / going-second splits
- Development calendar and useful-activity streaks
- Global search across local development records
- RiftMastery-format CSV import for older match history
- Custom scoring-source labels
- Session and match tags
- Shareable session summary text and PNG cards
- A zero-cost ChatGPT analysis brief generator (copy/paste workflow; no paid AI API required)

The Development Lab uses the same local IndexedDB database and is included in JSON backups.
