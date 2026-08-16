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
  var TERRAIN_HALF_WIDTH = 64;
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
  ============================================================ */
  var cactusMat = new THREE.MeshStandardMaterial({ color: 0x2f8f5b, roughness: 0.8 });
  var pineFoliageMat = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.9 });
  var pineTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
  var mesaMat = new THREE.MeshStandardMaterial({ color: 0xaa5a34, roughness: 1 });
  var mountainMat = new THREE.MeshStandardMaterial({ color: 0x5a5f8f, roughness: 1 });

  var cactusTrunkGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.6, 7);
  var cactusArmGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6);
  var pineTrunkGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.5, 6);
  var pineFoliageGeo = new THREE.ConeGeometry(0.6, 1.5, 8);
  var mesaGeo = new THREE.BoxGeometry(1, 1, 1);
  var mountainGeo = new THREE.ConeGeometry(1, 1, 5);

  function buildCactus(){
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(cactusTrunkGeo, cactusMat);
    trunk.position.y = 0.8;
    g.add(trunk);
    [-1,1].forEach(function(side){
      var arm = new THREE.Mesh(cactusArmGeo, cactusMat);
      arm.position.set(side*0.22, 0.95, 0);
      arm.rotation.z = side * 0.9;
      g.add(arm);
    });
    return g;
  }
  function buildPine(){
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(pineTrunkGeo, pineTrunkMat);
    trunk.position.y = 0.25;
    g.add(trunk);
    var foliage = new THREE.Mesh(pineFoliageGeo, pineFoliageMat);
    foliage.position.y = 1.1;
    g.add(foliage);
    return g;
  }
  function buildMesa(){
    var m = new THREE.Mesh(mesaGeo, mesaMat);
    m.scale.set(3+rng()*4, 3+rng()*5, 3+rng()*4);
    m.position.y = m.scale.y/2;
    return m;
  }
  function buildMountain(){
    var m = new THREE.Mesh(mountainGeo, mountainMat);
    m.scale.set(6+rng()*5, 7+rng()*7, 6+rng()*5);
    m.position.y = m.scale.y/2;
    m.rotation.y = rng()*Math.PI;
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

  var chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 3.6), bodyMat);
  chassis.position.y = 0.5;
  car.add(chassis);

  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.42, 1.55), glassMat);
  cabin.position.set(0, 0.88, -0.1);
  cabin.rotation.x = -0.1;
  car.add(cabin);

  var hood = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 1.15), bodyMat);
  hood.position.set(0, 0.7, -1.55);
  hood.rotation.x = 0.14;
  car.add(hood);

  var spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.28), bodyMat);
  spoiler.position.set(0, 0.92, 1.75);
  car.add(spoiler);
  [-1,1].forEach(function(side){
    var strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), bodyMat);
    strut.position.set(side*0.7, 0.78, 1.75);
    car.add(strut);
  });

  [-1,1].forEach(function(side){
    var strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 3.4), trimMat);
    strip.position.set(side*0.87, 0.42, 0);
    car.add(strip);
  });

  var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
  [[-0.86,0.36,-1.15],[0.86,0.36,-1.15],[-0.86,0.36,1.25],[0.86,0.36,1.25]].forEach(function(p){
    var wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI/2;
    wheel.position.set(p[0], p[1], p[2]);
    car.add(wheel);
  });

  [-0.55,0.55].forEach(function(x){
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), headlightMat);
    hl.position.set(x, 0.55, -1.82);
    car.add(hl);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), taillightMat);
    tl.position.set(x, 0.6, 1.82);
    car.add(tl);
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
  var SCENERY_NEAR_PER_CHUNK = 10;
  var SCENERY_FAR_PER_CHUNK = 7;

  function buildChunk(targetEndS){
    var samples = [lastSample].concat(advancePathTo(targetEndS));
    lastSample = samples[samples.length-1];
    var startS = samples[0].s, endS = samples[samples.length-1].s;

    var group = new THREE.Group();
    var ownGeometries = [];

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
    }

    scene.add(group);
    return { startS: startS, endS: endS, samples: samples, group: group, ownGeometries: ownGeometries };
  }

  function disposeChunk(chunk){
    scene.remove(chunk.group);
    chunk.ownGeometries.forEach(function(g){ g.dispose(); });
  }

  var AHEAD_DIST = 300;
  var BEHIND_DIST = 40;
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
  var input = { left:false, right:false, boost:false, brake:false, fire:false };
  var pointerSteer = 0;
  var pointerActive = false;
  var pointerStartX = 0;
  var laneOffset = 0;
  var steerSmooth = 0;
  var driftAngle = 0;

  window.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.boost = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.brake = true;
    if (e.key === ' ' || e.key === 'Spacebar') { input.fire = true; e.preventDefault(); }
    hideHint();
  });
  window.addEventListener('keyup', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.boost = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') input.brake = false;
    if (e.key === ' ' || e.key === 'Spacebar') input.fire = false;
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
    input.left = false; input.right = false; input.boost = false; input.brake = false; input.fire = false;
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
  var MAX_SPEED = 34, MAX_REVERSE = -6;
  var ACCEL = 16, BRAKE_DECEL = 24, COAST_DRAG = 7;

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
  var DURATION_OPTIONS = [60, 120, 180, 300];
  var myDuration = 120000;
  var raceState = 'solo'; // 'solo' | 'lobby' | 'countdown' | 'racing' | 'finished'
  var lastHandledRaceState = null;
  var raceStartPerf = 0;
  var localFinished = false;
  var myFinishTime = null;
  var FINISH_S = 1250; // ~3000 displayed metres
  var finishGate = null;
  var lastNetSend = 0;

  function buildGhostCar(colorHex){
    var g = new THREE.Group();
    var bMat = new THREE.MeshPhysicalMaterial({ color: 0xd6dcec, roughness: 0.35, metalness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.12 });
    var tMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: new THREE.Color(colorHex), emissiveIntensity: 1.4, roughness: 0.3 });
    var gMat = new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.1, metalness: 0.8 });
    var wMat = new THREE.MeshStandardMaterial({ color: 0x0b0c14, roughness: 0.9 });

    var body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 3.6), bMat);
    body.position.y = 0.5;
    g.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.42, 1.55), gMat);
    cab.position.set(0, 0.88, -0.1);
    cab.rotation.x = -0.1;
    g.add(cab);
    [-1,1].forEach(function(side){
      var strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 3.4), tMat);
      strip.position.set(side*0.87, 0.42, 0);
      g.add(strip);
      var tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.06), tMat);
      tl.position.set(side*0.55, 0.6, 1.82);
      g.add(tl);
    });
    var wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12);
    [[-0.86,0.36,-1.15],[0.86,0.36,-1.15],[-0.86,0.36,1.25],[0.86,0.36,1.25]].forEach(function(p){
      var wheel = new THREE.Mesh(wGeo, wMat);
      wheel.rotation.z = Math.PI/2;
      wheel.position.set(p[0], p[1], p[2]);
      g.add(wheel);
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

  var remotePlayers = {}; // id -> { group, nameSprite, color, name, targetDist, targetLane, dispDist, dispLane, finished, finishTime }

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
    return rp;
  }

  function removeRemotePlayer(id){
    var rp = remotePlayers[id];
    if (!rp) return;
    scene.remove(rp.group);
    delete remotePlayers[id];
  }

  function ensureFinishGate(){
    if (finishGate) return;
    var f = sampleAt(FINISH_S);
    if (Math.abs(f.s - FINISH_S) > 1) return; // not built yet, try again next frame
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
          Net.send({ type:'shot', targetId: Number(rid3) });
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
    var effMaxSpeed = MAX_SPEED + boost;
    var effAccel = ACCEL + boost*0.6;
    if (frozen){
      speed = Math.max(0, speed - COAST_DRAG*1.4*dt);
    } else if (input.boost){
      speed += effAccel*dt;
    } else if (input.brake){
      speed -= BRAKE_DECEL*dt;
    } else if (speed > 0){
      speed = Math.max(0, speed - COAST_DRAG*dt);
    } else if (speed < 0){
      speed = Math.min(0, speed + COAST_DRAG*dt);
    }
    speed = Math.max(MAX_REVERSE, Math.min(effMaxSpeed, speed));
    var accel = (speed - prevSpeed) / Math.max(dt, 0.0001);

    var rawSteer = frozen ? 0 : ((input.right?1:0) - (input.left?1:0) + pointerSteer);
    steerSmooth += (rawSteer - steerSmooth) * Math.min(1, dt*9);
    var speedFactor = 1 - Math.min(0.55, Math.abs(speed)/MAX_SPEED*0.55);
    var steerDir = speed < -0.05 ? -1 : 1;
    laneOffset += steerDir * steerSmooth * dt * 5.6 * speedFactor;
    laneOffset += lateralVelocity * dt;
    lateralVelocity *= Math.max(0, 1 - dt*4.5); // drag -- the knockback slide settles out
    var maxLane = ROAD_WIDTH/2 - 1.1;
    laneOffset = Math.max(-maxLane, Math.min(maxLane, laneOffset));

    var driftTarget = steerSmooth * Math.min(1, Math.abs(speed)/22) * 0.5;
    driftAngle += (driftTarget - driftAngle) * Math.min(1, dt*3.2);

    worldDistance += speed * dt;
    if (localFinished) worldDistance = Math.min(worldDistance, FINISH_S);
    ensureChunks(worldDistance);
    ensureFinishGate();

    if (!localFinished && worldDistance >= FINISH_S){
      localFinished = true;
      myFinishTime = raceState === 'racing' ? (performance.now() - raceStartPerf) / 1000 : clock.elapsedTime;
      document.getElementById('finish-time').textContent = myFinishTime.toFixed(1) + 's';
      document.getElementById('finish-toast').hidden = false;
      Net.send({ type:'finish', time: myFinishTime });
    }

    var frame = sampleAt(worldDistance);
    var px = Math.cos(frame.heading), pz = Math.sin(frame.heading);

    var t = clock.elapsedTime;
    var bob = reduceMotion ? 0 : Math.sin(t*8) * 0.02 * Math.min(1.3, Math.abs(speed)/18);

    car.position.set(frame.x + px*laneOffset, frame.y + 0.02 + bob, frame.z + pz*laneOffset);
    var slope = slopeAt(worldDistance);
    car.rotation.y = -frame.heading - steerSmooth*0.05 - driftAngle;
    car.rotation.x = reduceMotion ? 0 : Math.atan(slope) - accel*0.0035;
    car.rotation.z = reduceMotion ? 0 : frame.bank - steerSmooth*0.1 - driftAngle*0.35 + Math.sin(t*8)*0.01;

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
          Net.send({ type:'bump', targetId: Number(rid) });
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
    drawLaneIndicator(laneOffset / maxLane);
    updateLeaderboard();
  }

  function animate(){
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (running) update(dt);
    renderer.render(scene, camera);
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
      sendJoin();
    });
    swatchesEl.appendChild(b);
  });

  var durationChipsEl = document.getElementById('duration-chips');
  DURATION_OPTIONS.forEach(function(secs){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'duration-chip' + (secs*1000 === myDuration ? ' selected' : '');
    b.textContent = Math.floor(secs/60) + ':' + String(secs%60).padStart(2,'0');
    b.addEventListener('click', function(){
      myDuration = secs*1000;
      var all = durationChipsEl.querySelectorAll('.duration-chip');
      for (var i3=0;i3<all.length;i3++) all[i3].classList.remove('selected');
      b.classList.add('selected');
    });
    durationChipsEl.appendChild(b);
  });

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

  raceBtn.addEventListener('click', requestRace);
  document.getElementById('race-again-btn').addEventListener('click', function(){
    raceResultsEl.hidden = true;
    requestRace();
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
  Net.on('roomCreated', function(msg){
    myId = msg.id;
    enterRoom(msg.code);
  });
  Net.on('roomJoined', function(msg){
    myId = msg.id;
    enterRoom(msg.code);
  });
  Net.on('roomNotFound', function(msg){
    roomErrorEl.textContent = 'Room "' + msg.code + '" not found — check the code and try again.';
    roomErrorEl.hidden = false;
  });
  Net.on('roster', function(msg){
    renderPlayerList(msg.players);
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
    raceState = 'countdown';
    lastHandledRaceState = 'countdown';
    raceEndsAt = msg.endsAt || null;
    resetTrack(msg.seed);
    worldDistance = 0; localFinished = false; myFinishTime = null;
    steerSmooth = 0; lateralVelocity = 0; driftAngle = 0;

    // line everyone up side-by-side on a starting grid instead of stacking
    // every car on lane 0 -- same ID ordering on every client (sorted
    // ascending), so everyone independently agrees on the same slots.
    var gridIds = [myId].concat(Object.keys(remotePlayers).map(Number)).sort(function(a,b){ return a-b; });
    var mySlot = gridIds.indexOf(myId);
    var gridCount = gridIds.length;
    var maxLane = ROAD_WIDTH/2 - 1.1;
    var gridSpacing = gridCount > 1 ? Math.min(2.3, (maxLane*2) / (gridCount-1)) : 0;
    laneOffset = (mySlot - (gridCount-1)/2) * gridSpacing;

    // snap the car (and camera target) to the grid immediately, rather than
    // waiting for the first driving frame -- the countdown overlay is up,
    // but there's no reason to show the old position underneath it.
    var startFrame = sampleAt(worldDistance);
    var startPx = Math.cos(startFrame.heading), startPz = Math.sin(startFrame.heading);
    car.position.set(startFrame.x + startPx*laneOffset, startFrame.y + 0.02, startFrame.z + startPz*laneOffset);
    car.rotation.y = -startFrame.heading;

    finishToastEl.hidden = true;
    raceResultsEl.hidden = true;
    gate.classList.add('gone');
    running = false;
    startCountdown(msg.startAt);
    setTimeout(function(){ if (raceState === 'countdown') raceState = 'racing'; }, Math.max(0, msg.startAt - Date.now()));
  });

  Net.connect();

})();
