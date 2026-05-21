# Timer Palette and Theming Guide

This document defines the timer color roles for the productivity app.

The design goal is a cozy, minimalist Pomodoro-style interface with familiar mode colors, restrained saturation, and clear visual state changes.

## Color Roles

Each timer mode has five color roles.

### Progress

The darkest and most legible color in the mode palette.

Use for:
- Donut progress indicator
- High-contrast timer accents
- Text of timer
- Work block completion indicators in economy

Behavior:
- Must remain clearly visible from a distance.
- Should be the strongest visual indicator of timer progress.
- Should be darker than `backgroundActive`.

### Background Active

The timer-container background when the timer is actively running.

Use for:
- Active timer box background
- Mode activation state

Behavior:
- Should create a clear visual shift when the timer starts.
- Should be darker than `central`.
- Should not overpower the timer numbers or progress ring.

### Central

The stable inner field behind the timer numbers.

Use for:
- Inner timer circle, which is the backdrop to the donut progress indicator
- Field immediately surrounding the timer numbers
- Stable visual buffer between the timer text and outer active state

Behavior:
- Does not change between inactive and active states.
- Should be lighter than `backgroundActive`.
- Should be darker than `backgroundInactive`.
- Should visually protect the timer numbers from the surrounding active background.

### Background Inactive

The resting-state timer-container background.

Use for:
- Timer container before the timer starts
- Inactive mode surface
- Subtle resting-state tint

Behavior:
- Should be very close to the page background.
- Should only slightly suggest the mode color.
- Should not feel like an active state.

### Glow

The page-level ambient cue used during active sessions.

Use for:
- Soft outward glow beyond the timer container
- Ambient mode cue around the timer area
- Subtle page tint when a timer is active

Behavior:
- Should be very light and atmospheric.
- Should not become a dominant fill color.
- Should only appear during active states unless used extremely subtly.

## Palette

| Mode | Role | Hex |
|---|---|---|
| Work | Progress | `#C93A4B` |
| Work | Background Active | `#CC4F5A` |
| Work | Central | `#F08C97` |
| Work | Background Inactive | `#FFF3F4` |
| Work | Glow | `#FFE1E5` |
| Break | Progress | `#0F6B6D` |
| Break | Background Active | `#1FA2A8` |
| Break | Central | `#7EDAD7` |
| Break | Background Inactive | `#F1FBFB` |
| Break | Glow | `#DDF5F5` |
| Long Break | Progress | `#8C5FBF` |
| Long Break | Background Active | `#AE6FD4` |
| Long Break | Central | `#DCCDF2` |
| Long Break | Background Inactive | `#FBF7FE` |
| Long Break | Glow | `#EFE7FB` |
| Reward | Progress | `#1D4F91` |
| Reward | Background Active | `#2D71DB` |
| Reward | Central | `#9FC6F6` |
| Reward | Background Inactive | `#F3F8FF` |
| Reward | Glow | `#E3EEFF` |

## JSON Export

```json
{
  "timerPalette": {
    "work": {
      "label": "Work",
      "roleColor": "red",
      "progress": "#C93A4B",
      "backgroundActive": "#CC4F5A",
      "central": "#F08C97",
      "backgroundInactive": "#FFF3F4",
      "glow": "#FFE1E5"
    },
    "break": {
      "label": "Break",
      "roleColor": "teal",
      "progress": "#0F6B6D",
      "backgroundActive": "#1FA2A8",
      "central": "#7EDAD7",
      "backgroundInactive": "#F1FBFB",
      "glow": "#DDF5F5"
    },
    "longBreak": {
      "label": "Long Break",
      "roleColor": "lavender",
      "progress": "#8C5FBF",
      "backgroundActive": "#AE6FD4",
      "central": "#DCCDF2",
      "backgroundInactive": "#FBF7FE",
      "glow": "#EFE7FB"
    },
    "reward": {
      "label": "Reward",
      "roleColor": "blue",
      "progress": "#1D4F91",
      "backgroundActive": "#2D71DB",
      "central": "#9FC6F6",
      "backgroundInactive": "#F3F8FF",
      "glow": "#E3EEFF"
    }
  }
}
```

## TypeScript Export

```ts
export const timerPalette = {
  work: {
    label: "Work",
    roleColor: "red",
    progress: "#C93A4B",
    backgroundActive: "#CC4F5A",
    central: "#F08C97",
    backgroundInactive: "#FFF3F4",
    glow: "#FFE1E5",
  },
  break: {
    label: "Break",
    roleColor: "teal",
    progress: "#0F6B6D",
    backgroundActive: "#1FA2A8",
    central: "#7EDAD7",
    backgroundInactive: "#F1FBFB",
    glow: "#DDF5F5",
  },
  longBreak: {
    label: "Long Break",
    roleColor: "lavender",
    progress: "#8C5FBF",
    backgroundActive: "#AE6FD4",
    central: "#DCCDF2",
    backgroundInactive: "#FBF7FE",
    glow: "#EFE7FB",
  },
  reward: {
    label: "Reward",
    roleColor: "blue",
    progress: "#1D4F91",
    backgroundActive: "#2D71DB",
    central: "#9FC6F6",
    backgroundInactive: "#F3F8FF",
    glow: "#E3EEFF",
  },
} as const;

export type TimerMode = keyof typeof timerPalette;
```

## Tailwind Theme Snippet

```ts
theme: {
  extend: {
    colors: {
      timer: {
        work: {
          progress: "#C93A4B",
          bgActive: "#CC4F5A",
          central: "#F08C97",
          bgInactive: "#FFF3F4",
          glow: "#FFE1E5",
        },
        break: {
          progress: "#0F6B6D",
          bgActive: "#1FA2A8",
          central: "#7EDAD7",
          bgInactive: "#F1FBFB",
          glow: "#DDF5F5",
        },
        longBreak: {
          progress: "#8C5FBF",
          bgActive: "#AE6FD4",
          central: "#DCCDF2",
          bgInactive: "#FBF7FE",
          glow: "#EFE7FB",
        },
        reward: {
          progress: "#1D4F91",
          bgActive: "#2D71DB",
          central: "#9FC6F6",
          bgInactive: "#F3F8FF",
          glow: "#E3EEFF",
        },
      },
    },
  },
}
```

## State Usage

### Inactive Timer State

```yaml
timerContainerBackground: backgroundInactive
innerTimerField: central
outerRing: progress
pageGlow: none
```

### Active Timer State

```yaml
timerContainerBackground: backgroundActive
innerTimerField: central
outerRing: progress
pageGlow: glow
```

## Implementation Constraints

- Use palette tokens instead of hard-coded one-off colors in components.
- Keep `central` stable across inactive and active states.
- Use `progress` for the ring/donut indicator.
- Use `backgroundActive` only when the timer is running.
- Use `backgroundInactive` before the timer starts or when idle.
- Use `glow` sparingly as a soft page-level cue.
- Avoid neon variants.
- Avoid muddy brown tones in the work palette.
- Keep break as true teal, not green.
- Keep long break near lavender, not royal purple.

## Agent Instruction

When implementing timer styling, use this document as the source of truth.

Do not invent new timer colors without updating this document. If changing palette values, update:
1. The palette table.
2. The JSON export.
3. The TypeScript export.
4. The Tailwind theme snippet.
5. Any implementation files that consume these tokens.
