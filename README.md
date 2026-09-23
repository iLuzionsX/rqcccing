# RQCCCING

A golden-hour circuit racer built with Three.js. Wet asphalt, a reflective lake, clearcoat bodywork, and a chase camera over three laps.

Choose **Golden Hour GP** for the coastal circuit or **Ridgebreak Rally** for the mountain stage: a gravel loop with switchbacks, a tarn, firs and rock cuts, and two crests that launch the car. Ridge scenery is bundled Poly Haven models (CC0: fir sapling, pine sapling, grass, mossy rocks, stump, dead trunk, crate, rock face), simplified and split out of their catalog layouts so each plant stands on its own.

## Play

https://iluzionsx.github.io/rqcccing/

Pushes to `main` build the static site and publish it with GitHub Pages.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints. `npm run build` writes a static site to `dist/`.

## Drive

- W / Up — throttle
- S / Down — brake
- A D / Left Right — steer
- Space — handbrake
- C — chase, bumper, hood
- R — recover onto the racing line
- P — pause

Cars launch at the two marked crests on Ridgebreak when they reach the ramp at speed. They follow a short ballistic arc and settle back onto the road on landing.

On a phone, steer with the on-screen wheel and use the pedals. The race is three laps. Finish position is frozen when you cross the line for the third time.
