---
name: demo-video
description: Best-practice checklist and pipeline for DayRunner product walkthrough videos (cold-email cut, full walkthrough, landing page). Use when asked to make, re-cut, script, caption or review a demo or walkthrough video.
---

# Demo video: best practice, applied

Pipeline lives in video/ (capture.mjs, narration/, remotion/). Narration is Duncan's ElevenLabs clone via MuseVideo's client. Never publish a video without running the checklist below.

## The rules (with the reason)

1. **Hook inside 5 seconds, outcome before product.** Viewers decide in the first 5 to 8 seconds. Open on the viewer's problem in their words ("the 5pm job"), not a logo card. Show the screen within 5 seconds. Logo goes at the end.
2. **Length by channel.** Cold email: 45 to 60 seconds, one idea. Follow-up: 90 to 150 seconds. Landing page: under 2 minutes. Completion falls off a cliff past 2 minutes for unknown senders.
3. **Silent-first.** Most email and social viewers watch muted. Burn word-timed captions in. The caption bar is not a substitute; it names the scene, it doesn't carry the narration.
4. **One CTA, said and shown.** End card with one action ("Reply and I'll set up your bookings"), one contact. No menu of links.
5. **Show state changing.** A click that resolves something beats a static screen. Every scene needs at least one before/after (exception resolved, drafts approved, supplier replied).
6. **Real data, real names, real numbers.** Demo accounts must read as an operator's day: NZ hotels, NZ suppliers, plausible times. Never lorem, never "Test Tour".
7. **Numbers only from docs/outreach/time-savings-model.md, labelled as estimates** until pilots measure. No invented ROI.
8. **Voice: Duncan, warm, plain.** No "revolutionise", no "seamless", no "AI-powered". Say what it does in the coordinator's words.
9. **Readable at phone size.** Zoom to at least 1.2x on any screen with body text. Captions 40px+ at 1080p. Test a frame at 480px wide.
10. **Brand = the app.** Navy, paper, hi-vis; Barlow Condensed and IBM Plex. Title cards use the same tokens. No stock music under narration for B2B cold outreach; a low bed is acceptable on the landing-page cut only.
11. **Thumbnail is a claim, not a logo.** A frame with the exceptions list and the line "Tomorrow's day, decided by 5pm."
12. **Accessibility.** Captions on, contrast ratio 4.5:1 on caption text, no flashing.

## Cuts to produce
- `Short45`: hook (0 to 5s, screen with problem line), exceptions + approve (5 to 35s), CTA (35 to 45s). Separate, shorter narration takes; do not trim the long takes.
- `Walkthrough`: 7 scenes, about 2 minutes.
- Thumbnail PNG from the exceptions scene with the tagline overlay.

## Pipeline
1. Reseed demos so dates read "tomorrow" (app/seed-demo.mjs, app/seed-demo-tours.mjs).
2. `node video/capture.mjs` and `capture2.mjs` (headless Chromium, 1440x900 at 2x, sessions injected from .sessions.json).
3. Narration: MuseVideo ElevenLabs client, one file per scene, texts in video/narration/segments.json.
4. Word timestamps: MuseVideo Whisper client, one JSON per mp3, into video/narration/*.words.json.
5. `cd video/remotion && npx remotion render src/index.ts <Composition> out/<name>.mp4`, then ffmpeg crf 24 for the email copy under 30 MB.
6. Review checklist: pull frames at 3s, 10s, mid, end. Check hook timing, caption legibility at 480px, CTA present, no placeholder text, no wrong operator name.

## Done means
Both cuts rendered, thumbnail exported, checklist passed, files under video/remotion/out, sources committed, renders not.
