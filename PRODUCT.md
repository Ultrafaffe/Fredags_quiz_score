# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Colleagues at the office playing a quiz together on Friday afternoons. One person hosts; everyone else answers from their phone or laptop. All copy is Swedish.

## Product Purpose
Fredagsquiz makes the weekly Friday quiz at work run smoothly and feel like an event. Success: people want to join, answering is effortless on a phone, and the reveal/leaderboard moments get a reaction in the room.

## Operating Context
Played in the office with everyone in one room. The host screen (game code, QR, questions, leaderboard) is shown on a TV or projector; players answer on their own devices. Two modes share one stylesheet:
- **Svarsformulär** (`index.html`): self-graded answer sheet when someone reads questions aloud.
- **Live** (`live/`): Kahoot-style game with host view, quiz editor, and player view; server scores answers.

## Capabilities and Constraints
- Static HTML/CSS/vanilla JS, no build step; shared `styles.css`. Hosted on CloudFront (no directory index, link to `live/index.html`).
- Answer sheet: 1–100 questions, letters/numbers/free text, elimination question, ✓/✗ self-grading, localStorage persistence.
- Live: 2–6 options per question, optional timer (10/20/30/60 s), right/wrong or speed scoring, JSON import/export, QR join.

## Brand Commitments
None binding. The earlier Knightec orange is not required (user: "free hand").

## Product Principles
- The room is the audience: the host screen must read from the back of a meeting room.
- Answering on a phone is one thumb, zero thinking.
- Fun beats corporate; it's Friday.
