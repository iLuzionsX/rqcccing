# RQCCCING

A golden-hour circuit racer built with Three.js. Wet asphalt, a reflective lake, clearcoat bodywork, and a chase camera over three laps.

Choose **Golden Hour GP** for the original coastal circuit or **Ridgebreak Rally** for a gravel mountain loop with steep climbs, tight switchbacks, and two physics-driven jumps. The new stage uses the locally bundled Poly Haven terrain materials and scenery models, so it runs without downloading map assets at play time.

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
- M — mute
- Space — handbrake, and the on-screen HB button does the same thing

Cars launch at the two marked crests on Ridgebreak when they reach the ramp at speed. They follow a short ballistic arc and settle back onto the road on landing.

On a phone, steer with the on-screen wheel and use the pedals. Settings → Move controls lets you drag the wheel, gas, brake, and handbrake. That layout is saved on this device. The race is three laps. Finish position is frozen when you cross the line for the third time. One best lap per stage is kept in local storage on this device.

## Sounds

The drive uses short sampled loops, not a synthesized beep.

- Engine: Firebird loop by MarlonHJ (CC0), from [esensar/bugged-racing](https://github.com/esensar/bugged-racing/blob/main/assets/engine.wav) and [Freesound 242740](https://freesound.org/people/MarlonHJ/sounds/242740/). Playback rate follows rpm and throttle. Lifting off closes the filter. A gear change drops the rpm.
- Tire squeal: Tom Haigh / audible-edge (CC BY 3.0), submitted by qubodup, from the same repo's [`tires_squal_loop.wav`](https://github.com/esensar/bugged-racing/blob/main/assets/tires_squal_loop.wav). It comes up with slip and with the handbrake, and stays quiet in a straight line.
- Gravel and asphalt rolls: adapted from [Minetest Game](https://github.com/minetest/minetest_game/tree/master/mods/default/sounds) `default_gravel_footstep`, `default_gravel_dig`, and `default_hard_footstep` (CC BY-SA 3.0). Golden Hour uses the asphalt rumble. Ridgebreak uses the gravel crunch. The adapted loops in `public/assets/audio/gravel.ogg` and `asphalt.ogg` stay under CC BY-SA 3.0.

Details are also in `public/assets/audio/CREDITS.txt` and on the menu footer next to the car credit.
