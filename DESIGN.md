---
name: Fredagsquiz
description: The Friday office quiz, written live on the meeting-room whiteboard.
colors:
  marker-blue: "#1f48c8"
  marker-blue-wash: "rgba(31, 72, 200, 0.10)"
  tick-green: "#127a45"
  tick-green-wash: "rgba(18, 122, 69, 0.12)"
  strike-red: "#c8261e"
  strike-red-wash: "rgba(200, 38, 30, 0.10)"
  note-yellow: "#ffe45c"
  note-pink: "#ffa3c6"
  note-blue: "#93d4ff"
  note-green: "#b9ef9c"
  note-orange: "#ffbd6b"
  note-lilac: "#cfbcff"
  magnet-amber: "#e0a400"
  magnet-violet: "#6b3fb8"
  magnet-black: "#20242c"
  black-marker: "#1c1f26"
  ink-soft: "#4a5160"
  ink-muted: "#5c6371"
  ghost-ink: "rgba(28, 31, 38, 0.16)"
  board: "#f6f7f4"
  board-gloss: "#ffffff"
  aluminium: "#c2c9cd"
  office-wall: "#1f3d37"
  office-wall-lit: "#2b5048"
typography:
  display:
    fontFamily: "Permanent Marker, Segoe Print, Bradley Hand, cursive"
    fontSize: "clamp(3.6rem, 15vw, 9.5rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.06em"
  headline:
    fontFamily: "Permanent Marker, Segoe Print, Bradley Hand, cursive"
    fontSize: "clamp(2rem, 5.4vw, 3.3rem)"
    fontWeight: 400
    lineHeight: 1.05
  question:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 4.6vw, 2.8rem)"
    fontWeight: 800
    lineHeight: 1.15
  title:
    fontFamily: "Permanent Marker, Segoe Print, Bradley Hand, cursive"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.1
  label:
    fontFamily: "Permanent Marker, Segoe Print, Bradley Hand, cursive"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.1
  hint:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  note: "1px"
  frame: "6px"
  hand-box: "255px 12px 225px 12px / 12px 225px 12px 255px"
  hand-box-alt: "12px 225px 12px 255px / 255px 12px 225px 12px"
  hand-ring: "52% 46% 50% 48% / 46% 52% 48% 50%"
  hand-soft: "6px 12px 7px 14px / 14px 7px 12px 6px"
  magnet: "50%"
spacing:
  xs: "6px"
  sm: "12px"
  md: "18px"
  lg: "22px"
  xl: "26px"
  2xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.note-yellow}"
    textColor: "{colors.black-marker}"
    typography: "{typography.title}"
    rounded: "{rounded.note}"
    padding: "16px 30px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.black-marker}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.hand-box}"
    padding: "12px 22px"
  button-ghost-hover:
    backgroundColor: "{colors.marker-blue-wash}"
    textColor: "{colors.marker-blue}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    typography: "{typography.body-strong}"
    padding: "12px 22px"
  input:
    backgroundColor: "{colors.board-gloss}"
    textColor: "{colors.black-marker}"
    rounded: "{rounded.hand-soft}"
    padding: "13px 16px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.hand-ring}"
    height: "46px"
    padding: "0 8px"
  chip-selected:
    textColor: "{colors.marker-blue}"
  answer-note:
    textColor: "{colors.black-marker}"
    rounded: "{rounded.note}"
    padding: "16px 20px"
    height: "96px"
  magnet:
    backgroundColor: "{colors.strike-red}"
    textColor: "{colors.board-gloss}"
    rounded: "{rounded.magnet}"
    size: "34px"
  board-panel:
    backgroundColor: "{colors.board}"
    textColor: "{colors.black-marker}"
    rounded: "{rounded.frame}"
  toast:
    backgroundColor: "{colors.note-yellow}"
    textColor: "{colors.black-marker}"
    padding: "14px 22px"
---

# Design System: Fredagsquiz

## Overview

**Creative North Star: "The Meeting-Room Whiteboard"**

Every screen is one glossy whiteboard in an aluminium frame, hung on a deep green office wall. Everything is written on it with a black marker; one blue marker marks whatever is active right now; a green ring or tick means right and a red strike means wrong. Physical objects stuck to the board do the rest: post-it notes are the brand label, the primary action, the answer options, warnings and toasts, and round coloured magnets are the players. Nothing on the board is a boxed card; structure comes from dashed ghost lines drawn across the board and from post-its stuck on it.

The system reads at two distances. On the office TV the game code is scrawled at almost 10rem and the leaderboard is written large; on a phone the same board narrows to a single column of thumb-sized post-its. Hierarchy comes from scale, not from extra colour: a marker headline, a heavy sans question, quiet hints. Shapes are hand-drawn: radii are asymmetric so no line or ring is quite straight or quite round, and post-its sit a degree or two off true.

It rejects the dark stage with neon glow and the four-tile purple quiz clone. State is shown by a mark (a ring drawn around, a strike drawn through, a tick), never by recolouring a surface.

**Key Characteristics:**
- Whiteboard panel with aluminium frame and a marker tray, on a dark green wall.
- Two voices: Permanent Marker for anything "written", Atkinson Hyperlegible Next for reading.
- Blue is the only active colour; green and red are verdicts only.
- Post-its are the only filled, coloured surfaces; magnets are the only round solids.
- Hand-drawn asymmetric radii, small tilts, ink that draws itself in.

## Colors

A white board under black ink, one blue active marker, verdict green and red, and six stationery-bright post-it colours.

### Primary
- **Blue Marker** (marker-blue): the one active thing. The game code, the current question number, a selected answer's ring, chosen chips, focus outlines, progress stroke, links, caret. Its wash (marker-blue-wash) is only a hover tint and focus halo.

### Secondary
- **Post-it Yellow** (note-yellow): the brand note, the primary action, the QR note, the toast, the leader's row on the leaderboard, and answer option A.
- **Post-it Pink / Blue / Green / Orange / Lilac** (note-pink, note-blue, note-green, note-orange, note-lilac): answer options B to F in fixed order. Pink also carries warnings and the elimination question.

### Tertiary
- **Tick Green** (tick-green): correct answers, the green ring at reveal, submitted players. Wash for the pressed "correct" mark.
- **Strike Red** (strike-red): wrong answers as a drawn strike, a low countdown. Wash for the pressed "wrong" mark.
- **Magnet colours**: players rotate through strike-red, marker-blue, tick-green, magnet-amber (with black text), magnet-violet and magnet-black, keyed by join order so a player keeps the same magnet in lobby and leaderboard.

### Neutral
- **Black Marker** (black-marker): all text and drawn strokes.
- **Soft Ink** (ink-soft, 7.6:1 on the board): secondary marker notes, leads, unranked rank rings.
- **Muted Ink** (ink-muted, 5.9:1 on the board): hints, meta, unanswered numbers.
- **Ghost Ink** (ghost-ink): the faint dashed dividers and empty states, like a half-erased line.
- **Board** (board) and **Board Gloss** (board-gloss): the writing surface and the whiter fill of inputs and keys.
- **Aluminium** (aluminium): the frame and marker tray.
- **Office Wall** (office-wall, lit at the top with office-wall-lit): the page background outside the board.

### Named Rules
**The One Blue Marker Rule.** Blue means "active or selected now" and nothing else. Never use it for decoration, headings, or a second accent.

**The Mark Not Hue Rule.** Right and wrong are shown by a drawn mark (green ring or tick, red strike) in addition to colour, and options always carry a letter, so colour is never the only clue.

**The Stationery Rule.** Saturated fills appear only as post-its and magnets. The board itself is never tinted and never boxed.

## Typography

**Display Font:** Permanent Marker (with Segoe Print, Bradley Hand, cursive)
**Body Font:** Atkinson Hyperlegible Next (with Atkinson Hyperlegible, system-ui)

**Character:** A chunky felt-tip hand for whatever is written on the board, paired with a sans built for legibility at a distance and on small phones.

### Hierarchy
- **Display** (400, clamp(3.6rem, 15vw, 9.5rem), 1, 0.06em tracking): the game code only, in blue, slightly tilted, written in from the left.
- **Headline** (400, clamp(2rem, 5.4vw, 3.3rem), 1.05, balanced): panel titles.
- **Question** (Atkinson 800, clamp(1.6rem, 4.6vw, 2.8rem), 1.15; up to 3.6rem on the host TV): the live question text. Questions are read, so they are never in marker.
- **Title** (400, 1.5–1.6rem): section titles such as players and leaderboard headings, the primary post-it button.
- **Label** (400, 1.05–1.3rem): field labels, the progress note ("Fråga 3 av 10"), QR caption, player name tag.
- **Body** (400, 17px / 16px on phones, 1.5): running text; leads cap at 60ch.
- **Body Strong** (700, 1.05rem): ghost buttons, answer text on post-its (700, up to 1.45rem; 2rem on TV), player names (700), leaderboard names (800).
- **Hint** (400, 0.95rem, ink-muted): helper text and meta.

### Named Rules
**The Written vs Read Rule.** Marker for short things that are written on the board (titles, labels, numbers, scores, codes); Atkinson for anything a player has to read and understand (questions, answers, hints, names). A marker sentence longer than a line is wrong.

**The Scale Alone Rule.** Hierarchy is built by size and the two families, not by colour; headings stay black ink.

## Layout

A single centred board. The column is min(980px, 100%) and widens to min(1280px, 100%) when the host screen is showing, because it is projected on a TV. The brand post-it hangs over the board's top-left edge (negative margin, tilted). Board padding is fluid: clamp(40px, 5vw, 56px) top, clamp(22px, 4.5vw, 48px) sides.

Sections inside the board are separated by 2px dashed ghost-ink lines with about 26px above and 30px of margin, not by boxes. Rhythm runs on 6 / 12 / 18 / 22 / 26 / 30px steps.

Answer post-its are an auto-fit grid (min 260px; 420px on the host TV) with 18–26px gaps. On the host reveal at 1100px and up, options sit left (1.5fr) and the top-5 leaderboard right (1fr), so everything fits in the first view. The lobby puts the game code and QR note side by side and wraps the QR under the code when narrow.

At 620px and below: body drops to 16px, the frame thins from 12px to 8px, answers become a single column, actions stack full width with the primary on top, and leaderboard scores move under the name. At 360px and below the board padding tightens further.

## Elevation & Depth

Depth is physical, not interface: the board is flat and casts one deep shadow onto the wall; only objects stuck to the board (post-its, magnets) cast their own small shadows. Inputs, ghost buttons, chips and dividers are drawn on the board and have no shadow.

### Shadow Vocabulary
- **Note rest** (`0 1px 1px rgba(0,0,0,0.12), 0 10px 14px -8px rgba(0,0,0,0.45)`): every post-it at rest. A soft curl shadow below.
- **Note lift** (`0 2px 2px rgba(0,0,0,0.10), 0 18px 22px -10px rgba(0,0,0,0.45)`): a post-it on hover (lifted 3px and straightened), the toast, the correct answer at reveal.
- **Magnet** (`0 2px 2px rgba(0,0,0,0.25), 0 5px 8px -2px rgba(0,0,0,0.35)`): player magnets and the +/- counter magnets.
- **Board on wall** (`inset 0 0 0 1px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.3), 0 30px 50px -20px rgba(0,0,0,0.6)`): the board panel only.

### Named Rules
**The Stuck-On Rule.** A shadow means "a physical object is stuck to the board". Something drawn on the board never gets one.

## Shapes

Hand-drawn geometry. Boxes use strongly asymmetric elliptical radii (hand-box and its mirror hand-box-alt) so a drawn rectangle bows slightly; rings use hand-ring so circles are never perfect; small fields use hand-soft. Post-its are near-square-cornered (1px) paper with a slight top shading and a darker bottom-right corner, and tilt within ±3deg (most between 0.5 and 1.5deg). Magnets are the only perfect circles. Strokes are 2–4px, matching marker width: 2.5px for inputs and buttons, 3–4px for rings, 4px for strikes.

Ink marks animate the way a pen writes: rings and the game code reveal left to right with a clip-path sweep, strikes scale out from the left, magnets snap on. Reduced motion collapses all of this to the end state.

## Components

### Buttons
- **Primary (post-it):** a yellow note with marker text (1.35rem; 1.5rem large), 1px corners, note-rest shadow, tilted -1.5deg. Hover straightens it, lifts 3px and deepens to the note-lift shadow; active presses down 1px.
- **Ghost (drawn box):** transparent, a 2.5px black-marker outline with the hand-box radius, Atkinson 700. Hover turns the outline and text blue with a blue wash; active nudges down 1px. A mirrored radius variant keeps neighbouring boxes from looking stamped.
- **Quiet:** underlined text in soft ink (2px underline, 5px offset); hover makes the underline wavy. For leaving or ending.
- **Focus:** 3px blue outline, 4px offset, everywhere.
- **Disabled:** 45% opacity.

### Chips
- **Style:** a marker number on the board with an invisible ring (hand-ring); hover shows a ghost ring.
- **State:** selected draws the ring and number in blue.

### Cards / Containers
- **Corner Style:** the board panel has a 6px radius inside a 12px aluminium frame (8px on phones), with the marker tray under it.
- **Background:** board white with faint ghosted erasures and a diagonal gloss streak.
- **Shadow Strategy:** board-on-wall only (see Elevation).
- **Border:** no inner cards. Grouping is dashed ghost dividers, or a post-it (pink for the elimination question and warnings, yellow for the leader's row).

### Inputs / Fields
- **Style:** board-gloss fill, 2.5px ink border at 55% opacity, hand-soft radius, 13px 16px padding, 1.1rem text. Labels are marker above the field; hints in muted ink below.
- **Hover / Focus:** hover darkens the border to full ink; focus turns it blue with a 4px blue-wash halo.
- **Line fields:** free-text answers are a single 2.5px underline on the board that turns blue on focus.
- **Checkbox:** a hand-drawn square; checking draws a blue tick in.
- **Select:** native select with a hand-drawn chevron mask.

### Navigation
There is no nav bar. The brand post-it is the only header; a sticky board-coloured toolbar on the answer sheet carries the player magnet and name, a dashed progress track with a blue stroke, and the question count.

### Answer Post-its (signature)
Each live option is a post-it in its fixed colour (A yellow, B pink, C blue, D green, E orange, F lilac) with its own small tilt, a marker letter in a 46px hand-drawn ring, and Atkinson 700 answer text. On the phone they are buttons: hover lifts, a chosen note straightens and gets a blue ring around it, the rest fade. At reveal the wrong notes wash out and get a red strike through the text, the correct note scales up 3%, lifts, gets a green ring drawn around it and its letter becomes a green tick. Answer distribution is drawn as diagonal pen hatching across the note.

### Magnets
Round 34px solid circles (38px in the toolbar) with a white marker initial and the magnet shadow. Colour rotates by join order. Used for players in the lobby, on the leaderboard and in the player tag; the +/- counter buttons are black magnets that turn blue on hover.

### Leaderboard
Written on the board: a marker rank inside a hand-drawn ring, the player's magnet and bold name, and a marker score with a small "of N" in muted sans. Rows are split by dashed ghost lines; first place sits on its own yellow post-it tilted -0.8deg with a thicker ring. The finished screen scales every part up for the TV.

### Answer Sheet Marks
Answer letters on the board; selecting draws a blue ring around the letter. Self-grading uses two small hand-soft boxes with drawn tick and cross icons (CSS masks); pressed "correct" fills with a green wash and green border, pressed "wrong" with red, and a wrong answer gets a red strike drawn across it.

## Do's and Don'ts

### Do:
- **Do** keep every screen on the one framed board on the green wall, with the brand post-it over its top-left edge.
- **Do** use blue (marker-blue) only for what is active or selected right now.
- **Do** show right and wrong as drawn marks (green ring or tick, red strike) plus the option letter, not by colour alone.
- **Do** make primary actions, warnings and toasts post-its with the note-rest shadow and a tilt within ±3deg.
- **Do** separate content with 2px dashed ghost-ink lines instead of boxes.
- **Do** use Permanent Marker for short written labels and numbers, and Atkinson Hyperlegible Next for questions, answers and anything read.
- **Do** draw icons as hand-drawn SVG masks (tick, cross, chevron) in currentColor.
- **Do** keep the host view readable from the back of the room: TV width 1280px, question up to 3.6rem, answers up to 2rem.

### Don't:
- **Don't** use a dark stage, neon glow, or the four-tile purple quiz layout.
- **Don't** put boxed or bordered cards on the board; a container is either drawn (dashed line, ring, outline) or a stuck-on post-it.
- **Don't** give a drawn element (input, ghost button, chip, divider) a drop shadow; shadows belong to post-its, magnets and the board.
- **Don't** introduce a second active colour or tint the board.
- **Don't** set questions, answer text or paragraphs in Permanent Marker.
- **Don't** use perfect geometric rings or rectangles for drawn marks; use the hand radii.
