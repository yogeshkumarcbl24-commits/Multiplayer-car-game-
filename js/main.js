(function(){
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     PALETTE
  ============================================================ */
  var PALETTE = {
    void:  0x05060f,
    deep:  0x0c1024,
    magenta: 0xff2e88,
    cyan:  0x2fe6ff,
    gold:  0xffc94d,
    violet: 0x9b6bff,
    fogText: 0xdfe3ff
  };

  var BIOME = {
    DESERT: { name:'Desert', fog:0xe8b382, sky:0xffd9a0, ground:new THREE.Color(0xc98a52) },
    HILLS:  { name:'Hills',  fog:0xaed4ef, sky:0x8ec9ff, ground:new THREE.Color(0x4a8a5c) }
  };
  var NIGHT_FOG = new THREE.Color(0x232c52);
  var NIGHT_SKY = new THREE.Color(0x161d3c);
  var _zenithBase = new THREE.Color(0x0a1030);
  var _cZenith = new THREE.Color();

  /* ============================================================
     RENDERER / SCENE / CAMERA
  ============================================================ */
  var wrap = document.getElementById('canvas-wrap');
  var renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.void);
  scene.fog = new THREE.FogExp2(PALETTE.void, 0.013);

  var camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.1, 420);

  /* ============================================================
     ENVIRONMENT MAP  (so clearcoat paint / metal actually reflects
     the sky instead of only responding to direct light). Built from
     a tiny standalone gradient scene -- not the real one, which
     would be far more expensive to capture every refresh -- and
     regenerated every few seconds to track the current sky color.
  ============================================================ */
  var _skyTmp = new THREE.Color();
  var pmremGenerator = new THREE.PMREMGenerator(renderer);
  var envScene = new THREE.Scene();
  var envGeo = new THREE.SphereGeometry(1, 12, 8);
  var envColorAttr = new THREE.BufferAttribute(new Float32Array(envGeo.attributes.position.count*3), 3);
  envGeo.setAttribute('color', envColorAttr);
  var envSphere = new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.BackSide }));
  envScene.add(envSphere);
  var lastEnvRT = null;
  function refreshEnvironment(horizonColor, zenithColor){
    var pos = envGeo.attributes.position;
    for (var i=0;i<pos.count;i++){
      var t = (pos.getY(i) + 1) / 2;
      _skyTmp.copy(horizonColor).lerp(zenithColor, t);
      envColorAttr.setXYZ(i, _skyTmp.r, _skyTmp.g, _skyTmp.b);
    }
    envColorAttr.needsUpdate = true;
    try {
      var rt = pmremGenerator.fromScene(envScene, 0.03, 0.1, 10);
      scene.environment = rt.texture;
      if (lastEnvRT) lastEnvRT.dispose();
      lastEnvRT = rt;
    } catch (e){ /* reflections are a nice-to-have; ignore failures and keep going */ }
  }

  window.addEventListener('resize', function(){
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ============================================================
     LIGHTS  (sun + moon cross-fade for the day/night cycle)
  ============================================================ */
  var hemiLight = new THREE.HemisphereLight(0x5a6099, 0x2a2c3f, 0.9);
  scene.add(hemiLight);

  var sunLight = new THREE.DirectionalLight(0xffe6c0, 1.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1536, 1536);
  sunLight.shadow.camera.near = 5;
  sunLight.shadow.camera.far = 160;
  sunLight.shadow.camera.left = -30;
  sunLight.shadow.camera.right = 30;
  sunLight.shadow.camera.top = 30;
  sunLight.shadow.camera.bottom = -30;
  sunLight.shadow.bias = -0.0015;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  var moonLight = new THREE.DirectionalLight(0x8fa8ff, 0.25);
  scene.add(moonLight);

  /* ============================================================
     TEXTURE HELPERS
  ============================================================ */
  function roundedRectPath(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    ctx.closePath();
  }

  function makeGlowTexture(){
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(64,64,0,64,64,64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(c);
  }

  function makeRoadTexture(){
    var W = 512, H = 1024;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#3c3e46';
    ctx.fillRect(0,0,W,H);

    // asphalt grain -- layered speckle at a few scales instead of a synthetic
    // grid, so the road reads as a real worn surface up close
    for (var pass=0; pass<3; pass++){
      var count = pass === 0 ? 3200 : pass === 1 ? 1400 : 500;
      var rMin = pass === 0 ? 0.4 : pass === 1 ? 0.9 : 1.6;
      var rSpread = pass === 0 ? 0.6 : pass === 1 ? 1.1 : 1.8;
      for (var i=0;i<count;i++){
        var gx = Math.random()*W, gy = Math.random()*H, gr = rMin + Math.random()*rSpread;
        var light = Math.random() < 0.5;
        ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
        ctx.beginPath();
        ctx.arc(gx, gy, gr, 0, Math.PI*2);
        ctx.fill();
      }
    }
    // faint tire wear streaks down the main wheel tracks
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 34;
    [W*0.32, W*0.68].forEach(function(wx){
      ctx.beginPath();
      ctx.moveTo(wx, 0);
      ctx.lineTo(wx, H);
      ctx.stroke();
    });

    var gL = ctx.createLinearGradient(0,0,52,0);
    gL.addColorStop(0,'rgba(47,230,255,0.55)');
    gL.addColorStop(1,'rgba(47,230,255,0)');
    ctx.fillStyle = gL;
    ctx.fillRect(0,0,52,H);
    var gR = ctx.createLinearGradient(W-52,0,W,0);
    gR.addColorStop(0,'rgba(255,46,136,0)');
    gR.addColorStop(1,'rgba(255,46,136,0.55)');
    ctx.fillStyle = gR;
    ctx.fillRect(W-52,0,52,H);

    ctx.fillStyle = 'rgba(223,227,255,0.65)';
    var dashH = 92, gap = 68;
    for (var yy=0; yy<H; yy += dashH+gap){
      ctx.fillRect(W/2-8, yy, 16, dashH);
    }

    var tex = new THREE.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  // A synthetic normal map: mostly-flat (128,128,255 = "straight up") with
  // small random tilts baked in, so the sun's lighting actually ripples
  // across the surface instead of a flat color texture looking perfectly
  // smooth under direct light. NOT sRGB-encoded -- normal maps store
  // directions, not colors, so this must stay in linear space.
  function makeNormalTexture(strength){
    var W = 256, H = 256;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0,0,W,H);
    for (var i=0;i<1400;i++){
      var x = Math.random()*W, y = Math.random()*H, r = 0.6 + Math.random()*1.8;
      var nx = 128 + (Math.random()-0.5)*strength;
      var ny = 128 + (Math.random()-0.5)*strength;
      var nz = 235 + Math.random()*18;
      ctx.fillStyle = 'rgb(' + nx.toFixed(0) + ',' + ny.toFixed(0) + ',' + nz.toFixed(0) + ')';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fill();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function makeSpeckleTexture(){
    var W = 256, H = 256;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#bfbfbf';
    ctx.fillRect(0,0,W,H);
    for (var pass=0; pass<2; pass++){
      var count = pass === 0 ? 900 : 220;
      var rr0 = pass === 0 ? 0.5 : 2.2;
      var rrSpread = pass === 0 ? 1.4 : 2.6;
      for (var i=0;i<count;i++){
        var rx = Math.random()*W, ry = Math.random()*H, rr = rr0 + Math.random()*rrSpread;
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
        ctx.beginPath();
        ctx.arc(rx, ry, rr, 0, Math.PI*2);
        ctx.fill();
      }
    }
    var tex = new THREE.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  var glowTex = makeGlowTexture();

  function smoothstep(x, a, b){
    var t = Math.max(0, Math.min(1, (x-a)/(b-a)));
    return t*t*(3-2*t);
  }
  function lerp(a,b,t){ return a+(b-a)*t; }

  /* ============================================================
     SEEDED RNG  (for multiplayer: track-generation call sites --
     scenery placement -- draw from `rng()` instead of Math.random(),
     so racers who share a seed see an identical road. Solo play
     just uses real Math.random() as the source.
  ============================================================ */
  function mulberry32(seed){
    seed = seed >>> 0;
    return function(){
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = Math.random;

  /* ============================================================
     BIOME BLEND  (desert <-> hills, independent of the day cycle)
  ============================================================ */
  var BIOME_HALF_LEN = 220;
  function biomeBlendAt(s){
    // 0 = full desert, 1 = full hills, smooth sine crossfade between
    return 0.5 + 0.5*Math.sin(s / BIOME_HALF_LEN * Math.PI);
  }
  function biomeAt(s){
    return biomeBlendAt(s) < 0.5 ? 'desert' : 'hills';
  }
  var _cA = new THREE.Color(), _cB = new THREE.Color(), _cC = new THREE.Color();
  function groundColorAt(s, out){
    out.copy(BIOME.DESERT.ground).lerp(BIOME.HILLS.ground, biomeBlendAt(s));
    return out;
  }

  /* ============================================================
     ROAD PATH  (procedurally generated curves + rolling hills,
     integrated forward one small step at a time -- this is what
     lets the road wind and climb like SlowRoads instead of being
     a straight lane.)
  ============================================================ */
  var ROAD_WIDTH = 9;
  var maxLane = ROAD_WIDTH/2 - 1.1; // the paved road's own half-width, used for the starting grid and the lane
                                     // indicator -- NOT a hard clamp on the car anymore, see MAX_OFFROAD below
  var TERRAIN_HALF_WIDTH = 64;
  var MAX_OFFROAD = TERRAIN_HALF_WIDTH - 6; // driving badly can genuinely put you off the road and onto the
                                             // shoulder/open terrain -- this only stops you at the edge of the
                                             // rendered world, not at the edge of the pavement
  var SAMPLE_STEP = 4;
  var CHUNK_LEN = 160;
  var BANK_K = 3.2;

  function curvatureAt(s){
    return 0.0105*Math.sin(s*0.0150 + 1.2) +
           0.0060*Math.sin(s*0.0043 + 4.0) +
           0.0040*Math.sin(s*0.0331 + 2.1);
  }
  function elevationAt(s){
    return 3.2*Math.sin(s*0.0100 + 0.5) +
           1.6*Math.sin(s*0.0260 + 2.3) +
           0.7*Math.sin(s*0.0650 + 4.4);
  }
  function slopeAt(s){
    var e = 0.6;
    return (elevationAt(s+e) - elevationAt(s-e)) / (2*e);
  }

  var pathCursor = { s:0, x:0, z:0, heading:0 };
  function sampleFromCursor(){
    return {
      s: pathCursor.s, x: pathCursor.x, z: pathCursor.z,
      y: elevationAt(pathCursor.s), heading: pathCursor.heading,
      bank: -curvatureAt(pathCursor.s) * BANK_K
    };
  }
  var lastSample = sampleFromCursor();

  function advancePathTo(targetS){
    var out = [];
    while (pathCursor.s < targetS - 1e-6){
      var ds = Math.min(SAMPLE_STEP, targetS - pathCursor.s);
      var curv = curvatureAt(pathCursor.s + ds*0.5);
      pathCursor.heading += curv * ds;
      pathCursor.x += Math.sin(pathCursor.heading) * ds;
      pathCursor.z += -Math.cos(pathCursor.heading) * ds;
      pathCursor.s += ds;
      out.push(sampleFromCursor());
    }
    return out;
  }

  function frameAtSamples(samples, s){
    if (s <= samples[0].s) return samples[0];
    var last = samples[samples.length-1];
    if (s >= last.s) return last;
    for (var i=0;i<samples.length-1;i++){
      var a = samples[i], b = samples[i+1];
      if (s >= a.s && s <= b.s){
        var t = (s - a.s) / (b.s - a.s);
        return {
          s: s,
          x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), z: lerp(a.z,b.z,t),
          heading: lerp(a.heading,b.heading,t), bank: lerp(a.bank,b.bank,t)
        };
      }
    }
    return last;
  }

  var chunks = [];
  function sampleAt(s){
    for (var i=0;i<chunks.length;i++){
      var c = chunks[i];
      var first = c.samples[0], last = c.samples[c.samples.length-1];
      if (s >= first.s && s <= last.s) return frameAtSamples(c.samples, s);
    }
    if (chunks.length){
      var lc = chunks[chunks.length-1];
      if (s > lc.samples[lc.samples.length-1].s) return lc.samples[lc.samples.length-1];
      return chunks[0].samples[0];
    }
    return { s:s, x:0, y:elevationAt(s), z:0, heading:0, bank:0 };
  }

  /* ---- ribbon mesh builder, shared by road / terrain / guardrails ---- */
  function buildRibbon(samples, halfWidth, opts){
    opts = opts || {};
    var center = opts.centerOffset || 0;
    var n = samples.length;
    var positions = new Float32Array(n*2*3);
    var uvs = new Float32Array(n*2*2);
    var colors = opts.colorFn ? new Float32Array(n*2*3) : null;
    var col = new THREE.Color();
    for (var i=0;i<n;i++){
      var sm = samples[i];
      var px = Math.cos(sm.heading), pz = Math.sin(sm.heading);
      // bank tilts the whole cross-section: a ribbon offset from the road's
      // centerline (like a guardrail) needs to rise/fall by how far *it* sits
      // from center, not by its own (possibly tiny) half-width, or it won't
      // track the banked road surface beneath it.
      var centerBankOff = opts.bank ? Math.sin(sm.bank) * center * 0.35 : 0;
      var bankOff = opts.bank ? Math.sin(sm.bank) * halfWidth * 0.35 : 0;
      var yBase = sm.y + (opts.yOffset || 0) + centerBankOff;
      var latL = center - halfWidth, latR = center + halfWidth;
      positions[i*6+0] = sm.x + px*latL;
      positions[i*6+1] = yBase - bankOff;
      positions[i*6+2] = sm.z + pz*latL;
      positions[i*6+3] = sm.x + px*latR;
      positions[i*6+4] = yBase + bankOff;
      positions[i*6+5] = sm.z + pz*latR;
      var v = sm.s / (opts.uvTile || 8);
      uvs[i*4+0] = 0; uvs[i*4+1] = v;
      uvs[i*4+2] = 1; uvs[i*4+3] = v;
      if (colors){
        opts.colorFn(sm.s, col);
        colors[i*6+0]=col.r; colors[i*6+1]=col.g; colors[i*6+2]=col.b;
        colors[i*6+3]=col.r; colors[i*6+4]=col.g; colors[i*6+5]=col.b;
      }
    }
    var indices = [];
    for (var j=0;j<n-1;j++){
      var a=j*2, b=j*2+1, c2=j*2+2, d=j*2+3;
      indices.push(a,b,c2, b,d,c2);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs,2));
    if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  var roadTex = makeRoadTexture();
  var roadNormalTex = makeNormalTexture(70);
  var roadMat = new THREE.MeshStandardMaterial({
    map: roadTex, normalMap: roadNormalTex, normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.75, metalness: 0.15,
    emissive: new THREE.Color(0x2a2f48), emissiveIntensity: 0.3
  });
  var speckleTex = makeSpeckleTexture();
  var terrainNormalTex = makeNormalTexture(45);
  var terrainMat = new THREE.MeshStandardMaterial({
    map: speckleTex, normalMap: terrainNormalTex, normalScale: new THREE.Vector2(0.4, 0.4),
    vertexColors: true, roughness: 1
  });
  var railMatL = new THREE.MeshStandardMaterial({ color: 0x2a2e4a, emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 1.2, roughness: 0.4 });
  var railMatR = new THREE.MeshStandardMaterial({ color: 0x2a2e4a, emissive: new THREE.Color(PALETTE.magenta), emissiveIntensity: 1.2, roughness: 0.4 });

  /* ============================================================
     SCENERY PROP PROTOTYPES  (cactus/mesa for desert, pine/mountain for hills)
     A few shade variants per type (picked at random per-prop) so a dense
     treeline doesn't read as one mesh copy-pasted everywhere.
  ============================================================ */
  var cactusMats = [0x2f8f5b, 0x2a7d4f, 0x37a06a].map(function(c){
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  });
  var pineFoliageMats = [0x1f6b3a, 0x276e34, 0x1a5c40].map(function(c){
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  });
  var pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
  var mesaMats = [0xaa5a34, 0xb9663a, 0x9c5230].map(function(c){
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
  });
  var mountainMats = [0x5a5f8f, 0x656a9c, 0x4f5480].map(function(c){
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
  });
  var cactusFlowerMat = new THREE.MeshStandardMaterial({ color: 0xff7fb0, roughness: 0.6, emissive: new THREE.Color(0x7a0f3c), emissiveIntensity: 0.3 });

  var cactusTrunkGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.6, 7);
  var cactusArmGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6);
  var cactusFlowerGeo = new THREE.SphereGeometry(0.11, 6, 6);
  var pineTrunkGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6);
  var pineFoliageGeo = new THREE.ConeGeometry(0.5, 1.1, 8);      // top tier -- narrow crown
  var pineFoliageLowerGeo = new THREE.ConeGeometry(0.78, 1.15, 8); // bottom tier -- wide skirt, for a fuller fir silhouette
  var mesaGeo = new THREE.BoxGeometry(1, 1, 1);
  var mountainGeo = new THREE.ConeGeometry(1, 1, 5);

  function pick(arr){ return arr[Math.floor(rng()*arr.length)]; }

  function buildCactus(){
    var g = new THREE.Group();
    var mat = pick(cactusMats);
    var trunk = new THREE.Mesh(cactusTrunkGeo, mat);
    trunk.position.y = 0.8;
    g.add(trunk);
    [-1,1].forEach(function(side){
      var arm = new THREE.Mesh(cactusArmGeo, mat);
      arm.position.set(side*0.22, 0.95, 0);
      arm.rotation.z = side * 0.9;
      g.add(arm);
    });
    // roughly a third of cacti get a little bloom on top -- a small splash
    // of color against all the green/sand so the desert doesn't feel flat
    if (rng() < 0.35){
      var flower = new THREE.Mesh(cactusFlowerGeo, cactusFlowerMat);
      flower.position.y = 1.65;
      g.add(flower);
    }
    g.userData.collideRadius = 0.4;
    return g;
  }
  function buildPine(){
    if (treeModelProto) return buildTreeModel();
    var g = new THREE.Group();
    var mat = pick(pineFoliageMats);
    var trunk = new THREE.Mesh(pineTrunkGeo, pineTrunkMat);
    trunk.position.y = 0.3;
    g.add(trunk);
    var foliageLower = new THREE.Mesh(pineFoliageLowerGeo, mat);
    foliageLower.position.y = 0.95;
    g.add(foliageLower);
    var foliage = new THREE.Mesh(pineFoliageGeo, mat);
    foliage.position.y = 1.65;
    g.add(foliage);
    g.userData.collideRadius = 0.55;
    return g;
  }
  function buildMesa(){
    var m = new THREE.Mesh(mesaGeo, pick(mesaMats));
    m.scale.set(3+rng()*4, 3+rng()*5, 3+rng()*4);
    m.position.y = m.scale.y/2;
    m.userData.collideRadius = m.scale.x * 0.5;
    return m;
  }
  function buildMountain(){
    var m = new THREE.Mesh(mountainGeo, pick(mountainMats));
    m.scale.set(6+rng()*5, 7+rng()*7, 6+rng()*5);
    m.position.y = m.scale.y/2;
    m.rotation.y = rng()*Math.PI;
    m.userData.collideRadius = m.scale.x;
    return m;
  }

  function buildSceneryProp(biome, far){
    var prop = biome === 'desert' ? (far ? buildMesa() : buildCactus()) : (far ? buildMountain() : buildPine());
    prop.traverse(function(obj){
      if (obj.isMesh){ obj.castShadow = true; obj.receiveShadow = true; }
    });
    return prop;
  }

  /* ============================================================
     REAL TREE / GRASS MODELS  (optional, same "never a hard
     dependency" pattern as the car model. buildPine() below just
     checks treeModelProto each time it's called -- chunks already
     built before the model loads keep their procedural pine, chunks
     built afterward automatically get the real one. Grass has no
     procedural fallback at all -- it's pure decoration, so a chunk
     just goes without it until the model is ready.)
  ============================================================ */
  var treeModelProto = null, treeModelRadius = 0.55;
  var grassModelProto = null;
  if (window.THREE && THREE.GLTFLoader){
    new THREE.GLTFLoader().load(window.TREE_MODEL_DATA_URI || 'assets/models/tree.glb', function(gltf){
      var model = gltf.scene;
      model.traverse(function(o){ if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
      var box = new THREE.Box3().setFromObject(model);
      var scale = 2.3 / Math.max(box.getSize(new THREE.Vector3()).y, 0.0001); // ~matches the procedural pine's own height
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      box.setFromObject(model);
      var center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
      var finalSize = box.getSize(new THREE.Vector3());
      treeModelRadius = Math.max(finalSize.x, finalSize.z) * 0.3; // canopy silhouette is narrower than the full bbox diagonal
      treeModelProto = model;
    }, undefined, function(err){
      console.warn('Tree model failed to load -- using the procedural pine instead.', err);
    });

    new THREE.GLTFLoader().load(window.GRASS_MODEL_DATA_URI || 'assets/models/grass.glb', function(gltf){
      var model = gltf.scene;
      model.traverse(function(o){ if (o.isMesh){ o.receiveShadow = true; } });
      model.updateMatrixWorld(true);
      var box = new THREE.Box3().setFromObject(model);
      model.position.y -= box.min.y; // sit flush on the ground like everything else here
      grassModelProto = model;
    }, undefined, function(err){
      console.warn('Grass model failed to load -- skipping the extra ground clutter.', err);
    });
  }
  function buildTreeModel(){
    var g = treeModelProto.clone();
    g.userData.collideRadius = treeModelRadius;
    return g;
  }
  function buildGrassClump(){
    return grassModelProto.clone();
  }

  /* ============================================================
     NITRO PICKUPS  (spinning orbs on the pavement -- drive through one
     to fill the NOS tank; it never refills on its own)
  ============================================================ */
  var nitroPickupGeo = new THREE.IcosahedronGeometry(0.42, 0);
  var nitroPickupMat = new THREE.MeshStandardMaterial({
    color: 0x2fe6ff, emissive: new THREE.Color(0x2fe6ff), emissiveIntensity: 1.6,
    roughness: 0.25, metalness: 0.5
  });
  var nitroPickupGlowMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0x2fe6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  function buildNitroPickup(){
    var g = new THREE.Group();
    var core = new THREE.Mesh(nitroPickupGeo, nitroPickupMat);
    core.castShadow = true;
    g.add(core);
    // shared glow sprite material (not cloned) -- nothing here varies per
    // instance, so there's nothing to dispose per-chunk either
    var glow = new THREE.Sprite(nitroPickupGlowMat);
    glow.scale.set(1.7, 1.7, 1);
    g.add(glow);
    return g;
  }

  /* ============================================================
     RAMPS  (a raised ribbon segment, same buildRibbon() geometry as
     the road/rails, so it automatically follows the road's curve and
     bank instead of needing its own trig -- fast enough to launch off
     of catches real air)
  ============================================================ */
  var rampMat = new THREE.MeshStandardMaterial({
    color: 0xffc94d, roughness: 0.55, metalness: 0.2,
    emissive: new THREE.Color(0x3a2200), emissiveIntensity: 0.35
  });

  /* ============================================================
     THE CAR  (built from primitives, chased by the camera)
  ============================================================ */
  var car = new THREE.Group();
  car.rotation.order = 'YXZ';

  var bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd6dcec, roughness: 0.35, metalness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.12 });
  var trimMat = new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: new THREE.Color(PALETTE.cyan), emissiveIntensity: 1.4, roughness: 0.3 });
  var glassMat = new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.1, metalness: 0.8 });
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.9 });
  var headlightMat = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  var taillightMat = new THREE.MeshBasicMaterial({ color: PALETTE.magenta });

  // Every purely-cosmetic body/wheel part lives in carPlaceholder rather than
  // directly on `car`, so if a real model (see CAR MODEL section below)
  // loads successfully, hiding this one group swaps the whole placeholder
  // out in a single line -- lights, gun, and underglow stay on `car`
  // itself and keep working either way.
  var carPlaceholder = new THREE.Group();
  car.add(carPlaceholder);

  var chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 3.6), bodyMat);
  chassis.position.y = 0.5;
  carPlaceholder.add(chassis);

  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.42, 1.55), glassMat);
  cabin.position.set(0, 0.88, -0.1);
  cabin.rotation.x = -0.1;
  carPlaceholder.add(cabin);

  var hood = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 1.15), bodyMat);
  hood.position.set(0, 0.7, -1.55);
  hood.rotation.x = 0.14;
  carPlaceholder.add(hood);

  var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.28), bodyMat);
  spoiler.position.set(0, 0.92, 1.75);
  carPlaceholder.add(spoiler);
  [-1,1].forEach(function(side){
    var strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), bodyMat);
    strut.position.set(side*0.7, 0.78, 1.75);
    carPlaceholder.add(strut);
  });

  [-1,1].forEach(function(side){
    var strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 3.4), trimMat);
    strip.position.set(side*0.87, 0.42, 0);
    carPlaceholder.add(strip);
  });

  var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  // Every wheel mesh gets collected here so its rolling spin can be
  // animated each frame (placeholderWheelSpin below) -- separate from
  // steering, which for the front wheels is still the pivot's own job.
  var placeholderWheelMeshes = [];
  // Front wheels sit inside their own pivot group so they can turn on their
  // own axis with the steering input, same as a real steering knuckle --
  // the wheel mesh is centered in the pivot, and the pivot carries the
  // actual axle position, so rotating the pivot's Y turns just the wheel.
  var frontWheelPivots = [-0.86, 0.86].map(function(x){
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI/2;
    placeholderWheelMeshes.push(wheel);
    var pivot = new THREE.Group();
    pivot.position.set(x, 0.36, -1.15);
    pivot.add(wheel);
    carPlaceholder.add(pivot);
    return pivot;
  });
  [[-0.86,0.36,1.25],[0.86,0.36,1.25]].forEach(function(p){
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI/2;
    wheel.position.set(p[0], p[1], p[2]);
    placeholderWheelMeshes.push(wheel);
    carPlaceholder.add(wheel);
  });
  // Rolling spin lives on rotation.y, applied (per Euler XYZ composition
  // order) *before* the fixed rotation.z=PI/2 that lies the cylinder on
  // its side -- so it spins around the cylinder's own original axle axis
  // (real rolling), not around the axle's own length (which would just
  // spin it in place like a coin).
  function placeholderWheelSpin(angle){
    for (var i = 0; i < placeholderWheelMeshes.length; i++) placeholderWheelMeshes[i].rotation.y = angle;
  }

  [-0.55,0.55].forEach(function(x){
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), headlightMat);
    hl.position.set(x, 0.55, -1.82);
    carPlaceholder.add(hl);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), taillightMat);
    tl.position.set(x, 0.6, 1.82);
    carPlaceholder.add(tl);
  });

  var underGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), new THREE.MeshBasicMaterial({
    map: glowTex, color: PALETTE.violet, transparent:true, opacity:0.55,
    blending: THREE.AdditiveBlending, depthWrite:false
  }));
  underGlow.rotation.x = -Math.PI/2;
  underGlow.position.y = 0.03;
  car.add(underGlow);

  // roof-mounted gun -- purely a visual prop; firing spawns a separate projectile
  var gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2e4a, roughness: 0.4, metalness: 0.6 });
  var gunMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), trimMat);
  gunMount.position.set(0, 1.05, -0.55);
  car.add(gunMount);
  var gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 10), gunMat);
  gunBarrel.rotation.x = Math.PI/2;
  gunBarrel.position.set(0, 1.08, -1.15);
  car.add(gunBarrel);

  var headL = new THREE.SpotLight(0xeaffff, 8, 24, Math.PI/6, 0.5, 1.2);
  headL.position.set(-0.55, 0.6, -1.9);
  headL.target.position.set(-0.55, 0, -14);
  car.add(headL, headL.target);
  var headR = new THREE.SpotLight(0xeaffff, 8, 24, Math.PI/6, 0.5, 1.2);
  headR.position.set(0.55, 0.6, -1.9);
  headR.target.position.set(0.55, 0, -14);
  car.add(headR, headR.target);

  car.traverse(function(obj){
    if (obj.isMesh){ obj.castShadow = true; obj.receiveShadow = true; }
  });
  underGlow.castShadow = false;
  underGlow.receiveShadow = false;

  scene.add(car);
  scene.add(camera);

  /* ============================================================
     CAR MODEL  (pick from a few real glTF models, swapped in over
     the primitive placeholder once the chosen one loads. If
     lib/GLTFLoader.js didn't load, a file is missing, or parsing
     fails for any reason, this just quietly leaves the placeholder
     car in place -- never a hard dependency for the game to run.)
  ============================================================ */
  var CAR_TARGET_LENGTH = 3.9; // world units -- close to the placeholder chassis's own length
  var CAR_MODEL_YAW = Math.PI; // default rotation to align a model's forward with the car's own (-Z)
  var CAR_DEFS = [
    { id: 'hyper-gt',     name: 'Hyper GT',      color: '#ff5a4d', file: 'hyper-gt.glb',     dataUriKey: 'CAR_MODEL_DATA_URI' },
    { id: 'mister-beef',  name: 'Mister Beef',   color: '#ffcf4d', file: 'mister-beef.glb',  dataUriKey: 'CAR2_MODEL_DATA_URI' },
    { id: 'fast-charger', name: 'Fast Charger',  color: '#37d6ff', file: 'fast-charger.glb', dataUriKey: 'CAR3_MODEL_DATA_URI' },
    // gt-supercar.glb comes from a different export tool (SimLab, not
    // Blender like the other three) and doesn't share their forward-axis
    // convention -- it was sitting broadside instead of nose-forward with
    // the shared default, so it gets its own yaw override.
    { id: 'gt-supercar',  name: 'GT Supercar',   color: '#9b6bff', file: 'gt-supercar.glb',  dataUriKey: 'CAR4_MODEL_DATA_URI', yaw: Math.PI / 2 }
  ];
  var CAR_ID_STORAGE_KEY = 'cardDriveCarId';
  var selectedCarId = CAR_DEFS[0].id;
  try {
    var storedCarId = localStorage.getItem(CAR_ID_STORAGE_KEY);
    if (storedCarId && CAR_DEFS.some(function(d){ return d.id === storedCarId; })) selectedCarId = storedCarId;
  } catch (e){ /* localStorage can throw in some privacy modes -- just fall back to the default car */ }

  var loadedCarModel = null; // the currently-attached real model, if any, so switching cars can remove the old one
  var carLoadToken = 0;      // bumped on every selection change, so a slow load that finishes after the user
                              // picked something else knows to discard its own result instead of attaching stale geometry
  // Finds real wheel geometry inside a loaded car model, if any, so it can
  // actually spin/steer instead of sitting static -- generic by name match
  // ("wheel" anywhere in a node's name, case-insensitive) rather than
  // hardcoded per car, so any future car model with sensibly-named wheel
  // nodes picks this up automatically. Classifies front/rear and left/right
  // by each candidate's own WORLD position (must be called after the
  // model's fit/yaw/ground transform and an updateMatrixWorld) relative to
  // the model's own world-space center, so it's correct regardless of the
  // model's original authored orientation. Models with no separately-
  // named wheel nodes (a single fused body mesh, common for simpler
  // models) just get an empty result -- they keep looking static, same as
  // before this existed, never a hard requirement.
  // Wraps a wheel node in its own steering pivot, sibling to wherever it
  // already lives in the model's hierarchy -- exactly the placeholder
  // car's own frontWheelPivots idea, so steering (the pivot's rotation.y)
  // and rolling (the wheel's own rotation, on whichever axis is actually
  // its axle -- see detectAxleAxis -- independent since a child's local
  // rotation doesn't inherit its parent's) can each own their own axis
  // instead of fighting over the same one.
  function riggedSteerPivot(wheelNode){
    var pivot = new THREE.Group();
    pivot.position.copy(wheelNode.position);
    wheelNode.parent.add(pivot);
    pivot.add(wheelNode);
    wheelNode.position.set(0, 0, 0);
    return pivot;
  }

  // A tire mesh is thin along its own axle and round (roughly equal
  // extent) in the other two directions -- so the axle axis, in the
  // mesh's own local/object space (unaffected by whatever rotation the
  // node happens to be authored with), is whichever axis has the
  // smallest bounding-box extent. Detecting it from actual geometry like
  // this is what fixes rolling looking like a flat coin-spin instead of
  // rolling forward: guessing a fixed axis (every wheel node rotates
  // around local Y) assumes every model authors wheels the same way, and
  // it doesn't hold for every model.
  function detectAxleAxis(node){
    var mesh = node.isMesh ? node : null;
    if (!mesh) node.traverse(function(o){ if (!mesh && o.isMesh) mesh = o; });
    if (!mesh || !mesh.geometry) return 'y'; // nothing to measure -- keep the old guess as a last resort
    var geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    var b = geo.boundingBox;
    var ext = { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
    if (ext.x <= ext.y && ext.x <= ext.z) return 'x';
    if (ext.y <= ext.x && ext.y <= ext.z) return 'y';
    return 'z';
  }

  function findCarWheels(model){
    var candidates = [];
    model.traverse(function(o){
      if (/wheel/i.test(o.name || '')){
        candidates.push({ node: o, pos: o.getWorldPosition(new THREE.Vector3()) });
      }
    });
    if (candidates.length < 2) return null; // not enough to make sense of front/rear, left/right

    var box = new THREE.Box3().setFromObject(model);
    var centerZ = box.getCenter(new THREE.Vector3()).z;
    var wheels = {};
    candidates.forEach(function(c){
      var frontKey = c.pos.z < centerZ ? 'front' : 'rear'; // this game's forward is -Z
      var sideKey = c.pos.x < 0 ? 'Left' : 'Right';
      c.node.userData.baseRotation = c.node.rotation.clone(); // preserve however this wheel was originally authored
      c.node.userData.spinAxis = detectAxleAxis(c.node);
      if (frontKey === 'front'){
        wheels[sideKey === 'Left' ? 'frontLeftPivot' : 'frontRightPivot'] = riggedSteerPivot(c.node);
      }
      wheels[frontKey + sideKey] = c.node;
    });
    return wheels; // any key not found (including the two pivots, rear cars) is simply left undefined
  }

  // Called each frame for any car (player or ghost) whose loaded model had
  // real wheels findCarWheels could identify. Rolling spin applies to
  // each wheel's own detected axle axis (see detectAxleAxis) rather than
  // a fixed guess; steering only touches the two front pivots,
  // independently of whatever axis rolling uses.
  function animateCarModelWheels(wheels, spinAngle, steerAngle){
    if (!wheels) return;
    ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'].forEach(function(key){
      var node = wheels[key];
      if (!node) return;
      var base = node.userData.baseRotation;
      var rot = { x: base.x, y: base.y, z: base.z };
      rot[node.userData.spinAxis] += spinAngle;
      node.rotation.set(rot.x, rot.y, rot.z);
    });
    if (wheels.frontLeftPivot) wheels.frontLeftPivot.rotation.y = steerAngle;
    if (wheels.frontRightPivot) wheels.frontRightPivot.rotation.y = steerAngle;
  }

  // Shared by the player's own car and any ghost car (the computer
  // opponent, or a networked player) that wants a real model instead of
  // its primitive placeholder -- fetches, scales to CAR_TARGET_LENGTH
  // using the model's own longest axis, applies the per-car yaw fix if
  // one's set, and grounds/centers it. Caller decides what to do with the
  // fitted model (attach it, swap it in, etc.) and how to handle failure.
  function fetchAndFitCarModel(def, onLoaded, onFailed){
    if (!(window.THREE && THREE.GLTFLoader)){ if (onFailed) onFailed(); return; }
    var url = window[def.dataUriKey] || ('assets/models/' + def.file);
    new THREE.GLTFLoader().load(url, function(gltf){
      var model = gltf.scene;
      model.traverse(function(o){
        if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; }
      });

      var box = new THREE.Box3().setFromObject(model);
      var size = box.getSize(new THREE.Vector3());
      var scale = CAR_TARGET_LENGTH / Math.max(size.x, size.y, size.z, 0.0001);
      model.scale.setScalar(scale);
      model.rotation.y = (def.yaw !== undefined) ? def.yaw : CAR_MODEL_YAW;
      model.updateMatrixWorld(true);

      box.setFromObject(model);
      var center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;
      model.updateMatrixWorld(true);
      model.userData.wheels = findCarWheels(model);
      onLoaded(model);
    }, undefined, function(err){
      if (onFailed) onFailed(err);
    });
  }

  function loadSelectedCarModel(){
    var def = null;
    for (var i = 0; i < CAR_DEFS.length; i++) if (CAR_DEFS[i].id === selectedCarId) def = CAR_DEFS[i];
    if (!def) def = CAR_DEFS[0];
    var myToken = ++carLoadToken;
    var card = document.querySelector('.car-card[data-car-id="' + def.id + '"]');
    if (card) card.classList.add('loading');

    fetchAndFitCarModel(def, function(model){
      if (myToken !== carLoadToken) return; // a newer selection has already superseded this load
      if (card) card.classList.remove('loading');
      if (loadedCarModel) car.remove(loadedCarModel);
      carPlaceholder.visible = false;
      car.add(model);
      loadedCarModel = model;
    }, function(err){
      if (myToken !== carLoadToken) return;
      if (card) card.classList.remove('loading');
      console.warn('Car model "' + def.name + '" failed to load -- using the built-in placeholder car instead.', err);
    });
  }

  function renderCarPicker(){
    var wrap = document.getElementById('car-picker');
    if (!wrap) return;
    wrap.innerHTML = '';
    CAR_DEFS.forEach(function(def){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'car-card' + (def.id === selectedCarId ? ' selected' : '');
      btn.setAttribute('data-car-id', def.id);
      btn.innerHTML =
        '<div class="car-swatch" style="background:' + def.color + '"></div>' +
        '<div class="car-name">' + def.name + '</div>' +
        '<div class="car-loading">Loading&hellip;</div>';
      btn.addEventListener('click', function(){
        if (selectedCarId === def.id) return;
        selectedCarId = def.id;
        try { localStorage.setItem(CAR_ID_STORAGE_KEY, def.id); } catch (e){ /* non-fatal */ }
        Array.prototype.forEach.call(wrap.children, function(c){ c.classList.remove('selected'); });
        btn.classList.add('selected');
        loadSelectedCarModel();
      });
      wrap.appendChild(btn);
    });
  }
  renderCarPicker();
  loadSelectedCarModel();

  var camTargetPos = new THREE.Vector3();
  var camLookPos = new THREE.Vector3();
  var camLookCurrent = new THREE.Vector3(0, 1, -14);

  /* ============================================================
     SKY DOME  (a real gradient instead of a flat fill color --
     vertex colors updated each frame from the same day/night +
     biome colors already computed, so the horizon band matches
     the fog color exactly and there's no visible seam).
  ============================================================ */
  var skyDome, skyDomeColorAttr;
  (function(){
    var geo = new THREE.SphereGeometry(300, 24, 16);
    var count = geo.attributes.position.count;
    skyDomeColorAttr = new THREE.BufferAttribute(new Float32Array(count*3), 3);
    geo.setAttribute('color', skyDomeColorAttr);
    var mat = new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.BackSide, fog:false, depthWrite:false });
    skyDome = new THREE.Mesh(geo, mat);
    skyDome.renderOrder = -1;
    scene.add(skyDome);
  })();
  function updateSkyDome(focusPos, horizonColor, zenithColor){
    skyDome.position.copy(focusPos);
    var pos = skyDome.geometry.attributes.position;
    for (var i=0;i<pos.count;i++){
      var t = THREE.MathUtils.clamp((pos.getY(i) + 40) / 260, 0, 1);
      _skyTmp.copy(horizonColor).lerp(zenithColor, t);
      skyDomeColorAttr.setXYZ(i, _skyTmp.r, _skyTmp.g, _skyTmp.b);
    }
    skyDomeColorAttr.needsUpdate = true;
  }

  var sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
  sunSprite.scale.set(40,40,1);
  scene.add(sunSprite);
  var moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfe0ff, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
  moonSprite.scale.set(24,24,1);
  scene.add(moonSprite);

  var starPoints;
  (function(){
    var COUNT = 700;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(COUNT*3);
    for (var i=0;i<COUNT;i++){
      var a = Math.random()*Math.PI*2;
      var r = 60 + Math.random()*140;
      var h = Math.random();
      pos[i*3]   = Math.cos(a)*r;
      pos[i*3+1] = 10 + h*h*140;
      pos[i*3+2] = Math.sin(a)*r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    var mat = new THREE.PointsMaterial({
      color: PALETTE.fogText, size: 0.6, map: glowTex,
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    starPoints = new THREE.Points(geo, mat);
    scene.add(starPoints);
  })();

  /* ============================================================
     SPEED STREAKS (small, dense, close -- sell velocity)
     attached to the effects rig, so they live in the car's local
     frame and don't need to know about road curvature.
  ============================================================ */
  // Streaks track their distance-ahead-of-car via sampleAt() each frame (like
  // everything else road-relative), rather than sitting in a straight local
  // line -- otherwise they cut straight across curves instead of following
  // the road's actual bend.
  var streaks = [];
  var STREAK_COUNT = 60;
  var STREAK_LEN = 90;
  var streakGeo = new THREE.BoxGeometry(0.05, 0.05, 1.4);
  for (var k=0;k<STREAK_COUNT;k++){
    var sideK = Math.random() < 0.5 ? -1 : 1;
    var streakMat = new THREE.MeshBasicMaterial({
      color: sideK < 0 ? PALETTE.cyan : PALETTE.magenta, transparent:true, opacity:0.7
    });
    var streak = new THREE.Mesh(streakGeo, streakMat);
    scene.add(streak);
    streaks.push({ mesh: streak, side: sideK, offset: Math.random()*STREAK_LEN, height: 0.2 + Math.random()*1.6 });
  }

  /* ============================================================
     CHUNK STREAMING
     The road/terrain/guardrails/scenery are generated once per
     chunk and simply removed when the car has driven past it --
     there is no per-object recycle math, the curving road makes
     that impractical. This is what makes the drive "never-ending".
  ============================================================ */
  var SCENERY_NEAR_PER_CHUNK = 16;
  var SCENERY_FAR_PER_CHUNK = 11;
  var GRASS_PER_CHUNK = 14; // cheap ground clutter close to the shoulder; skipped entirely until grassModelProto loads
  var NITRO_PICKUP_CHANCE = 0.7;   // per chunk -- not guaranteed, so it stays a bonus you look out for
  var RAMP_CHANCE = 0.15;          // per chunk -- rare, so a ramp stays a surprise instead of every-chunk furniture
  var RAMP_LENGTH = 10;
  var RAMP_HEIGHT = 1.4;           // a gentler rise -- a real hop, not a launchpad
  var RAMP_WIDTH = 4.2;

  function buildChunk(targetEndS){
    var samples = [lastSample].concat(advancePathTo(targetEndS));
    lastSample = samples[samples.length-1];
    var startS = samples[0].s, endS = samples[samples.length-1].s;

    var group = new THREE.Group();
    var ownGeometries = [];
    var colliders = []; // scenery you can actually run into off-road: {x, z, radius, hitCooldown}
    var pickups = [];   // nitro orbs on the pavement: {x, y, z, mesh, collected}
    var ramps = [];     // launch zones: {sStart, sEnd, lateralCenter, halfWidth, hitCooldown}

    var roadGeo = buildRibbon(samples, ROAD_WIDTH/2, { uvTile: 24, bank: true });
    var roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);
    ownGeometries.push(roadGeo);

    var terrainGeo = buildRibbon(samples, TERRAIN_HALF_WIDTH, { uvTile: 30, yOffset: -0.06, colorFn: groundColorAt });
    var terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    group.add(terrainMesh);
    ownGeometries.push(terrainGeo);

    var railGeoL = buildRibbon(samples, 0.06, { yOffset: 0.22, centerOffset: -ROAD_WIDTH/2, bank: true });
    var railL = new THREE.Mesh(railGeoL, railMatL);
    railL.castShadow = true;
    group.add(railL);
    ownGeometries.push(railGeoL);
    var railGeoR = buildRibbon(samples, 0.06, { yOffset: 0.22, centerOffset: ROAD_WIDTH/2, bank: true });
    var railR = new THREE.Mesh(railGeoR, railMatR);
    railR.castShadow = true;
    group.add(railR);
    ownGeometries.push(railGeoR);

    for (var sc=0; sc<SCENERY_NEAR_PER_CHUNK; sc++){
      var sNear = startS + rng()*(endS-startS);
      var fN = frameAtSamples(samples, sNear);
      var pxN = Math.cos(fN.heading), pzN = Math.sin(fN.heading);
      var sideN = rng() < 0.5 ? -1 : 1;
      var latN = sideN * (5.4 + rng()*3.5);
      var propN = buildSceneryProp(biomeAt(sNear), false);
      propN.position.set(fN.x + pxN*latN, fN.y, fN.z + pzN*latN);
      propN.rotation.y = rng()*Math.PI*2;
      propN.scale.multiplyScalar(0.8 + rng()*0.6);
      group.add(propN);
      colliders.push({
        x: propN.position.x, z: propN.position.z,
        radius: propN.userData.collideRadius * propN.scale.x,
        hitCooldown: 0
      });
    }
    for (var sf=0; sf<SCENERY_FAR_PER_CHUNK; sf++){
      var sFar = startS + rng()*(endS-startS);
      var fF = frameAtSamples(samples, sFar);
      var pxF = Math.cos(fF.heading), pzF = Math.sin(fF.heading);
      var sideF = rng() < 0.5 ? -1 : 1;
      var latF = sideF * (32 + rng()*26);
      var propF = buildSceneryProp(biomeAt(sFar), true);
      propF.position.x = fF.x + pxF*latF;
      propF.position.z = fF.z + pzF*latF;
      propF.position.y += fF.y;
      group.add(propF);
      // far mesas/mountains sit well off the shoulder, but a wild swerve at
      // MAX_OFFROAD can still reach the closer ones -- they should stop you
      // like the solid rock they are, not let you drive straight through
      colliders.push({
        x: propF.position.x, z: propF.position.z,
        radius: propF.userData.collideRadius,
        hitCooldown: 0
      });
    }

    // Ground clutter: small grass clumps close along the shoulder, purely
    // decorative (no collider, no offroad relevance) -- just skipped until
    // the real model has loaded, nothing procedural to fall back to.
    if (grassModelProto){
      for (var sg=0; sg<GRASS_PER_CHUNK; sg++){
        var sGrass = startS + rng()*(endS-startS);
        var fG = frameAtSamples(samples, sGrass);
        var pxG = Math.cos(fG.heading), pzG = Math.sin(fG.heading);
        var sideG = rng() < 0.5 ? -1 : 1;
        var latG = sideG * (4.2 + rng()*5.5);
        var grass = buildGrassClump();
        grass.position.set(fG.x + pxG*latG, fG.y, fG.z + pzG*latG);
        grass.rotation.y = rng()*Math.PI*2;
        grass.scale.multiplyScalar(0.7 + rng()*0.8);
        group.add(grass);
      }
    }

    // Nitro pickup: sits on the pavement itself (within reach of normal
    // driving, not off in the dirt with the scenery) so grabbing one is
    // about weaving your line, not detouring off-road.
    if (rng() < NITRO_PICKUP_CHANCE && endS - startS > 20){
      var sPick = startS + 8 + rng()*(endS - startS - 16);
      var fP = frameAtSamples(samples, sPick);
      var pxP = Math.cos(fP.heading), pzP = Math.sin(fP.heading);
      var lanePick = (rng()*2-1) * maxLane * 0.7;
      var pickupMesh = buildNitroPickup();
      var pickupX = fP.x + pxP*lanePick, pickupY = fP.y + 0.55, pickupZ = fP.z + pzP*lanePick;
      pickupMesh.position.set(pickupX, pickupY, pickupZ);
      group.add(pickupMesh);
      pickups.push({ x: pickupX, y: pickupY, z: pickupZ, mesh: pickupMesh, collected: false });
    }

    // Ramp: a short raised strip of the same ribbon geometry as the road,
    // easing up from pavement height to RAMP_HEIGHT over RAMP_LENGTH --
    // built from buildRibbon() like everything else here, so it already
    // follows the road's curve/bank with no separate trig of its own.
    if (rng() < RAMP_CHANCE && endS - startS > RAMP_LENGTH + 20){
      var rampStart = startS + 10 + rng()*(endS - startS - RAMP_LENGTH - 20);
      var rampEnd = rampStart + RAMP_LENGTH;
      var rampLateral = (rng()*2-1) * (maxLane - RAMP_WIDTH/2 - 0.4);
      var RAMP_STEPS = 6;
      var rampSamples = [];
      for (var rs=0; rs<=RAMP_STEPS; rs++){
        var prog = rs / RAMP_STEPS;
        var rf = frameAtSamples(samples, rampStart + (rampEnd-rampStart)*prog);
        rampSamples.push({
          s: rf.s, x: rf.x, z: rf.z, heading: rf.heading, bank: 0,
          y: rf.y + RAMP_HEIGHT * prog * prog // eased ramp-up, steepest right before launch
        });
      }
      var rampGeo = buildRibbon(rampSamples, RAMP_WIDTH/2, { centerOffset: rampLateral, uvTile: 5 });
      var rampMesh = new THREE.Mesh(rampGeo, rampMat);
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      group.add(rampMesh);
      ownGeometries.push(rampGeo);
      ramps.push({ sStart: rampStart, sEnd: rampEnd, lateralCenter: rampLateral, halfWidth: RAMP_WIDTH/2, hitCooldown: 0 });
    }

    scene.add(group);
    return {
      startS: startS, endS: endS, samples: samples, group: group, ownGeometries: ownGeometries,
      colliders: colliders, pickups: pickups, ramps: ramps
    };
  }

  function disposeChunk(chunk){
    scene.remove(chunk.group);
    chunk.ownGeometries.forEach(function(g){ g.dispose(); });
  }

  // How far past the car to keep chunks built/rendered. Tied to the fog
  // density (line ~44) rather than picked arbitrarily: past ~175 units the
  // exponential fog has already hidden almost everything, so building (and
  // shading/shadowing) full terrain+scenery geometry out to 300 units, like
  // this used to, was rendering a lot that could never actually be seen.
  // One chunk length of headroom past that keeps the buildout from ever
  // being visible popping in as it clears the fog.
  var AHEAD_DIST = 190;
  var BEHIND_DIST = 40; // the chase cam never looks backward, so anything past this is disposed the moment it's behind
  function ensureChunks(carS){
    while (!chunks.length || chunks[chunks.length-1].endS < carS + AHEAD_DIST){
      var startS = chunks.length ? chunks[chunks.length-1].endS : 0;
      chunks.push(buildChunk(startS + CHUNK_LEN));
    }
    while (chunks.length > 1 && chunks[0].endS < carS - BEHIND_DIST){
      disposeChunk(chunks.shift());
    }
  }

  function resetTrack(seed){
    rng = (seed === null || seed === undefined) ? Math.random : mulberry32(seed);
    chunks.forEach(disposeChunk);
    chunks.length = 0;
    pathCursor.s = 0; pathCursor.x = 0; pathCursor.z = 0; pathCursor.heading = 0;
    lastSample = sampleFromCursor();
    finishGate = null;
    ensureChunks(0);
  }

  // pre-roll two chunks so the road is populated before the engine starts
  ensureChunks(0);

  /* ============================================================
     INPUT
  ============================================================ */
  var input = { left:false, right:false, boost:false, brake:false, fire:false, nitro:false };
  var pointerSteer = 0;
  var pointerActive = false;
  var pointerStartX = 0;
  var laneOffset = 0;
  var steerSmooth = 0;
  var carHeading = 0; // the car's own facing angle -- changes ONLY from steering input, never auto-follows the road's curve
  var yawRate = 0;    // how fast carHeading is currently rotating, rad/sec -- driven by tire forces, see CAR PHYSICS below
  var lastLongAccel = 0; // previous frame's forward accel, m/s^2-ish -- used one frame stale for weight transfer, plenty stable for this
  var wheelSpinAngle = 0; // accumulated rolling rotation for any real car model's real wheel nodes -- see findCarWheels
  var WHEEL_RADIUS = 0.35; // world units -- how fast that spin looks for a given speed
  var TURN_RATE = 1.5; // rad/sec of turn at full steer -- only used as a low-speed/reverse fallback now, see CAR PHYSICS
  var MAX_STEER_ANGLE = 0.5; // rad the front wheels visibly turn at full steer input (~29 degrees)

  /* ============================================================
     CAR PHYSICS
     Engine-force-vs-drag/rolling-resistance for speed, and slip-angle
     tire forces (front/rear, load-limited by weight transfer) for
     cornering, instead of a flat accel number and a fixed turn rate --
     see https://rsms.me/etc/car-physics/ (a writeup of Marco Monster's
     "Car Physics for Games"). Constants below aren't the real-world SI
     values from that article; they're picked so the car's baseline feel
     (accel, top speed, braking) lands close to this game's own already-
     tuned numbers, while cornering now genuinely loses grip under load
     instead of just turning at a fixed rate.
  ============================================================ */
  var CAR_MASS = 1200;               // kg-ish
  var WHEELBASE = 2.5;                // b + c
  var CG_TO_FRONT = 1.15;             // b: center of gravity to front axle
  var CG_TO_REAR = WHEELBASE - CG_TO_FRONT; // c
  var CG_HEIGHT = 0.55;                // h -- modest on purpose: noticeable weight transfer, not wild
  var YAW_INERTIA = CAR_MASS * WHEELBASE * WHEELBASE / 12 * 1.5; // solid-rod approximation, scaled up a bit --
                                                                   // pure bicycle-model inertia turned out twitchier
                                                                   // than it should for everyday steering
  var YAW_DAMPING = 1.4; // extra yaw-rate decay (rad/s per rad/s) standing in for steering self-centering/tire
                          // scrub the pure bicycle model doesn't capture -- without this a slide has no natural
                          // "settle back down" and normal turns could tip into a spin more easily than they should
  var CORNERING_STIFFNESS_F = 8.5 * CAR_MASS; // Ca, front -- softened from the initial pass so turn-in is
                                                // progressive instead of snapping toward the grip limit
  var CORNERING_STIFFNESS_R = 9.5 * CAR_MASS; // Ca, rear -- a bit stiffer than the front, so the default
                                                // balance gently understeers (front slips first) rather than snap-oversteering
  var TIRE_GRIP_MU = 1.7;             // available grip coefficient; each axle's max lateral force is this * that axle's own
                                        // load. Raised so normal cornering has real headroom -- spinning out now
                                        // takes genuinely hard/sustained steering at speed, not a routine turn
  var ENGINE_MAX_FORCE = CAR_MASS * 12; // full-throttle force -- reproduces the old ACCEL=12 feel at a standstill
  var BRAKE_FORCE = CAR_MASS * 22;      // reproduces the old BRAKE_DECEL=22 feel
  var REVERSE_FORCE = CAR_MASS * 7;     // dedicated reverse accel (gentler than braking) once already stopped/reversing --
                                          // holding brake at a standstill shifts into this instead of reusing full brake force
  var DRAG_COEF = 20;                   // quadratic air drag -- dominates at speed; this (not a hard clamp) is what caps top speed now
  var ROLL_COEF = 30;                   // linear rolling resistance -- matters most at low speed

  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.boost = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.brake = true;
    if (e.key === ' ' || e.key === 'Spacebar') { input.fire = true; e.preventDefault(); }
    if (e.key === 'x' || e.key === 'X') input.nitro = true;
    hideHint();
  });
  window.addEventListener('keyup', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.boost = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.brake = false;
    if (e.key === ' ' || e.key === 'Spacebar') input.fire = false;
    if (e.key === 'x' || e.key === 'X') input.nitro = false;
  });

  // Dragging on open canvas is *steering only*. Gas has its own explicit
  // controls (keyboard Up, or the dedicated on-screen Gas button) -- it used
  // to also get toggled by this drag gesture, which meant releasing any
  // unrelated touch/click anywhere on the page (to steer, say) would stomp
  // input.boost back to false and cut your gas mid-drift.
  window.addEventListener('pointerdown', function(e){
    pointerActive = true;
    pointerStartX = e.clientX;
    hideHint();
  });
  window.addEventListener('pointermove', function(e){
    if (!pointerActive) return;
    var dx = e.clientX - pointerStartX;
    pointerSteer = Math.max(-1, Math.min(1, dx / 140));
  });
  function releasePointerSteer(){
    pointerActive = false;
    pointerSteer = 0;
  }
  window.addEventListener('pointerup', releasePointerSteer);
  window.addEventListener('pointercancel', releasePointerSteer); // touch interrupted (e.g. an OS gesture) -- without
                                                                  // this the drag can get stuck steering indefinitely

  // Safety net: if the window loses focus or the tab is hidden while a key
  // is held, the matching keyup can be lost entirely (common when
  // alt-tabbing or switching apps), leaving the car turning/accelerating on
  // its own forever. Clear every input the moment that happens.
  function releaseAllInputs(){
    input.left = false; input.right = false; input.boost = false; input.brake = false; input.fire = false; input.nitro = false;
    releasePointerSteer();
  }
  window.addEventListener('blur', releaseAllInputs);
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) releaseAllInputs();
  });

  var hintEl = document.getElementById('hint');
  var hintHidden = false;
  function hideHint(){
    if (hintHidden) return;
    hintHidden = true;
    hintEl.classList.add('hidden');
  }

  /* ============================================================
     TOUCH CONTROLS  (on-screen buttons for phones/tablets)
  ============================================================ */
  var isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouchDevice){
    document.body.classList.add('touch-active');
    document.getElementById('touch-controls').hidden = false;
  }

  function bindHoldButton(id, onPress, onRelease){
    var el = document.getElementById(id);
    var active = false;
    function press(e){
      e.preventDefault();
      e.stopPropagation();
      if (active) return;
      active = true;
      el.classList.add('pressed');
      onPress();
      hideHint();
    }
    function release(e){
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!active) return;
      active = false;
      el.classList.remove('pressed');
      onRelease();
    }
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }

  bindHoldButton('tb-left',  function(){ input.left = true;  }, function(){ input.left = false; });
  bindHoldButton('tb-right', function(){ input.right = true; }, function(){ input.right = false; });
  bindHoldButton('tb-gas',   function(){ input.boost = true; }, function(){ input.boost = false; });
  bindHoldButton('tb-brake', function(){ input.brake = true; }, function(){ input.brake = false; });
  bindHoldButton('tb-fire',  function(){ input.fire = true;  }, function(){ input.fire = false; });
  bindHoldButton('tb-nitro', function(){ input.nitro = true; }, function(){ input.nitro = false; });

  /* ============================================================
     LANE INDICATOR
  ============================================================ */
  var laneCanvas = document.getElementById('lane-canvas');
  var laneCtx = laneCanvas.getContext('2d');
  function drawLaneIndicator(norm){
    laneCtx.clearRect(0,0,64,64);
    laneCtx.strokeStyle = 'rgba(223,227,255,0.25)';
    laneCtx.lineWidth = 2;
    roundedRectPath(laneCtx, 6, 6, 52, 52, 8);
    laneCtx.stroke();
    var cx = 32 + norm*20;
    var grad = laneCtx.createRadialGradient(cx,32,0,cx,32,10);
    grad.addColorStop(0,'#2fe6ff');
    grad.addColorStop(1,'rgba(47,230,255,0)');
    laneCtx.fillStyle = grad;
    laneCtx.beginPath();
    laneCtx.arc(cx,32,9,0,Math.PI*2);
    laneCtx.fill();
    laneCtx.fillStyle = '#dfe3ff';
    laneCtx.beginPath();
    laneCtx.arc(cx,32,3,0,Math.PI*2);
    laneCtx.fill();
  }

  /* ============================================================
     DAY / NIGHT CYCLE
  ============================================================ */
  var DAY_LENGTH = 110; // seconds for one full sunrise-to-sunrise cycle
  var dayClockOffset = 0; // reset when driving starts, so the gate screen doesn't eat into the day
  var daytimeEl = document.getElementById('daytime-name');
  var lastDaytimeName = '';
  var envRefreshTimer = 0;
  refreshEnvironment(new THREE.Color(BIOME.HILLS.sky), new THREE.Color(0x0a1030));

  function updateSky(elapsed, focusPos, worldS, dt){
    var angle = 1.1; // locked to a fixed daytime sun angle -- always day, no night cycle
    var sunHeight = Math.sin(angle);
    var sunHoriz = Math.cos(angle);
    var dayFactor = smoothstep(sunHeight, -0.2, 0.25);

    var sunDir = new THREE.Vector3(sunHoriz, Math.max(sunHeight, -0.05), 0.35).normalize();
    sunLight.position.copy(focusPos).addScaledVector(sunDir, 120);
    sunLight.target.position.copy(focusPos);
    if (!sunLight.target.parent) scene.add(sunLight.target);
    sunLight.intensity = Math.max(0, dayFactor) * 1.15;

    var moonDir = sunDir.clone().multiplyScalar(-1);
    moonLight.position.copy(focusPos).addScaledVector(moonDir, 120);
    moonLight.target.position.copy(focusPos);
    if (!moonLight.target.parent) scene.add(moonLight.target);
    moonLight.intensity = (1 - dayFactor) * 0.7;

    sunSprite.position.copy(focusPos).addScaledVector(sunDir, 260);
    sunSprite.material.opacity = Math.max(0, sunHeight + 0.1) * 0.9;
    moonSprite.position.copy(focusPos).addScaledVector(moonDir, 260);
    moonSprite.material.opacity = Math.max(0, -sunHeight + 0.1) * 0.8;

    starPoints.position.copy(focusPos);
    starPoints.material.opacity = (1 - dayFactor) * 0.75;

    var biomeBlend = biomeBlendAt(worldS || 0);
    _cA.set(BIOME.DESERT.fog); _cB.set(BIOME.HILLS.fog);
    _cC.copy(_cA).lerp(_cB, biomeBlend);
    scene.fog.color.copy(NIGHT_FOG).lerp(_cC, dayFactor);

    _cA.set(BIOME.DESERT.sky); _cB.set(BIOME.HILLS.sky);
    _cC.copy(_cA).lerp(_cB, biomeBlend);
    scene.background.copy(NIGHT_SKY).lerp(_cC, dayFactor);

    _cZenith.copy(scene.background).lerp(_zenithBase, 0.55);
    updateSkyDome(focusPos, scene.background, _cZenith);

    envRefreshTimer -= dt;
    if (envRefreshTimer <= 0){
      envRefreshTimer = 3;
      refreshEnvironment(scene.background, _cZenith);
    }

    hemiLight.intensity = 0.65 + dayFactor*0.55;

    var name;
    if (dayFactor > 0.75) name = 'Day';
    else if (dayFactor > 0.15) name = sunHoriz >= 0 ? 'Dawn' : 'Dusk';
    else name = 'Night';
    if (name !== lastDaytimeName){
      daytimeEl.textContent = name;
      lastDaytimeName = name;
    }
  }

  /* ============================================================
     MAIN LOOP
  ============================================================ */
  // Still used elsewhere as reference numbers (HUD scale, nitro/ramp/collision
  // tuning, the safety bound below) even though the real top speed now
  // emerges from engine force vs. drag/rolling resistance, not a hard clamp
  // -- see CAR PHYSICS above.
  var MAX_SPEED = 26, MAX_REVERSE = -5;

  // Catch-up: falling behind (a bad hit, a slow patch, whatever) shouldn't
  // be a permanent loss with no way back. Trailing players get a modest,
  // capped speed/accel bonus proportional to how far behind the current
  // leader they are -- enough to claw back a gap, not so much that skill
  // stops mattering. No-op in solo play (there's no one to be "behind").
  var CATCHUP_MAX_BOOST = 8;
  var CATCHUP_FULL_AT = 150;
  function catchUpBoost(){
    var leaderDist = worldDistance;
    for (var rid in remotePlayers){
      if (remotePlayers[rid].targetDist > leaderDist) leaderDist = remotePlayers[rid].targetDist;
    }
    var behind = leaderDist - worldDistance;
    return behind > 0 ? Math.min(CATCHUP_MAX_BOOST, (behind / CATCHUP_FULL_AT) * CATCHUP_MAX_BOOST) : 0;
  }
  var speed = 0;
  var prevSpeed = 0;
  var worldDistance = 0;
  var clock = new THREE.Clock();
  var running = false;
  var shakeTime = 0;
  var raceEndsAt = null;

  var statSpeed = document.getElementById('stat-speed');
  var statDistance = document.getElementById('stat-distance');
  var statRank = document.getElementById('stat-rank');
  var statTime = document.getElementById('stat-time');
  var biomeNameEl = document.getElementById('biome-name');
  var lastBiomeName = '';

  /* ============================================================
     MULTIPLAYER: race state, remote players, finish line
  ============================================================ */
  var PLAYER_COLORS = ['#2fe6ff', '#ff2e88', '#ffc94d', '#9b6bff', '#3ddc84', '#ff6b4a'];
  var myId = null;
  var myName = 'Racer ' + (100 + Math.floor(Math.random() * 900));
  var myColor = PLAYER_COLORS[0];

  // Your own car mirrors whatever color you picked at the gate -- same
  // trim/taillight/underglow treatment buildGhostCar() gives everyone
  // else -- plus a floating name tag above it, same as remote players get,
  // so it's obvious at a glance which car (and whose) you're looking at.
  var myCarNameSprite = null;
  function updateMyIdentity(){
    var c = new THREE.Color(myColor);
    trimMat.color.copy(c);
    trimMat.emissive.copy(c);
    taillightMat.color.copy(c);
    underGlow.material.color.copy(c);

    if (myCarNameSprite){
      myCarNameSprite.material.map.dispose();
      myCarNameSprite.material.map = makeNameTagTexture(myName, myColor);
    } else {
      myCarNameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeNameTagTexture(myName, myColor),
        transparent: true, depthWrite:false
      }));
      myCarNameSprite.scale.set(2.2, 0.55, 1);
      myCarNameSprite.position.set(0, 2.1, 0);
      car.add(myCarNameSprite);
    }
  }
  updateMyIdentity();
  var DURATION_OPTIONS = [60, 120, 180, 300];
  var DEFAULT_RACE_DURATION_MS = 120000; // mirrors server/server.js's DEFAULT_DURATION_MS
  var BASE_FINISH_DISTANCE = 1250; // mirrors server/server.js's BASE_FINISH_DISTANCE
  var COUNTDOWN_MS = 3000; // mirrors server/server.js's COUNTDOWN_MS -- used for the local computer race, which has no server round-trip to get this from
  var myDuration = DEFAULT_RACE_DURATION_MS;
  var soloDuration = DEFAULT_RACE_DURATION_MS; // race length picked for a vs-computer race (separate from the multiplayer room's choice)
  var raceState = 'solo'; // 'solo' | 'lobby' | 'countdown' | 'racing' | 'finished'
  var raceMode = null; // null (free practice) | 'bot' (vs computer) | 'multiplayer'
  var amHost = false; // multiplayer only -- whether *I* am the room's creator, allowed to pick duration + start
  var lastHandledRaceState = null;
  var raceStartPerf = 0;
  var localFinished = false;
  var myFinishTime = null;
  var finishDistance = BASE_FINISH_DISTANCE; // world units (~3000 displayed metres); scaled per-race to
                              // match the chosen race duration -- see the 'raceStart' handler and
                              // startBotRace() below, which overwrite it for their respective modes
  var finishGate = null;
  var lastNetSend = 0;

  function buildGhostCar(colorHex){
    var g = new THREE.Group();
    // Every cosmetic body/wheel part lives in this sub-group, same idea as
    // the player's own carPlaceholder -- if a real model loads for this
    // ghost (see maybeLoadGhostCarModel), hiding placeholder swaps the
    // whole primitive look out in one line. Gun/glow stay directly on `g`.
    var placeholder = new THREE.Group();
    g.add(placeholder);
    g.userData.placeholder = placeholder;

    var bMat = new THREE.MeshPhysicalMaterial({ color: 0xd6dcec, roughness: 0.35, metalness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.12 });
    var tMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: new THREE.Color(colorHex), emissiveIntensity: 1.4, roughness: 0.3 });
    var gMat = new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.1, metalness: 0.8 });
    var wMat = new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.9 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 3.6), bMat);
    body.position.y = 0.5;
    placeholder.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.42, 1.55), gMat);
    cab.position.set(0, 0.88, -0.1);
    cab.rotation.x = -0.1;
    placeholder.add(cab);
    [-1,1].forEach(function(side){
      var strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 3.4), tMat);
      strip.position.set(side*0.87, 0.42, 0);
      placeholder.add(strip);
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), tMat);
      tl.position.set(side*0.55, 0.6, 1.82);
      placeholder.add(tl);
    });
    var wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
    [[-0.86,0.36,-1.15],[0.86,0.36,-1.15],[-0.86,0.36,1.25],[0.86,0.36,1.25]].forEach(function(p){
      var wheel = new THREE.Mesh(wGeo, wMat);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(p[0], p[1], p[2]);
      placeholder.add(wheel);
    });
    var glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.4), new THREE.MeshBasicMaterial({
      map: glowTex, color: colorHex, transparent:true, opacity:0.5,
      blending: THREE.AdditiveBlending, depthWrite:false
    }));
    glow.rotation.x = -Math.PI/2;
    glow.position.y = 0.03;
    g.add(glow);

    var gMount = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), tMat);
    gMount.position.set(0, 1.05, -0.55);
    g.add(gMount);
    var gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 10), gunMat);
    gBarrel.rotation.x = Math.PI/2;
    gBarrel.position.set(0, 1.08, -1.15);
    g.add(gBarrel);

    g.traverse(function(obj){
      if (obj.isMesh){ obj.castShadow = true; obj.receiveShadow = true; }
    });
    glow.castShadow = false;
    glow.receiveShadow = false;

    g.rotation.order = 'YXZ';
    return g;
  }

  // The computer opponent gets a real car model too, same swap-in as the
  // player's own car -- just picked randomly per race instead of from the
  // picker, since there's no "choice" for an AI to make. `group` is
  // captured by reference and re-checked against the live remotePlayers
  // entry when the load finishes, so a bot that's since been torn down
  // (race restarted, etc.) doesn't get a model attached to an orphaned group.
  function maybeLoadGhostCarModel(id, group){
    var def = CAR_DEFS[Math.floor(Math.random() * CAR_DEFS.length)];
    fetchAndFitCarModel(def, function(model){
      if (!remotePlayers[id] || remotePlayers[id].group !== group) return;
      if (group.userData.placeholder) group.userData.placeholder.visible = false;
      group.add(model);
    }, function(err){
      console.warn('Ghost car model "' + def.name + '" failed to load -- using the built-in placeholder car instead.', err);
    });
  }

  function makeNameTagTexture(name, colorHex){
    var W = 256, H = 64;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.clearRect(0,0,W,H);
    var col = colorHex;
    roundedRectPath(ctx, 6, 6, W-12, H-12, 16);
    ctx.fillStyle = 'rgba(8,10,26,0.75)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    roundedRectPath(ctx, 6, 6, W-12, H-12, 16);
    ctx.stroke();
    ctx.fillStyle = '#dfe3ff';
    ctx.font = '700 26px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0,18), W/2, H/2 + 1);
    var tex = new THREE.CanvasTexture(c);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  var remotePlayers = {}; // id -> { group, nameSprite, color, name, targetDist, targetLane, dispDist, dispLane, finished, finishTime, isBot }
  var BOT_ID = 'bot'; // the vs-computer racer lives in remotePlayers like any networked opponent -- same
                       // rendering, leaderboard, ramming and catch-up-boost code paths, no special-casing needed there
  var botTimeoutHandle = null;
  var botAvgSpeed = 0; // world units/sec the computer aims for this race, set per-race in startBotRace()
  var botSpeedWander = 0; // slow +/- drift so the computer's pace doesn't look perfectly robotic

  function ensureRemotePlayer(id, name, color){
    var rp = remotePlayers[id];
    if (rp){
      if (name && name !== rp.name){
        rp.name = name;
        rp.nameSprite.material.map.dispose();
        rp.nameSprite.material.map = makeNameTagTexture(name, rp.color);
      }
      return rp;
    }
    color = color || PLAYER_COLORS[Object.keys(remotePlayers).length % PLAYER_COLORS.length];
    var group = buildGhostCar(color);
    var nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeNameTagTexture(name || ('Racer ' + id), color),
      transparent: true, depthWrite:false
    }));
    nameSprite.scale.set(2.2, 0.55, 1);
    nameSprite.position.set(0, 2.1, 0);
    group.add(nameSprite);
    scene.add(group);
    rp = remotePlayers[id] = {
      group: group, nameSprite: nameSprite, color: color, name: name || ('Racer ' + id),
      targetDist: 0, targetLane: 0, dispDist: 0, dispLane: 0, finished: false, finishTime: null,
      hitCooldown: 0, bumpCooldown: 0
    };
    if (id === BOT_ID) maybeLoadGhostCarModel(id, group);
    return rp;
  }

  function removeRemotePlayer(id){
    var rp = remotePlayers[id];
    if (!rp) return;
    scene.remove(rp.group);
    delete remotePlayers[id];
  }

  function positionRemotePlayer(rp, dist, lane){
    var f = sampleAt(dist);
    var px = Math.cos(f.heading), pz = Math.sin(f.heading);
    rp.group.position.set(f.x + px*lane, f.y + 0.02, f.z + pz*lane);
    rp.group.rotation.y = -f.heading;
    rp.group.rotation.z = f.bank;
  }

  /* ============================================================
     SOLO VS. COMPUTER: a locally-simulated opponent, no server
     needed. It's just another entry in remotePlayers, so rendering,
     ramming/shooting, the leaderboard, results, and catch-up boost
     all already work for it with no special-casing there.
  ============================================================ */
  function resetRacePhysics(){
    worldDistance = 0; localFinished = false; myFinishTime = null;
    steerSmooth = 0; lateralVelocity = 0; carHeading = 0; yawRate = 0; lastLongAccel = 0;
    carAirY = 0; carVertVel = 0;
    nitro = 0; updateNitroBar();
    finishToastEl.hidden = true;
    raceResultsEl.hidden = true;
    gate.classList.add('gone');
  }

  function stopBotRacer(){
    if (botTimeoutHandle) { clearTimeout(botTimeoutHandle); botTimeoutHandle = null; }
    removeRemotePlayer(BOT_ID);
  }

  function startBotRace(durationMs){
    raceMode = 'bot';
    stopBotRacer(); // clear out any previous computer racer before starting fresh
    resetRacePhysics();
    finishDistance = Math.round(BASE_FINISH_DISTANCE * (durationMs / DEFAULT_RACE_DURATION_MS));
    resetTrack(Math.floor(Math.random() * 1e9));

    var bot = ensureRemotePlayer(BOT_ID, 'Computer', PLAYER_COLORS[1]);
    bot.isBot = true;
    // aim the computer's average pace at roughly the chosen race length, with
    // some per-race randomness so it isn't always exactly as fast (or slow) as you
    botAvgSpeed = (finishDistance / (durationMs/1000)) * (0.85 + Math.random()*0.3);
    botSpeedWander = 0;

    // line up side-by-side on the starting grid, same idea as the multiplayer grid
    var gridSpacing = Math.min(2.3, maxLane*2);
    laneOffset = -gridSpacing/2;
    bot.targetDist = bot.dispDist = 0;
    bot.targetLane = bot.dispLane = gridSpacing/2;
    positionRemotePlayer(bot, 0, bot.dispLane);

    var startFrame = sampleAt(0);
    var startPx = Math.cos(startFrame.heading), startPz = Math.sin(startFrame.heading);
    car.position.set(startFrame.x + startPx*laneOffset, startFrame.y + 0.02, startFrame.z + startPz*laneOffset);
    car.rotation.y = -carHeading;

    var startAt = Date.now() + COUNTDOWN_MS;
    raceEndsAt = startAt + durationMs;
    botTimeoutHandle = setTimeout(concludeSoloRace, COUNTDOWN_MS + durationMs);
    raceState = 'countdown';
    startCountdown(startAt);
    setTimeout(function(){ if (raceState === 'countdown') raceState = 'racing'; }, Math.max(0, startAt - Date.now()));
  }

  function updateBot(dt){
    if (raceMode !== 'bot') return;
    var bot = remotePlayers[BOT_ID];
    if (!bot || bot.finished || raceState !== 'racing') return;
    // gentle random wander around the target pace so it doesn't feel robotic
    botSpeedWander += (Math.random()-0.5) * dt * 6;
    botSpeedWander = Math.max(-6, Math.min(6, botSpeedWander));
    var v = Math.max(4, botAvgSpeed + botSpeedWander);
    bot.targetDist += v * dt;
    bot.targetLane = Math.sin(bot.targetDist * 0.05) * (maxLane * 0.4); // cosmetic weave, not real steering
    if (bot.targetDist >= finishDistance){
      bot.targetDist = finishDistance;
      bot.finished = true;
      bot.finishTime = (performance.now() - raceStartPerf) / 1000;
    }
  }

  function concludeSoloRace(){
    if (raceMode !== 'bot' || raceState === 'finished') return;
    if (botTimeoutHandle) { clearTimeout(botTimeoutHandle); botTimeoutHandle = null; }
    raceState = 'finished';
    showRaceResults();
  }

  function ensureFinishGate(){
    if (finishGate) return;
    var f = sampleAt(finishDistance);
    if (Math.abs(f.s - finishDistance) > 1) return; // not built yet, try again next frame
    var px = Math.cos(f.heading), pz = Math.sin(f.heading);
    var g = new THREE.Group();
    var postMat = new THREE.MeshStandardMaterial({ color: 0x2a2e4a, emissive: new THREE.Color(PALETTE.gold), emissiveIntensity: 0.9 });
    [-1,1].forEach(function(side){
      var post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), postMat);
      post.position.set(f.x + px*side*ROAD_WIDTH/2, f.y + 2.5, f.z + pz*side*ROAD_WIDTH/2);
      g.add(post);
    });
    var bannerMat = new THREE.MeshBasicMaterial({ color: PALETTE.gold, transparent:true, opacity:0.85, side:THREE.DoubleSide });
    var banner = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 1.1), bannerMat);
    banner.position.set(f.x, f.y + 5, f.z);
    banner.rotation.y = -f.heading;
    g.add(banner);
    scene.add(g);
    finishGate = g;
  }

  /* ============================================================
     LEADERBOARD HUD + END-OF-RACE RESULTS
  ============================================================ */
  var leaderboardEl = document.getElementById('leaderboard');
  var leaderboardRowsEl = document.getElementById('leaderboard-rows');
  var raceResultsEl = document.getElementById('race-results');
  var raceResultsRowsEl = document.getElementById('race-results-rows');

  function allRacers(){
    var rows = [{ id:'me', name: myName, color: myColor, dist: worldDistance, finished: localFinished, finishTime: myFinishTime, isMe:true }];
    Object.keys(remotePlayers).forEach(function(id){
      var rp = remotePlayers[id];
      rows.push({ id:id, name: rp.name, color: rp.color, dist: rp.targetDist, finished: rp.finished, finishTime: rp.finishTime, isMe:false });
    });
    return rows;
  }

  function updateLeaderboard(){
    var others = Object.keys(remotePlayers);
    if (raceState === 'solo' && !others.length){
      leaderboardEl.hidden = true;
      return;
    }
    leaderboardEl.hidden = false;
    var rows = allRacers();
    rows.sort(function(a,b){ return b.dist - a.dist; });
    var myRank = 1;
    rows.forEach(function(r,i){ if (r.isMe) myRank = i+1; });
    statRank.textContent = myRank + '/' + rows.length;
    leaderboardRowsEl.innerHTML = rows.map(function(r, i){
      return '<div class="leaderboard-row' + (r.isMe ? ' lb-me' : '') + '">' +
        '<span class="lb-rank">' + (i+1) + '</span>' +
        '<span class="lb-dot" style="color:' + r.color + ';background:' + r.color + '"></span>' +
        '<span class="lb-name">' + r.name + (r.isMe ? ' (you)' : '') + '</span>' +
        (r.finished ? '<span class="lb-flag">🏁</span>' : '<span class="lb-dist">' + Math.round(r.dist*2.4) + 'm</span>') +
        '</div>';
    }).join('');
  }

  function showRaceResults(){
    var rows = allRacers();
    rows.sort(function(a,b){
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
    raceResultsRowsEl.innerHTML = rows.map(function(r, i){
      return '<div class="results-row' + (r.isMe ? ' lb-me' : '') + '">' +
        '<span class="lb-rank">' + (i+1) + '</span>' +
        '<span class="lb-dot" style="color:' + r.color + ';background:' + r.color + '"></span>' +
        '<span class="lb-name">' + r.name + (r.isMe ? ' (you)' : '') + '</span>' +
        '<span class="results-time">' + (r.finished ? r.finishTime.toFixed(1) + 's' : 'DNF') + '</span>' +
        '</div>';
    }).join('');
    // In a multiplayer room, only the host can fire off another race --
    // everyone else just waits, same restriction as the lobby's Start Race.
    var canRaceAgain = raceMode !== 'multiplayer' || amHost;
    raceAgainBtn.hidden = !canRaceAgain;
    resultsHostHintEl.hidden = canRaceAgain;

    raceResultsEl.hidden = false;
    document.getElementById('finish-toast').hidden = true;
  }

  /* ============================================================
     COMBAT: mounted gun + car-to-car ramming
     Hit detection is client-side (the shooter/rammer sees the
     other car's networked position and decides locally), then a
     targeted message tells that player's own client to apply the
     penalty to itself -- simple and fine for a friendly LAN game.
  ============================================================ */
  var impactFlashEl = document.getElementById('impact-flash');
  var HEALTH_MAX = 100;
  var SHOT_DAMAGE = 35;
  var RAM_DAMAGE = 30;
  var OFFROAD_DAMAGE_PER_SEC = 15; // HP/sec lost while off the pavement -- leaving the road costs you, it's not just a scenic detour
  var RESPAWN_DELAY = 1.7;
  var myHealth = HEALTH_MAX;
  var exploded = false;
  var healthFillEl = document.getElementById('health-fill');

  function updateHealthBar(){
    var pct = Math.max(0, myHealth / HEALTH_MAX);
    healthFillEl.style.width = (pct*100) + '%';
    healthFillEl.style.background = pct > 0.5 ? '#3ddc84' : pct > 0.25 ? '#ffc94d' : '#ff2e88';
  }
  updateHealthBar();

  /* ============================================================
     NITRO  (fills only from pickups on the road -- no passive
     regen -- then burns while X is held for a real speed boost)
  ============================================================ */
  var NITRO_MAX = 100;
  var NITRO_PICKUP_FILL = 40;      // one orb ~= 40% of the tank
  var NITRO_DRAIN_PER_SEC = 38;    // a full tank is a bit over 2.5s of boost
  var NITRO_FORCE_BONUS = CAR_MASS * 9; // extra engine force while burning nitro -- raises both accel AND the
                                          // drag-balance top speed at once now, no separate "max speed bonus" needed
  var NITRO_PICKUP_RADIUS = 1.6;
  var nitro = 0;
  var nitroFillEl = document.getElementById('nitro-fill');
  var nitroWrapEl = document.getElementById('nitro-wrap');

  function updateNitroBar(){
    var pct = Math.max(0, Math.min(1, nitro / NITRO_MAX));
    nitroFillEl.style.width = (pct*100) + '%';
  }
  updateNitroBar();

  function checkNitroPickups(carX, carZ){
    for (var ci=0; ci<chunks.length; ci++){
      var pickups = chunks[ci].pickups;
      for (var pi=0; pi<pickups.length; pi++){
        var pk = pickups[pi];
        if (pk.collected) continue;
        var dx = carX - pk.x, dz = carZ - pk.z;
        if (dx*dx + dz*dz > NITRO_PICKUP_RADIUS*NITRO_PICKUP_RADIUS) continue;
        pk.collected = true;
        pk.mesh.visible = false;
        nitro = Math.min(NITRO_MAX, nitro + NITRO_PICKUP_FILL);
        updateNitroBar();
        nitroWrapEl.classList.remove('collected');
        void nitroWrapEl.offsetWidth;
        nitroWrapEl.classList.add('collected');
      }
    }
  }

  // Spinning/bobbing idle animation for any pickup still out on the track --
  // purely cosmetic, runs whether or not the car is even moving.
  function updatePickups(dt){
    var t = clock.elapsedTime;
    for (var ci=0; ci<chunks.length; ci++){
      var pickups = chunks[ci].pickups;
      for (var pi=0; pi<pickups.length; pi++){
        var pk = pickups[pi];
        if (pk.collected) continue;
        pk.mesh.rotation.y += dt*2.4;
        pk.mesh.position.y = pk.y + Math.sin(t*3 + pk.x*0.3) * 0.12;
      }
    }
  }

  // Small fading embers spat out behind the car while nitro is burning --
  // short-lived and self-disposing, not tied to chunk streaming.
  var nitroParticles = [];
  var nitroParticleGeo = new THREE.SphereGeometry(0.11, 6, 6);
  var nitroEmitT = 0;
  function spawnNitroParticle(){
    var mat = new THREE.MeshBasicMaterial({
      color: 0x8ff2ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var mesh = new THREE.Mesh(nitroParticleGeo, mat);
    car.updateMatrixWorld();
    mesh.position.copy(car.localToWorld(new THREE.Vector3((Math.random()-0.5)*0.8, 0.22 + Math.random()*0.14, 1.9)));
    scene.add(mesh);
    nitroParticles.push({ mesh: mesh, life: 0.4, maxLife: 0.4 });
  }
  function updateNitroParticles(dt, emitting){
    if (emitting){
      nitroEmitT += dt;
      while (nitroEmitT > 0.028){
        spawnNitroParticle();
        nitroEmitT -= 0.028;
      }
    } else {
      nitroEmitT = 0;
    }
    for (var i=nitroParticles.length-1; i>=0; i--){
      var p = nitroParticles[i];
      p.life -= dt;
      p.mesh.position.y += dt*1.1;
      var k = 1 - Math.max(0, p.life/p.maxLife);
      p.mesh.scale.setScalar(1 + k*1.6);
      p.mesh.material.opacity = Math.max(0, p.life/p.maxLife) * 0.85;
      if (p.life <= 0){
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        nitroParticles.splice(i, 1);
      }
    }
  }

  var activeExplosions = [];
  var explosionDebrisGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  var explosionDebrisMat = new THREE.MeshBasicMaterial({ color: 0x2a2e4a });

  function spawnExplosion(pos){
    var group = new THREE.Group();
    group.position.copy(pos);
    scene.add(group);

    var flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff2c8, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    }));
    flash.scale.set(1, 1, 1);
    group.add(flash);

    var fire = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xff6a2a, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0.9
    }));
    fire.scale.set(0.6, 0.6, 1);
    group.add(fire);

    var debris = [];
    for (var i=0;i<8;i++){
      var d = new THREE.Mesh(explosionDebrisGeo, explosionDebrisMat);
      var ang = Math.random()*Math.PI*2;
      var spd = 2 + Math.random()*3;
      d.userData.vel = new THREE.Vector3(Math.cos(ang)*spd, 2 + Math.random()*3, Math.sin(ang)*spd);
      group.add(d);
      debris.push(d);
    }

    activeExplosions.push({ group:group, flash:flash, fire:fire, debris:debris, t:0 });
  }

  function updateExplosions(dt){
    for (var ei=activeExplosions.length-1; ei>=0; ei--){
      var ex = activeExplosions[ei];
      ex.t += dt;
      ex.flash.material.opacity = Math.max(0, 1 - ex.t*4);
      ex.flash.scale.setScalar(1 + ex.t*6);
      ex.fire.material.opacity = Math.max(0, 0.9 - ex.t*1.5);
      ex.fire.scale.setScalar(0.6 + ex.t*3);
      ex.debris.forEach(function(d){
        d.userData.vel.y -= 9*dt;
        d.position.addScaledVector(d.userData.vel, dt);
        d.rotation.x += dt*6; d.rotation.y += dt*5;
      });
      if (ex.t > 1.0){
        scene.remove(ex.group);
        activeExplosions.splice(ei, 1);
      }
    }
  }

  function triggerExplosion(){
    if (exploded) return;
    exploded = true;
    spawnExplosion(car.position.clone());
    car.visible = false;
    speed = 0;
    worldDistance = Math.max(0, worldDistance - 25);
    Net.send({ type:'exploded' });
    setTimeout(function(){
      myHealth = HEALTH_MAX;
      updateHealthBar();
      // Dying off-road (or against a tree) shouldn't drop you right back in
      // the same dirt patch -- put the car back on the pavement, centered
      // and pointed straight along the road, so a respawn is actually a
      // fresh start instead of an instant repeat off-road death.
      laneOffset = 0;
      lateralVelocity = 0;
      yawRate = 0;
      lastLongAccel = 0;
      steerSmooth = 0;
      carHeading = sampleAt(worldDistance).heading;
      carAirY = 0;
      carVertVel = 0;
      car.visible = true;
      exploded = false;
    }, RESPAWN_DELAY*1000);
  }

  // Physical reaction (knockback/speed/shake) is applied instantly and only
  // locally -- it never waits on a network round-trip, so a ram feels
  // immediate even though both cars independently detect it. Health is kept
  // separate and only ever changed by a message naming *this* player as the
  // target, so a mutual ram can't double-count damage on either side.
  var KNOCK_STRENGTH = 7;
  var lateralVelocity = 0;
  var carKick = 0;
  function applyPhysicalHit(knockDir, strength){
    speed *= (1 - strength);
    lateralVelocity += knockDir * KNOCK_STRENGTH;
    laneOffset += knockDir * 0.3; // instant nudge so cars don't visibly overlap even for one frame
    shakeTime = Math.max(shakeTime, 0.35);
    carKick = 1;
    impactFlashEl.classList.remove('hit');
    void impactFlashEl.offsetWidth;
    impactFlashEl.classList.add('hit');
  }
  function applyDamage(damage){
    if (exploded) return;
    myHealth = Math.max(0, myHealth - damage);
    updateHealthBar();
    if (myHealth <= 0) triggerExplosion();
  }

  var RAM_DIST = 1.9;
  var HIT_RADIUS = 1.35;
  var FIRE_COOLDOWN = 0.4;
  var PROJECTILE_SPEED = 55;
  var PROJECTILE_LIFE = 2.0;
  var fireCooldownT = 0;
  var projectiles = [];
  var projGeo = new THREE.SphereGeometry(0.19, 8, 8);
  var projMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });

  function fireProjectile(){
    car.updateMatrixWorld();
    var dir = new THREE.Vector3();
    car.getWorldDirection(dir);
    dir.negate(); // getWorldDirection returns the local +Z axis; the car's front is -Z
    var mesh = new THREE.Mesh(projGeo, projMat);
    mesh.position.copy(car.localToWorld(new THREE.Vector3(0, 1.08, -1.7)));
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xfff2c8, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    }));
    glow.scale.set(0.9, 0.9, 1);
    mesh.add(glow);
    scene.add(mesh);
    projectiles.push({ mesh: mesh, vel: dir.multiplyScalar(PROJECTILE_SPEED + Math.max(0, speed)), life: PROJECTILE_LIFE });
  }

  /* ============================================================
     SCENERY COLLISION  (running off-road into a tree/cactus/mesa/
     mountain is a real hit, not a pass-through -- it shoves the car
     back onto the road, kills your speed, and costs health, same
     physical language as a car-to-car ram)
  ============================================================ */
  var CAR_COLLIDE_RADIUS = 0.9;
  var TREE_DAMAGE = 18;
  var TREE_KNOCK_STRENGTH = 6;
  var SCENERY_HIT_COOLDOWN = 0.7; // re-arm delay per prop so grinding along one trunk doesn't spam hits every frame

  function checkSceneryCollisions(dt, carX, carZ, lateralX, lateralZ){
    for (var ci=0; ci<chunks.length; ci++){
      var colliders = chunks[ci].colliders;
      for (var pi=0; pi<colliders.length; pi++){
        var c = colliders[pi];
        if (c.hitCooldown > 0){ c.hitCooldown -= dt; continue; }
        var dx = carX - c.x, dz = carZ - c.z;
        var minDist = CAR_COLLIDE_RADIUS + c.radius;
        var distSq = dx*dx + dz*dz;
        if (distSq >= minDist*minDist) continue;

        var dist = Math.sqrt(Math.max(distSq, 0.0001));
        var overlap = minDist - dist;
        // push direction expressed along the road's lateral axis (the same
        // axis laneOffset already lives on), not raw world space, so the
        // shove reads as "bounced sideways off the road" rather than a
        // random nudge
        var lateralPush = (dx/dist)*lateralX + (dz/dist)*lateralZ;
        var knockDir = lateralPush >= 0 ? 1 : -1;

        laneOffset += knockDir * overlap;
        laneOffset = Math.max(-MAX_OFFROAD, Math.min(MAX_OFFROAD, laneOffset));
        var strength = Math.min(0.75, 0.25 + Math.abs(speed)/MAX_SPEED*0.5);
        speed *= (1 - strength);
        lateralVelocity += knockDir * TREE_KNOCK_STRENGTH;
        shakeTime = Math.max(shakeTime, 0.3);
        carKick = 1;
        impactFlashEl.classList.remove('hit');
        void impactFlashEl.offsetWidth;
        impactFlashEl.classList.add('hit');
        applyDamage(TREE_DAMAGE);

        c.hitCooldown = SCENERY_HIT_COOLDOWN;
      }
    }
  }

  /* ============================================================
     RAMPS & AIRBORNE PHYSICS  (a real stunt jump, not just a visual --
     the car leaves the road surface, arcs under gravity, and pitches
     with its vertical speed until it lands)
  ============================================================ */
  var carAirY = 0;      // height above the road surface -- 0 means grounded
  var carVertVel = 0;   // vertical speed, +up
  var GRAVITY = 24;
  var RAMP_LAUNCH_BASE = 3.2;
  var RAMP_LAUNCH_SPEED_FACTOR = 0.2; // faster off the ramp = higher/longer air, like a real one
  var RAMP_MIN_SPEED = 5;             // too slow and you just roll up and over it
  var RAMP_COOLDOWN = 1.5;

  function checkRamps(dt, carS, carLane){
    if (carAirY > 0.05) return; // already airborne -- can't launch off a ramp mid-jump
    for (var ci=0; ci<chunks.length; ci++){
      var ramps = chunks[ci].ramps;
      for (var ri=0; ri<ramps.length; ri++){
        var r = ramps[ri];
        if (r.hitCooldown > 0){ r.hitCooldown -= dt; continue; }
        if (carS < r.sStart || carS > r.sEnd) continue;
        if (Math.abs(carLane - r.lateralCenter) > r.halfWidth) continue;
        if (Math.abs(speed) < RAMP_MIN_SPEED) continue;
        carVertVel = RAMP_LAUNCH_BASE + Math.abs(speed) * RAMP_LAUNCH_SPEED_FACTOR;
        shakeTime = Math.max(shakeTime, 0.15);
        r.hitCooldown = RAMP_COOLDOWN;
      }
    }
  }

  function updateAirborne(dt){
    if (carAirY <= 0 && carVertVel === 0) return;
    carVertVel -= GRAVITY * dt;
    carAirY += carVertVel * dt;
    if (carAirY <= 0){
      carAirY = 0;
      carVertVel = 0;
      shakeTime = Math.max(shakeTime, 0.12); // a little thump on landing
    }
  }

  function updateCombat(dt){
    fireCooldownT = Math.max(0, fireCooldownT - dt);
    if (input.fire && fireCooldownT <= 0 && !localFinished && !exploded && running){
      fireCooldownT = FIRE_COOLDOWN;
      fireProjectile();
    }

    for (var pi = projectiles.length-1; pi >= 0; pi--){
      var p = projectiles[pi];
      p.mesh.position.addScaledVector(p.vel, dt);
      p.life -= dt;
      var hit = false;
      for (var rid3 in remotePlayers){
        var target = remotePlayers[rid3];
        if (target.hitCooldown > 0 || !target.group.visible) continue;
        var hdx = p.mesh.position.x - target.group.position.x;
        var hdy = p.mesh.position.y - (target.group.position.y + 0.6);
        var hdz = p.mesh.position.z - target.group.position.z;
        if (hdx*hdx + hdy*hdy + hdz*hdz < HIT_RADIUS*HIT_RADIUS){
          hit = true;
          target.hitCooldown = 1.2;
          if (!target.isBot) Net.send({ type:'shot', targetId: Number(rid3) });
          break;
        }
      }
      if (hit || p.life <= 0){
        scene.remove(p.mesh);
        projectiles.splice(pi, 1);
      }
    }
  }

  function update(dt){
    prevSpeed = speed;
    var frozen = localFinished || exploded;
    var boost = catchUpBoost();

    // Nitro only ever drains -- it's never topped up automatically, only by
    // driving through a pickup, so holding X is a real spend of something
    // you had to go collect.
    var usingNitro = !frozen && input.nitro && nitro > 0;
    if (usingNitro){
      nitro = Math.max(0, nitro - NITRO_DRAIN_PER_SEC*dt);
      updateNitroBar();
    }
    nitroFillEl.classList.toggle('active', usingNitro);

    var rawSteer = frozen ? 0 : ((input.right?1:0) - (input.left?1:0) + pointerSteer);
    steerSmooth += (rawSteer - steerSmooth) * Math.min(1, dt*7);

    // Front wheels turn on their own axis with the steering input, same
    // direction the whole car eventually swings toward -- visible feedback
    // the instant you press a key, before the car itself has turned at all.
    var steerAngle = -steerSmooth * MAX_STEER_ANGLE;
    frontWheelPivots[0].rotation.y = steerAngle;
    frontWheelPivots[1].rotation.y = steerAngle;
    var delta = steerSmooth * MAX_STEER_ANGLE; // front wheel steering angle, same sign convention as carHeading's own increase = turning right

    // Rolling: every wheel actually turns with distance traveled now,
    // placeholder or real model -- previously nothing spun at all, only
    // the front wheels' steering angle was ever animated.
    wheelSpinAngle += (speed / WHEEL_RADIUS) * dt;
    placeholderWheelSpin(wheelSpinAngle);
    if (loadedCarModel) animateCarModelWheels(loadedCarModel.userData.wheels, wheelSpinAngle, steerAngle);

    if (speed > 0.5){
      // Real slip-angle tire model: front/rear cornering force from how
      // much each axle's actual velocity direction disagrees with where
      // its wheels are pointed, capped by that axle's own grip (which
      // weight transfer shifts between front/rear under accel/braking).
      // This is what makes cornering genuinely lose grip under load
      // instead of just turning at a fixed rate -- push too hard and an
      // axle slides instead of gripping. Gated on speed > 0.5, not
      // abs(speed) > 0.5 -- atan2's sign convention flips hard the moment
      // its second argument goes negative, so this must never run with a
      // negative (reversing) speed or the slip angle discontinues right
      // at zero instead of smoothly crossing it.
      var vLongForSlip = Math.max(speed, 3); // keeps atan2 well-behaved at low speed; always positive since speed > 0.5 here
      var vfLat = lateralVelocity + CG_TO_FRONT * yawRate;
      var vrLat = lateralVelocity - CG_TO_REAR * yawRate;
      var slipF = delta - Math.atan2(vfLat, vLongForSlip);
      var slipR = -Math.atan2(vrLat, vLongForSlip);

      // Weight transfer (one-frame-stale accel, plenty stable for this):
      // accelerating shifts load rearward (less front grip), braking
      // shifts it forward -- real understeer/oversteer, not a fixed feel.
      var staticWf = (CG_TO_REAR / WHEELBASE) * CAR_MASS * 9.8;
      var staticWr = (CG_TO_FRONT / WHEELBASE) * CAR_MASS * 9.8;
      var weightShift = (CG_HEIGHT / WHEELBASE) * CAR_MASS * lastLongAccel;
      var wf = Math.max(0, staticWf - weightShift);
      var wr = Math.max(0, staticWr + weightShift);

      var latF = Math.max(-wf * TIRE_GRIP_MU, Math.min(wf * TIRE_GRIP_MU, CORNERING_STIFFNESS_F * slipF));
      var latR = Math.max(-wr * TIRE_GRIP_MU, Math.min(wr * TIRE_GRIP_MU, CORNERING_STIFFNESS_R * slipR));

      var yawTorque = Math.cos(delta) * latF * CG_TO_FRONT - latR * CG_TO_REAR;
      yawRate += (yawTorque / YAW_INERTIA - YAW_DAMPING * yawRate) * dt;

      var corneringForce = latR + Math.cos(delta) * latF;
      lateralVelocity += (corneringForce / CAR_MASS - speed * yawRate) * dt;
    } else {
      // Too slow (or reversing) for the slip-angle model to behave well --
      // atan2 against a near-zero longitudinal speed is unstable, and this
      // game's "reverse" is really just a back-up utility, not a driving
      // mode worth full tire physics. Falls back to a plain turn rate,
      // same idea the old kinematic steering used.
      var turnDir = speed < -0.05 ? -1 : 1;
      yawRate = turnDir * steerSmooth * TURN_RATE * 0.6;
      lateralVelocity *= Math.max(0, 1 - dt*6); // settle out quickly, no tire physics driving it at a standstill
    }
    // The car's facing direction is still free-running -- it only changes
    // from these forces, and otherwise holds wherever it was last pointed
    // even as the road curves underneath it. It never auto-aligns to the
    // road, and there's no artificial clamp on how far it can drift from
    // the road's heading anymore either -- lose enough grip and it can
    // genuinely spin out, which is real physics doing its job, not a bug.
    carHeading += yawRate * dt;

    // Longitudinal: real engine-force-vs-drag/rolling-resistance instead
    // of a flat accel number -- top speed now emerges from wherever
    // traction stops beating drag, it isn't a hard clamp.
    var throttleForce = ENGINE_MAX_FORCE + boost*CAR_MASS*0.6 + (usingNitro ? NITRO_FORCE_BONUS : 0);
    var dragForce = DRAG_COEF * speed * Math.abs(speed);
    var rollForce = ROLL_COEF * speed;
    var longForce;
    if (frozen){
      longForce = -dragForce - rollForce*1.4;
    } else if (input.boost){
      longForce = throttleForce - dragForce - rollForce;
    } else if (input.brake){
      // Real braking while still rolling forward of any real speed; once
      // you're essentially stopped (or already reversing), holding brake
      // shifts into a dedicated, gentler reverse gear instead of reusing
      // full brake force -- backing up shouldn't feel like slamming the brakes.
      longForce = (speed > 0.5 ? -BRAKE_FORCE : -REVERSE_FORCE) - dragForce - rollForce;
    } else {
      longForce = -dragForce - rollForce;
    }
    lastLongAccel = longForce / CAR_MASS;
    speed += lastLongAccel * dt;
    speed = Math.max(MAX_REVERSE, Math.min(MAX_SPEED*2.2, speed)); // generous safety bound, not a real gameplay clamp -- see NITRO_FORCE_BONUS etc.
    var accel = (speed - prevSpeed) / Math.max(dt, 0.0001);

    worldDistance += speed * dt;
    if (localFinished) worldDistance = Math.min(worldDistance, finishDistance);
    ensureChunks(worldDistance);
    ensureFinishGate();
    updateBot(dt);

    if (!localFinished && worldDistance >= finishDistance){
      localFinished = true;
      myFinishTime = raceState === 'racing' ? (performance.now() - raceStartPerf) / 1000 : clock.elapsedTime;
      document.getElementById('finish-time').textContent = myFinishTime.toFixed(1) + 's';
      document.getElementById('finish-toast').hidden = false;
      Net.send({ type:'finish', time: myFinishTime });
    }

    // vs-computer races end as soon as both racers have crossed the line --
    // same "everybody's done" idea as the server's multiplayer concludeRace,
    // just decided locally since there's no server for a solo race
    if (raceMode === 'bot' && raceState === 'racing' && localFinished && remotePlayers[BOT_ID] && remotePlayers[BOT_ID].finished){
      concludeSoloRace();
    }

    var frame = sampleAt(worldDistance);

    // You actually go wherever the car is pointed: lane position drifts as
    // the car's real-world velocity (its own forward speed plus whatever
    // lateral velocity the tire physics above gave it, ram/shot knockback
    // included -- lateralVelocity carries both now) gets projected onto
    // the road's own lateral axis here. Point straight through an
    // unsteered curve and the road bends out from under you -- correcting
    // is on you, same as real driving, and drifting far enough genuinely
    // takes you off the road (see MAX_OFFROAD) rather than bouncing off an
    // invisible wall.
    var headingMismatch = carHeading - frame.heading;
    laneOffset += (Math.sin(headingMismatch) * speed + Math.cos(headingMismatch) * lateralVelocity) * dt;
    laneOffset = Math.max(-MAX_OFFROAD, Math.min(MAX_OFFROAD, laneOffset));

    // Off the pavement costs you health over time -- bad driving has a real
    // consequence instead of just a shrug and a scenic detour through the dirt.
    if (!frozen && Math.abs(laneOffset) > maxLane) applyDamage(OFFROAD_DAMAGE_PER_SEC * dt);

    var px = Math.cos(frame.heading), pz = Math.sin(frame.heading);

    // Off-road, laneOffset can genuinely put you inside a tree/cactus/mesa --
    // check before the final position is committed so a collision this frame
    // shoves laneOffset back out before the car is drawn overlapping it.
    if (!frozen) checkSceneryCollisions(dt, frame.x + px*laneOffset, frame.z + pz*laneOffset, px, pz);
    if (!frozen) checkRamps(dt, worldDistance, laneOffset);
    updateAirborne(dt);
    checkNitroPickups(frame.x + px*laneOffset, frame.z + pz*laneOffset);
    updatePickups(dt);
    updateNitroParticles(dt, usingNitro && !frozen);

    var t = clock.elapsedTime;
    var bob = reduceMotion ? 0 : Math.sin(t*8) * 0.02 * Math.min(1.3, Math.abs(speed)/18);

    car.position.set(frame.x + px*laneOffset, frame.y + 0.02 + bob + carAirY, frame.z + pz*laneOffset);
    var slope = slopeAt(worldDistance);
    car.rotation.y = -carHeading; // the car's own heading -- never tied to the road's, only to steering
    // Ramp jumps pitch the nose with vertical speed (up on launch, leveling
    // out and dipping again just before touchdown) on top of the normal
    // slope/accel pitch, so a stunt actually reads as one in the air.
    car.rotation.x = reduceMotion ? 0 : Math.atan(slope) - accel*0.0035 - carVertVel*0.025;
    car.rotation.z = reduceMotion ? 0 : frame.bank - steerSmooth*0.12 + Math.sin(t*8)*0.01; // lean into the turn

    if (carKick > 0){
      carKick = Math.max(0, carKick - dt*3);
      if (!reduceMotion){
        car.rotation.z += Math.sin(carKick*40) * 0.1 * carKick;
        car.rotation.x += Math.sin(carKick*33) * 0.05 * carKick;
      }
    }

    // chase camera: derive target transform from the car, then damp toward it
    car.updateMatrixWorld();
    camTargetPos.set(0, 2.35, 5.4).applyMatrix4(car.matrixWorld);
    camLookPos.set(0, 1.0, -13).applyMatrix4(car.matrixWorld);
    camera.position.lerp(camTargetPos, Math.min(1, dt*4.5));
    camLookCurrent.lerp(camLookPos, Math.min(1, dt*5));

    var targetFov = 70 + Math.max(0, speed) * 0.5;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt*3);
    camera.updateProjectionMatrix();

    if (shakeTime > 0){
      shakeTime = Math.max(0, shakeTime - dt);
      var shakeMag = shakeTime * 0.6;
      camera.position.x += (Math.random()-0.5) * shakeMag;
      camera.position.y += (Math.random()-0.5) * shakeMag;
    }
    camera.lookAt(camLookCurrent);

    // day/night + biome atmosphere, focused on where the car actually is
    updateSky(t, car.position, worldDistance, dt);

    var biomeName = biomeBlendAt(worldDistance) < 0.5 ? BIOME.DESERT.name : BIOME.HILLS.name;
    if (biomeName !== lastBiomeName){
      biomeNameEl.textContent = biomeName;
      lastBiomeName = biomeName;
    }

    // speed streaks -- positioned along the actual curving road via
    // sampleAt(), same as remote players, so they hug curves correctly
    for (var k2=0;k2<streaks.length;k2++){
      var st = streaks[k2];
      st.offset -= speed * dt * 1.6;
      if (st.offset < -5){
        st.offset += STREAK_LEN;
        st.height = 0.2 + Math.random()*1.6;
      }
      var sf = sampleAt(worldDistance + st.offset);
      var spx = Math.cos(sf.heading), spz = Math.sin(sf.heading);
      var slat = st.side * (ROAD_WIDTH/2 + 0.08);
      st.mesh.position.set(sf.x + spx*slat, sf.y + st.height, sf.z + spz*slat);
      st.mesh.rotation.y = -sf.heading;
    }

    // multiplayer: broadcast our own state, ~12x/sec, and render everyone else
    lastNetSend += dt;
    if (lastNetSend > 0.08 && Net.connected){
      lastNetSend = 0;
      Net.send({ type:'state', distance: worldDistance, laneOffset: laneOffset, speed: speed });
    }
    for (var rid in remotePlayers){
      var rp = remotePlayers[rid];
      rp.dispDist += (rp.targetDist - rp.dispDist) * Math.min(1, dt*8);
      rp.dispLane += (rp.targetLane - rp.dispLane) * Math.min(1, dt*8);
      var rf = sampleAt(rp.dispDist);
      var rpx = Math.cos(rf.heading), rpz = Math.sin(rf.heading);
      rp.group.position.set(rf.x + rpx*rp.dispLane, rf.y + 0.02, rf.z + rpz*rp.dispLane);
      rp.group.rotation.y = -rf.heading;
      rp.group.rotation.z = rf.bank;

      rp.hitCooldown = Math.max(0, rp.hitCooldown - dt);
      rp.bumpCooldown = Math.max(0, rp.bumpCooldown - dt);
      if (rp.bumpCooldown <= 0 && !frozen && rp.group.visible){
        var rdx = rp.group.position.x - car.position.x;
        var rdz = rp.group.position.z - car.position.z;
        if (rdx*rdx + rdz*rdz < RAM_DIST*RAM_DIST){
          rp.bumpCooldown = 1.0;
          // knockback direction is "away from them", measured along the
          // road's current lateral axis (not raw world X) so it's correct
          // on curves; pick a side at random for a dead-on head-on hit.
          var lateralDelta = -(rdx*px + rdz*pz);
          if (Math.abs(lateralDelta) < 0.15) lateralDelta = (Math.random() < 0.5 ? -1 : 1);
          var knockDir = lateralDelta > 0 ? 1 : -1;
          // physical reaction is instant and local (both cars detect the same
          // ram independently and push themselves away); the network message
          // is only used to apply damage on the other side, so a mutual ram
          // can't double-count health loss the way a shared local hit would.
          applyPhysicalHit(knockDir, 0.4);
          if (!rp.isBot) Net.send({ type:'bump', targetId: Number(rid) });
        }
      }
    }
    updateCombat(dt);
    updateExplosions(dt);

    // HUD
    var elapsed;
    if (raceState === 'racing' && raceEndsAt){
      elapsed = Math.max(0, (raceEndsAt - Date.now()) / 1000); // counts down for timed multiplayer races
    } else if (raceState === 'racing' || raceState === 'finished'){
      elapsed = localFinished ? myFinishTime : (performance.now() - raceStartPerf) / 1000;
    } else {
      elapsed = t;
    }
    var mins = Math.floor(elapsed / 60), secs = Math.floor(elapsed % 60);
    statSpeed.innerHTML = String(Math.round(speed*11)).padStart(3,'0') + '<small>km/h</small>';
    statDistance.innerHTML = Math.round(worldDistance*2.4).toLocaleString() + '<small>m</small>';
    statTime.textContent = mins + ':' + String(secs).padStart(2,'0');
    drawLaneIndicator(Math.max(-1, Math.min(1, laneOffset / maxLane))); // pins to the edge once you're off the pavement, instead of running off the widget
    updateLeaderboard();
  }

  /* ============================================================
     BLOOM POST-PROCESSING
     Hand-rolled instead of three.js's EffectComposer/UnrealBloomPass --
     this project vendors only core three.js (no examples/jsm addons,
     no build step, see README), and those addons are ES modules that
     don't fit the plain-<script> single-file build. Same idea though:
     render the scene once to an offscreen target, extract the bright
     pixels (the neon rails, headlights, sun/moon, streaks -- anything
     that was already emissive/near-white), blur them, and add that
     glow back on top when finally blitting to the canvas. Every pass
     uses the standard `#include <tonemapping_fragment>` /
     `<colorspace_fragment>` chunks three.js's own shaders use, so
     color grading stays consistent with the rest of the renderer.
  ============================================================ */
  // Sized to match the renderer's actual drawing-buffer resolution (CSS size
  // * pixel ratio, same as renderer.setSize/setPixelRatio above) so the
  // final blit is 1:1 -- no extra softness from a mismatched render target.
  function currentPixelRatio(){ return Math.min(window.devicePixelRatio || 1, 2); }
  var sceneRT = new THREE.WebGLRenderTarget(
    window.innerWidth * currentPixelRatio(), window.innerHeight * currentPixelRatio(),
    { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
  );
  // Bloom is intentionally rendered at a small, fixed resolution -- the
  // blur only needs to produce a soft wide glow, not a crisp image, and
  // keeping it fixed-size means the blur cost never scales with the
  // window/monitor resolution.
  var BLOOM_W = 480, BLOOM_H = 270;
  function makeBloomRT(){
    return new THREE.WebGLRenderTarget(BLOOM_W, BLOOM_H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat
    });
  }
  var bloomRTA = makeBloomRT();
  var bloomRTB = makeBloomRT();

  var FS_VERT = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);', // PlaneGeometry(2,2) corners already sit at clip-space extents,
    '}'                                             // so this skips the camera entirely -- a true fullscreen pass
  ].join('\n');

  var brightPassMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, threshold: { value: 0.6 } },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform float threshold;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec4 texel = texture2D(tDiffuse, vUv);',
      '  float luma = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));',
      '  float w = smoothstep(threshold, threshold + 0.2, luma);',
      '  gl_FragColor = vec4(texel.rgb * w, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n'),
    toneMapped: false, depthTest: false, depthWrite: false
  });

  var blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2(1 / BLOOM_W, 1 / BLOOM_H) } },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 direction;',
      'uniform vec2 texel;',
      'varying vec2 vUv;',
      'void main(){',
      '  vec2 off = direction * texel;',
      '  float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;',
      '  vec3 sum = texture2D(tDiffuse, vUv).rgb * w0;',
      '  sum += (texture2D(tDiffuse, vUv + off*1.0).rgb + texture2D(tDiffuse, vUv - off*1.0).rgb) * w1;',
      '  sum += (texture2D(tDiffuse, vUv + off*2.0).rgb + texture2D(tDiffuse, vUv - off*2.0).rgb) * w2;',
      '  sum += (texture2D(tDiffuse, vUv + off*3.0).rgb + texture2D(tDiffuse, vUv - off*3.0).rgb) * w3;',
      '  sum += (texture2D(tDiffuse, vUv + off*4.0).rgb + texture2D(tDiffuse, vUv - off*4.0).rgb) * w4;',
      '  gl_FragColor = vec4(sum, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n'),
    toneMapped: false, depthTest: false, depthWrite: false
  });

  var compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null },
      bloomStrength: { value: 0.85 }, grainStrength: { value: 0.025 }, time: { value: 0 }
    },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tScene;',
      'uniform sampler2D tBloom;',
      'uniform float bloomStrength;',
      'uniform float grainStrength;',
      'uniform float time;',
      'varying vec2 vUv;',
      'float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }',
      'void main(){',
      '  vec3 base = texture2D(tScene, vUv).rgb;',
      '  vec3 bloom = texture2D(tBloom, vUv).rgb;',
      '  vec3 color = base + bloom * bloomStrength;',
      '  color += (rand(vUv + fract(time)) - 0.5) * grainStrength;', // subtle filmic grain, breaks up flat dark areas
      '  gl_FragColor = vec4(color, 1.0);',
      // toneMapped:false below skips re-tonemapping (the scene render already
      // baked that in per-object); colorspace encoding still runs since this
      // pass lands on the actual canvas.
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}'
    ].join('\n'),
    toneMapped: false, depthTest: false, depthWrite: false
  });

  var postScene = new THREE.Scene();
  var postCam = new THREE.Camera(); // unused by FS_VERT, kept only because render() requires *a* camera argument
  var postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightPassMat);
  postScene.add(postQuad);
  function renderFullscreen(material, target){
    postQuad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  }

  window.addEventListener('resize', function(){
    var pr = currentPixelRatio();
    sceneRT.setSize(window.innerWidth * pr, window.innerHeight * pr);
  });

  function renderWithBloom(){
    // Everything the game actually draws still goes through one normal
    // render() call -- shadows, environment map, fog, all unchanged --
    // just aimed at an offscreen target instead of the canvas directly.
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    brightPassMat.uniforms.tDiffuse.value = sceneRT.texture;
    renderFullscreen(brightPassMat, bloomRTA);

    blurMat.uniforms.tDiffuse.value = bloomRTA.texture;
    blurMat.uniforms.direction.value.set(1, 0);
    renderFullscreen(blurMat, bloomRTB);

    blurMat.uniforms.tDiffuse.value = bloomRTB.texture;
    blurMat.uniforms.direction.value.set(0, 1);
    renderFullscreen(blurMat, bloomRTA);

    compositeMat.uniforms.tScene.value = sceneRT.texture;
    compositeMat.uniforms.tBloom.value = bloomRTA.texture;
    compositeMat.uniforms.time.value = clock.elapsedTime;
    renderFullscreen(compositeMat, null); // null target = the actual canvas
  }

  function animate(){
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (running) update(dt);
    renderWithBloom();
  }
  animate();

  document.addEventListener('visibilitychange', function(){
    if (document.hidden) clock.stop(); else clock.start();
  });

  /* ============================================================
     START GATE + MULTIPLAYER LOBBY
  ============================================================ */
  var gate = document.getElementById('gate');
  var mpStatusEl = document.getElementById('mp-status');
  var roomPickerEl = document.getElementById('room-picker');
  var mpSetupEl = document.getElementById('mp-setup');
  var nameInput = document.getElementById('player-name');
  var swatchesEl = document.getElementById('swatches');
  var createRoomBtn = document.getElementById('create-room-btn');
  var roomCodeInput = document.getElementById('room-code-input');
  var joinRoomBtn = document.getElementById('join-room-btn');
  var roomErrorEl = document.getElementById('room-error');
  var roomCodeLabelEl = document.getElementById('room-code-label');
  var copyRoomBtn = document.getElementById('copy-room-btn');
  var roomCopiedEl = document.getElementById('room-copied');
  var playerListEl = document.getElementById('player-list');
  var raceBtn = document.getElementById('race-btn');
  var durationRowEl = document.getElementById('duration-row');
  var hostWaitHintEl = document.getElementById('host-wait-hint');
  var resultsHostHintEl = document.getElementById('results-host-hint');
  var raceAgainBtn = document.getElementById('race-again-btn');
  var countdownOverlay = document.getElementById('countdown-overlay');
  var countdownNum = document.getElementById('countdown-num');
  var finishToastEl = document.getElementById('finish-toast');
  var myRoomCode = null;

  // ?room=CODE in the URL (from a shared link) pre-fills the join box
  (function(){
    var pre = new URLSearchParams(location.search).get('room');
    if (pre) roomCodeInput.value = pre.toUpperCase();
  })();

  nameInput.value = myName;
  nameInput.addEventListener('change', function(){
    myName = nameInput.value.trim() || myName;
    updateMyIdentity();
    sendJoin();
  });

  PLAYER_COLORS.forEach(function(color, i){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (i === 0 ? ' selected' : '');
    b.style.background = color;
    b.style.color = color;
    b.setAttribute('aria-label', 'Car color ' + color);
    b.addEventListener('click', function(){
      myColor = color;
      var all = swatchesEl.querySelectorAll('.swatch');
      for (var i2=0;i2<all.length;i2++) all[i2].classList.remove('selected');
      b.classList.add('selected');
      updateMyIdentity();
      sendJoin();
    });
    swatchesEl.appendChild(b);
  });

  // Builds a row of duration chips into `containerEl`, reading/writing the
  // chosen value through get()/set() -- used for both the multiplayer room's
  // duration (host-only) and the solo vs-computer race length independently.
  function buildDurationChips(containerEl, get, set){
    DURATION_OPTIONS.forEach(function(secs){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'duration-chip' + (secs*1000 === get() ? ' selected' : '');
      b.textContent = Math.floor(secs/60) + ':' + String(secs%60).padStart(2,'0');
      b.addEventListener('click', function(){
        set(secs*1000);
        var all = containerEl.querySelectorAll('.duration-chip');
        for (var i3=0;i3<all.length;i3++) all[i3].classList.remove('selected');
        b.classList.add('selected');
      });
      containerEl.appendChild(b);
    });
  }
  buildDurationChips(document.getElementById('duration-chips'),
    function(){ return myDuration; }, function(v){ myDuration = v; });
  buildDurationChips(document.getElementById('solo-duration-chips'),
    function(){ return soloDuration; }, function(v){ soloDuration = v; });

  function sendJoin(){
    Net.send({ type:'join', name: myName, color: myColor });
  }

  function enterRoom(code){
    myRoomCode = code;
    roomPickerEl.hidden = true;
    mpSetupEl.hidden = false;
    roomCodeLabelEl.textContent = code;
  }

  createRoomBtn.addEventListener('click', function(){
    myName = nameInput.value.trim() || myName;
    roomErrorEl.hidden = true;
    Net.send({ type:'createRoom', name: myName, color: myColor });
  });
  joinRoomBtn.addEventListener('click', function(){
    var code = roomCodeInput.value.trim().toUpperCase();
    if (!code) { roomCodeInput.focus(); return; }
    myName = nameInput.value.trim() || myName;
    roomErrorEl.hidden = true;
    Net.send({ type:'joinRoom', code: code, name: myName, color: myColor });
  });
  copyRoomBtn.addEventListener('click', function(){
    var url = location.origin + location.pathname + '?room=' + myRoomCode;
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(url).then(function(){
      roomCopiedEl.hidden = false;
      setTimeout(function(){ roomCopiedEl.hidden = true; }, 1500);
    }).catch(function(){});
  });

  function renderPlayerList(list){
    playerListEl.innerHTML = list.map(function(p){
      return '<div class="player-chip"><span class="chip-dot" style="background:' + p.color + ';color:' + p.color + '"></span>' +
        p.name + (p.id === myId ? ' (you)' : '') + '</div>';
    }).join('');
  }

  function beginDriving(){
    gate.classList.add('gone');
    running = true;
    dayClockOffset = clock.elapsedTime;
    raceStartPerf = performance.now();
    myHealth = HEALTH_MAX;
    exploded = false;
    car.visible = true;
    updateHealthBar();
    clock.getDelta();
  }

  function startCountdown(startAt){
    countdownOverlay.hidden = false;
    (function tick(){
      var remain = Math.ceil((startAt - Date.now()) / 1000);
      if (remain <= 0){
        countdownOverlay.hidden = true;
        beginDriving();
        return;
      }
      countdownNum.textContent = remain;
      countdownNum.style.animation = 'none';
      void countdownNum.offsetWidth;
      countdownNum.style.animation = '';
      setTimeout(tick, ((startAt - Date.now() - 1) % 1000) + 1);
    })();
  }

  function requestRace(){
    sendJoin();
    Net.send({ type:'startRace', duration: myDuration });
  }

  // solo play never waits on the network
  document.getElementById('start-btn').addEventListener('click', function(){
    beginDriving();
  });

  document.getElementById('bot-race-btn').addEventListener('click', function(){
    startBotRace(soloDuration);
  });

  raceBtn.addEventListener('click', requestRace);
  raceAgainBtn.addEventListener('click', function(){
    raceResultsEl.hidden = true;
    if (raceMode === 'bot') startBotRace(soloDuration);
    else requestRace();
  });

  Net.on('unavailable', function(){
    mpStatusEl.textContent = 'No race server found on this WiFi network. Practice solo below, or run the server (see README) so friends on the same network can join.';
  });
  Net.on('open', function(){
    mpStatusEl.textContent = 'Connected! Create a room, or join a friend’s with their code.';
    roomPickerEl.hidden = false;
  });
  Net.on('close', function(){
    mpStatusEl.textContent = 'Disconnected from the race server.';
    roomPickerEl.hidden = true;
    mpSetupEl.hidden = true;
    myRoomCode = null;
  });
  function updateHostUI(){
    durationRowEl.hidden = !amHost;
    raceBtn.hidden = !amHost;
    hostWaitHintEl.hidden = amHost;
  }

  Net.on('roomCreated', function(msg){
    myId = msg.id;
    amHost = true; // the creator is always the initial host
    enterRoom(msg.code);
    updateHostUI();
  });
  Net.on('roomJoined', function(msg){
    myId = msg.id;
    amHost = false; // joiners only join -- the next 'roster' message confirms the real host
    enterRoom(msg.code);
    updateHostUI();
  });
  Net.on('roomNotFound', function(msg){
    roomErrorEl.textContent = 'Room "' + msg.code + '" not found — check the code and try again.';
    roomErrorEl.hidden = false;
  });
  Net.on('roster', function(msg){
    renderPlayerList(msg.players);
    amHost = msg.hostId === myId; // authoritative -- also catches host reassignment if the host disconnects
    updateHostUI();
    var seenIds = {};
    msg.players.forEach(function(p){
      seenIds[p.id] = true;
      if (p.id === myId) return;
      var rp = ensureRemotePlayer(p.id, p.name, p.color);
      rp.targetDist = p.distance;
      rp.targetLane = p.laneOffset;
      rp.finished = p.finished;
      rp.finishTime = p.finishTime;
    });
    Object.keys(remotePlayers).forEach(function(id){
      if (!seenIds[id]) removeRemotePlayer(Number(id));
    });
    if (msg.race){
      var busy = msg.race.state === 'countdown' || msg.race.state === 'racing';
      raceBtn.disabled = busy;
      raceBtn.textContent = busy ? 'Race in progress…' : 'Start Race';
      if (msg.race.state === 'finished' && lastHandledRaceState !== 'finished'){
        raceState = 'finished';
        showRaceResults();
      }
      lastHandledRaceState = msg.race.state;
    }
  });
  Net.on('state', function(msg){
    var rp = ensureRemotePlayer(msg.id);
    rp.targetDist = msg.distance;
    rp.targetLane = msg.laneOffset;
  });
  Net.on('leave', function(msg){
    removeRemotePlayer(msg.id);
  });
  Net.on('shot', function(msg){
    // unlike a ram, only the shooter can detect this -- the victim has no way
    // to know locally, so their physical reaction has to ride the network
    // message. Direction is random since we don't know the shot's approach angle.
    if (msg.targetId === myId){
      applyPhysicalHit(Math.random() < 0.5 ? -1 : 1, 0.55);
      applyDamage(SHOT_DAMAGE);
    }
  });
  Net.on('bump', function(msg){
    // the physical knockback already happened locally the instant *we*
    // detected this ram (see the ramming check in update()) -- this message
    // only carries the damage half, so it doesn't get applied twice.
    if (msg.targetId === myId) applyDamage(RAM_DAMAGE);
  });
  Net.on('exploded', function(msg){
    var rp = remotePlayers[msg.id];
    if (!rp) return;
    spawnExplosion(rp.group.position.clone());
    rp.group.visible = false;
    setTimeout(function(){
      if (remotePlayers[msg.id] === rp) rp.group.visible = true;
    }, RESPAWN_DELAY*1000);
  });
  Net.on('raceStart', function(msg){
    raceMode = 'multiplayer';
    stopBotRacer(); // in case a computer race was somehow still active
    raceState = 'countdown';
    lastHandledRaceState = 'countdown';
    raceEndsAt = msg.endsAt || null;
    finishDistance = msg.finishDistance || finishDistance;
    resetTrack(msg.seed);
    resetRacePhysics();

    // line everyone up side-by-side on a starting grid instead of stacking
    // every car on lane 0 -- same ID ordering on every client (sorted
    // ascending), so everyone independently agrees on the same slots.
    var gridIds = [myId].concat(Object.keys(remotePlayers).map(Number)).sort(function(a,b){ return a-b; });
    var mySlot = gridIds.indexOf(myId);
    var gridCount = gridIds.length;
    var gridSpacing = gridCount > 1 ? Math.min(2.3, (maxLane*2) / (gridCount-1)) : 0;
    laneOffset = (mySlot - (gridCount-1)/2) * gridSpacing;

    // snap the car (and camera target) to the grid immediately, rather than
    // waiting for the first driving frame -- the countdown overlay is up,
    // but there's no reason to show the old position underneath it.
    var startFrame = sampleAt(worldDistance);
    var startPx = Math.cos(startFrame.heading), startPz = Math.sin(startFrame.heading);
    car.position.set(startFrame.x + startPx*laneOffset, startFrame.y + 0.02, startFrame.z + startPz*laneOffset);
    car.rotation.y = -carHeading; // fresh heading (0), just reset above -- not tied to the road's heading

    running = false;
    startCountdown(msg.startAt);
    setTimeout(function(){ if (raceState === 'countdown') raceState = 'racing'; }, Math.max(0, msg.startAt - Date.now()));
  });

  /* ============================================================
     HOW TO PLAY: a short tutorial overlay, shown automatically the
     first time someone opens the game (tracked via localStorage) and
     reachable afterward from the gate for a refresher.
  ============================================================ */
  var TUTORIAL_SEEN_KEY = 'cardDriveTutorialSeen';
  var tutorialOverlayEl = document.getElementById('tutorial-overlay');
  var howToPlayBtn = document.getElementById('how-to-play-btn');
  var tutorialCloseBtn = document.getElementById('tutorial-close-btn');

  function showTutorial(){
    tutorialOverlayEl.hidden = false;
  }
  function hideTutorial(){
    tutorialOverlayEl.hidden = true;
    // best-effort -- a private-browsing tab or a locked-down browser can
    // throw here; worst case the tutorial just shows again next visit
    try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch (e) {}
  }

  howToPlayBtn.addEventListener('click', showTutorial);
  tutorialCloseBtn.addEventListener('click', hideTutorial);
  tutorialOverlayEl.addEventListener('click', function(e){
    if (e.target === tutorialOverlayEl) hideTutorial(); // clicking the dimmed backdrop dismisses it too
  });
  window.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !tutorialOverlayEl.hidden) hideTutorial();
  });

  var tutorialAlreadySeen = false;
  try { tutorialAlreadySeen = !!localStorage.getItem(TUTORIAL_SEEN_KEY); } catch (e) {}
  if (!tutorialAlreadySeen) showTutorial();

  Net.connect();

})();
