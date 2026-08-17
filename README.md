# Never-Ending Card Drive

A procedurally infinite three.js racing highway — in the vein of
[slowroads.io](https://slowroads.io): the road actually curves and rolls
over hills (not a straight lane), scenery cross-fades between desert and
hills, and a full day/night cycle plays out as you drive. Race it solo
against the clock, or race friends on the same WiFi network — everyone gets
the identical road, a live standings HUD, and a results screen when the race
concludes.

## Project structure

```
card-drive/
├── index.html            entry point — links the CSS/JS below
├── css/
│   └── style.css          HUD, lobby, and race-results styles
├── js/
│   ├── net.js              tiny WebSocket client (falls back to solo if no server)
│   └── main.js              all three.js scene / game / race logic
├── lib/
│   ├── three.min.js        three.js r160 (vendored, so no build step or CDN needed)
│   └── GLTFLoader.js       three.js's model loader, adapted from examples/jsm into a plain script
├── assets/
│   └── models/
│       ├── hyper-gt.glb        selectable car (falls back to the placeholder if missing)
│       ├── mister-beef.glb     selectable car
│       ├── fast-charger.glb    selectable car
│       ├── gt-supercar.glb     selectable car (the heaviest of the four, ~8MB)
│       ├── tree.glb            real tree, swapped in over the procedural pine once loaded
│       └── grass.glb           ground-clutter grass clumps (no procedural equivalent)
├── server/
│   └── server.js            multiplayer server: serves the files + relays race state
├── build.py                 regenerates ../card-drive.html (the single-file build)
├── package.json             `npm start` (solo) / `npm run server` (multiplayer)
└── README.md
```

## Running it solo

No build step, no dependencies to install — it's static files.

```bash
cd card-drive
npm start
```

Then open **http://localhost:8000**. Click **Practice Solo** and go.

## Running a multiplayer race

This needs the actual server (a static file server can't relay WebSocket
messages between players), so it needs the `ws` package installed once:

```bash
cd card-drive
npm install
npm run server
```

It prints two URLs — open the **Same WiFi** one on every device that wants to
race (including this machine, if you want to play too).

Once connected, each device picks a name/color, then either **Create Room**
(gets a 4-letter code — share it with whoever you're playing with) or **Join
Room** with a code someone already gave you. Only players in the same room
see each other; the server can host any number of separate rooms/races at
once. Whoever clicks **Start Race** inside a room triggers a synced 3-2-1
countdown for everyone in that room at that moment; latecomers can join the
next one.

A room code only decides *who plays together* once everyone can already
reach the server — it doesn't make the server reachable from other networks.
Right now that still means the same WiFi. Making the server reachable from
different networks (a tunnel like ngrok, or deploying it to a cloud host)
is a separate step not yet set up in this project.

## Controls

- **← / →** or drag: steer
- **↑**: boost
- **↓**: brake
- **X**: burn nitro (only fills by driving through the cyan pickups on the road)

Drive fast enough over a ramp and you'll launch into the air, nose tilting
with the jump until you land. First to the finish line wins. Crossing it stops your car and shows your
time; once every racer has finished (or a straggler timeout passes), a full
**Race Results** screen appears with everyone ranked by finish time, and a
**Race Again** button.

## Notes on how it works

- **Driving physics is a real force model, not a flat accel curve.** The
  "CAR PHYSICS" section in `js/main.js` (`update()`) replaced the old fixed
  accel/turn-rate numbers with the model described at
  https://rsms.me/etc/car-physics/ (a writeup of Marco Monster's "Car
  Physics for Games"): engine force vs. quadratic drag + rolling
  resistance for speed (top speed now emerges from that balance, it's not
  a hard clamp), and slip-angle tire forces per axle for cornering, with
  weight transfer shifting grip between the front and rear axle under
  accel/braking. Push a corner too hard and an axle actually loses grip
  instead of just turning at a fixed rate — including genuine spin-outs;
  there's no artificial clamp stopping the car's heading from diverging
  from the road's anymore. The constants aren't the article's real-world
  SI values — they're picked to land the car's baseline feel (accel, top
  speed, braking) close to this game's own already-tuned numbers, with the
  new physics on top. Below ~0.5 world-units/sec of forward speed
  (standing still or reversing) it falls back to a plain turn rate instead
  — the slip-angle math depends on `atan2` against the car's own forward
  speed and gets unstable/discontinuous close to a standstill, and this
  game's reverse is really just a back-up utility, not a driving mode
  worth full tire physics. Grip (`TIRE_GRIP_MU`, cornering stiffness) is
  tuned so an everyday turn has real headroom — losing grip and spinning
  out takes genuinely hard, sustained steering at speed, not routine
  cornering — and `YAW_DAMPING` adds a bit of extra yaw-rate decay standing
  in for the steering self-centering/tire scrub the pure bicycle model
  doesn't otherwise capture. Holding the brake once you're essentially
  stopped shifts into a dedicated, gentler `REVERSE_FORCE` instead of
  reusing full brake strength — backing up shouldn't feel like slamming
  the brakes.
- **Wheels actually turn now — rolling and steering both.** Previously
  nothing on the car ever spun; only the front wheels' steering angle was
  animated. `findCarWheels()` (`js/main.js`) looks for any node whose name
  contains "wheel" inside a loaded car model, classifies front/rear and
  left/right purely from each one's own world position (so it needs no
  per-car hardcoding), and wraps the two front ones in their own steering
  pivot — the same idea the placeholder car's own `frontWheelPivots`
  already used — so steering and rolling animate on independent axes
  instead of fighting over the same one. `placeholderWheelSpin()` gives the
  primitive fallback car the same rolling animation. A model with no
  separately-named wheel nodes (a single fused body mesh) just keeps
  looking static, same as before this existed — never a hard requirement.
- **The road itself curves and climbs.** `curvatureAt(s)` and
  `elevationAt(s)` (in `js/main.js`) are small sums of sine waves in terms of
  distance-traveled `s`. Each frame, the car's heading is integrated forward
  by `curvatureAt(s) * ds`, which is what makes the road sweep into gentle
  S-curves instead of running dead straight, the way SlowRoads' roads do.
- **Chunk streaming, not per-object recycling.** The road/terrain/guardrails
  are triangle-strip "ribbons" built from sampled points along that curving
  path, generated once per ~160-unit chunk (`buildChunk`), together with that
  chunk's scenery. As the car drives, `ensureChunks` builds the next chunk
  ahead and disposes the one that's fully behind.
- **Everyone races the identical road.** `js/main.js` has a seeded RNG
  (`mulberry32`) used for every scenery-placement decision. When a race
  starts, the server picks one random seed and broadcasts it; every client
  calls `resetTrack(seed)` and rebuilds the same chunks in the same order, so
  the curves and hills line up perfectly across screens even though nothing
  about the track geometry itself is transmitted over the network — only
  each player's live distance/lane position is.
- **Networking is deliberately thin.** `js/net.js` is a small WebSocket
  pub/sub wrapper; `server/server.js` just relays `{distance, laneOffset,
  speed}` between players at ~12Hz and tracks race/finish state. Each
  client reconstructs everyone else's car position itself via `sampleAt()`
  on the shared road — no server-side physics.
- **Day/night cycle.** `updateSky` derives a sun and moon position from
  elapsed real time (`DAY_LENGTH` = 110s per full cycle) and cross-fades sky,
  fog, and light color between them, layered on top of the existing
  desert/hills blend.
- **Scenery is solid, not decorative.** Every prop each chunk places gets a
  matching entry in that chunk's `colliders` list (`buildChunk` in
  `js/main.js`). `checkSceneryCollisions` runs each frame and, if the car's
  position overlaps one, shoves `laneOffset` back out along the road's
  lateral axis, kills speed, applies knockback/damage, and starts a
  per-prop cooldown — driving off-road into a tree/cactus/mesa/mountain is a
  real hit, the same physical language as ramming another car, not a
  pass-through.
- **Hills ↔ desert**: a smooth sine-wave blend (`biomeBlendAt` in
  `js/main.js`) picks which terrain props (pine trees/mountains vs.
  cacti/mesas) get built into each chunk and tints the terrain ribbon's
  vertex colors, so the crossfade has no visible seams.
- **Bloom is hand-rolled, not an addon.** This project vendors only core
  three.js (see below), and the official bloom (`UnrealBloomPass` etc.) lives
  in `examples/jsm` as ES modules that don't fit a plain-`<script>`,
  no-build-step project. `renderWithBloom` in `js/main.js` does the same idea
  by hand: render the scene once to an offscreen target, threshold+blur the
  bright pixels (neon rails, headlights, sun/moon) at a small fixed
  resolution, then blit scene+glow (plus a touch of film grain) to the
  canvas in one final pass. Every pass uses the same `#include
  <tonemapping_fragment>` / `<colorspace_fragment>` chunks three.js's own
  materials use, so it grades consistently with the rest of the renderer.
- **Nitro only ever fills from pickups.** Each chunk has a chance of placing
  a glowing orb on the pavement (`buildChunk` in `js/main.js`); driving
  through one (`checkNitroPickups`) tops up the NOS bar. There's no passive
  regen — holding `X` (`updateCombat`'s sibling, the nitro block in
  `update()`) spends the tank for a real accel/top-speed bonus until it's
  empty, then you have to go find another orb.
- **Ramps are real ribbon geometry, not a sprite.** A ramp is the exact same
  `buildRibbon()` used for the road/rails, just eased up to `RAMP_HEIGHT`
  over its length, so it automatically follows the road's curve. Crossing
  one fast enough (`checkRamps`) launches the car under actual gravity
  (`updateAirborne`) — height, arc, and the nose-tilt while airborne all
  come from real vertical velocity, not a canned animation.
- `lib/three.min.js` was vendored from `three@0.160.0` on npm. To update it,
  run `npm install three@<version>` somewhere and copy
  `node_modules/three/build/three.min.js` over this file.
- **Pick a car, with a placeholder fallback.** The gate has a "Choose your
  car" picker (`CAR_DEFS` in `js/main.js`) backed by four real glTF models
  in `assets/models/`; the choice persists in `localStorage`. Picking one
  loads it via `lib/GLTFLoader.js` and swaps it in over the primitive
  box-built car once ready, auto-scaled/grounded to match the placeholder's
  footprint. Switching cars again before a slow load finishes doesn't race
  — `carLoadToken` is bumped on every selection, and a load that resolves
  after being superseded just discards its own result instead of attaching
  stale geometry. `GLTFLoader.js` is three.js's own loader — it only ships
  as an ES module in `examples/jsm`, which doesn't fit this project's
  plain-`<script>` setup, so it's adapted into a global script the same way
  `js/main.js`'s hand-rolled bloom pass avoids needing `EffectComposer`:
  only the `import`/`export` lines were touched, the loader body is stock.
  If a model or the loader fails to load for any reason, the primitive car
  is simply left in place — it's never a hard dependency for the game to
  run. The fetch-scale-ground logic itself lives in one shared
  `fetchAndFitCarModel()`, reused by both the player's own car and any
  ghost car (see below) that wants a real model too — one codepath, not
  two copies to keep in sync.
- **The computer opponent gets a real car too.** Ghost cars (`buildGhostCar`,
  used for the computer opponent and any networked player) have the same
  placeholder/real-model split as the player's own car. The computer
  opponent picks a random one of the four cars each race
  (`maybeLoadGhostCarModel`) rather than choosing from the picker, since
  there's no real "choice" for an AI to make.
- **Trees and grass are real models too, same pattern.** `assets/models/tree.glb`
  and `grass.glb` load the same way as the car. `buildPine()` just checks
  whether the tree model has loaded each time it's called — chunks already
  built keep their procedural pine cones, chunks built after it's ready
  automatically get the real tree. Grass has no procedural equivalent at
  all; it's pure ground clutter scattered close to the shoulder
  (`GRASS_PER_CHUNK` in `js/main.js`), and a chunk simply goes without it
  until the model loads.

## Also available as a single file

A self-contained, single-HTML-file build (three.js *and* all six models
inlined — each as its own base64 `data:` URI, since the single file has no
adjacent `assets/` folder to fetch them from) lives at `../card-drive.html`
one level up — handy for sharing without the folder. It's a genuinely
large file now (~15MB), almost entirely because of `gt-supercar.glb`
(~8MB on its own, a much higher-detail model/texture set than the other
three selectable cars). **It only ever plays
solo** (`js/net.js` has no server to reach when opened this way, so it
falls back gracefully). It's generated from this project, not
hand-maintained: after editing `index.html`, `css/style.css`, `js/net.js`,
or `js/main.js`, regenerate it with:

```bash
python3 build.py
```
