// src/app/flare-shaders.ts

// ============================================================================
// NEU (ETAPPE 2): 2D VELOCITY FLOWMAP SHADER (Ping-Pong FBO)
// Speichert in RG = Strömungsvektor (X/Y), B = Turbulenz-/Klick-Energie
// ============================================================================
export const flowmapVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const flowmapFragmentShader = `
  uniform sampler2D uPrevFlowMap;
  uniform vec2 uMouseUv;
  uniform vec2 uMouseVelocity;
  uniform float uAspect;
  uniform float uBrushRadius;
  uniform float uDissipation;
  uniform vec2 uClickUv;
  uniform float uClickImpulse;

  varying vec2 vUv;

  void main() {
    // 1. Self-Advection: Die Strömung trägt sich selbst leicht in Flussrichtung weiter
    vec4 current = texture2D(uPrevFlowMap, vUv);
    vec2 advectUv = clamp(vUv - current.xy * 0.0045, 0.001, 0.999);
    vec4 flow = texture2D(uPrevFlowMap, advectUv);

    // Organisches Abklingen (Trägheit des Fluids)
    flow.xy *= uDissipation;
    flow.z *= (uDissipation - 0.012);

    // 2. Maus-Interaktion (Erzeugt eine sanfte Kielwelle in Bewegungsrichtung)
    vec2 diff = vUv - uMouseUv;
    diff.x *= uAspect;
    float distSq = dot(diff, diff);
    float radiusSq = uBrushRadius * uBrushRadius;

    float brush = exp(-distSq / max(radiusSq, 0.0001));
    float speed = length(uMouseVelocity);

    // Leichter seitlicher Wirbel (Curl) am Rand des Mauspinsels
    vec2 ortho = vec2(-diff.y, diff.x) * (uMouseVelocity.x - uMouseVelocity.y) * 2.5;
    flow.xy += (uMouseVelocity * 18.0 + ortho) * brush;
    flow.z = clamp(flow.z + brush * min(speed * 26.0, 1.0), 0.0, 1.5);

    // 3. Klick-Schockwelle (Breitet sich radial im Fluid-Grid aus)
    if (uClickImpulse > 0.001) {
      vec2 cDiff = vUv - uClickUv;
      cDiff.x *= uAspect;
      float cDist = length(cDiff);

      float ringRadius = (1.0 - uClickImpulse) * 0.26 + 0.015;
      float ringMask = exp(-pow((cDist - ringRadius) / 0.08, 2.0)) * uClickImpulse;

      vec2 pushDir = cDist > 0.0001 ? normalize(cDiff) : vec2(0.0, 1.0);
      pushDir.x /= max(uAspect, 0.1);

      flow.xy += pushDir * ringMask * 0.70;
      flow.z = clamp(flow.z + ringMask * 0.95, 0.0, 1.5);
    }

    // Sicherheits-Clamp gegen extremes Aufschaukeln
    float len = length(flow.xy);
    if (len > 2.4) {
      flow.xy = (flow.xy / len) * 2.4;
    }

    gl_FragColor = vec4(flow.xy, flow.z, 1.0);
  }
`;

// ============================================================================
// FACKEL-KERN SHADER
// ============================================================================
export const flareCoreVertexShader = `
  uniform vec3 uFlarePos;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position + uFlarePos + vec3(0.0, 0.38, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const flareCoreFragmentShader = `
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uAuraColor;
  uniform vec3 uWind;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float jetNoise(vec2 p) {
    float v = 0.55 * noise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1;
    v += 0.30 * noise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1;
    v += 0.15 * noise(p);
    return v;
  }

  void main() {
    float t = uTime + uTimeOffset;

    float x = (vUv.x - 0.5) * 3.6;
    float y = (vUv.y - 0.30) * 2.4;

    float flicker = 1.0
      + sin(t * 62.0) * 0.15
      + cos(t * 37.0) * 0.12
      + sin(t * 97.0) * 0.08;

    float windTilt = clamp(y, 0.0, 1.0);
    x -= uWind.x * 0.11 * windTilt * windTilt;

    vec2 flowUv = vec2(x * 4.5, y * 3.8 - t * 11.5);
    float n1 = jetNoise(flowUv);
    float n2 = jetNoise(flowUv * 2.2 + vec2(3.7, -t * 6.0));
    float turb = (n1 * 0.6 + n2 * 0.4) - 0.5;

    float h = clamp(y, 0.0, 1.0);
    float coneWidth = mix(0.05, 0.22, pow(h, 0.75)) * (0.88 + 0.12 * flicker);

    float flameWave = turb * (0.08 + 0.38 * pow(h, 0.8));
    float radialDist = abs(x + flameWave) / max(coneWidth, 0.001);

    float dynamicHeight = 0.62 * flicker + turb * 0.38;
    float nozzleCut = smoothstep(-0.03, 0.02, y);
    float topRip = smoothstep(dynamicHeight + 0.18, dynamicHeight - 0.15, y);
    float jetMask = nozzleCut * topRip;

    float edgeErosion = smoothstep(1.15, 0.35, radialDist + (0.5 - n1) * 0.55 * h);
    float whiteCore = edgeErosion * jetMask * 1.55;
    float innerRim = smoothstep(1.8, 0.4, radialDist) * jetMask * 0.95 * flicker;

    vec2 glowPos = vec2(x * 0.7, (y - 0.28) * 0.9);
    float outerAura = exp(-dot(glowPos, glowPos) * 4.2) * 0.42 * flicker;

    vec2 edgeVec = (vUv - 0.5) * 2.0;
    float quadMask = smoothstep(1.0, 0.7, max(abs(edgeVec.x), abs(edgeVec.y)));

    vec3 coreColor = vec3(1.0, 0.96, 0.90) * whiteCore;
    vec3 rimColor = mix(uAuraColor, vec3(1.0, 0.75, 0.35), 0.25) * innerRim;
    vec3 auraColor = uAuraColor * outerAura;

    vec3 finalColor = (coreColor + rimColor + auraColor) * quadMask;
    float alpha = clamp((whiteCore + innerRim * 0.8 + outerAura) * quadMask, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ============================================================================
// RAUCH SHADER (Angepasst auf uFlowMap & ohne Sub-Pixel-Overdraw)
// ============================================================================
export const smokeVertexShader = `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uFlarePos;
  uniform vec3 uWind;
  uniform sampler2D uFlowMap; // NEU: Unser globales Fluid-Grid

  uniform float uSmokeLifetime;
  uniform float uSmokeDensity;
  uniform float uSmokeSpread;

  varying vec2 vUv;
  varying vec2 vSeed;
  varying float vHeatFactor;
  varying float vAlphaMultiplier;
  varying float vLife;

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  vec3 getSmokeLocalPos(float l, float t) {
    vec3 rnd = hash33(aSeed * 17.31);

    float spawnHeight = 0.02 + rnd.y * 0.35;
    float distanceScale = uSmokeLifetime;
    float windInfluence = pow(l, 1.15) * distanceScale;

    float radialEnvelope = 0.32 + (smoothstep(0.0, 0.65, l) * 0.75 + pow(l, 1.4) * 0.35) * uSmokeSpread * sqrt(distanceScale);

    float baseAngle = rnd.x * 6.2831853 + l * (1.2 + rnd.z * 1.6) * (rnd.y > 0.5 ? 1.0 : -1.0);
    float radius = sqrt(rnd.z) * radialEnvelope;

    float swirlPhase = l * 3.8 - t * 0.55 + rnd.y * 6.2831853;
    vec3 turbulence = vec3(
      sin(swirlPhase) * 0.28 + cos(swirlPhase * 1.7 + rnd.x * 5.0) * 0.14,
      sin(swirlPhase * 1.3 + rnd.z * 4.0) * 0.18,
      cos(swirlPhase * 0.9 + rnd.x * 6.0) * 0.28
    ) * smoothstep(0.0, 0.4, l) * mix(1.0, uSmokeSpread, 0.6);

    float verticalSpread = (rnd.y - 0.5) * 0.45 * mix(1.0, uSmokeSpread, l);

    float xPos = cos(baseAngle) * radius * 0.85 + uWind.x * windInfluence * (0.75 + rnd.z * 0.35) + turbulence.x;
    float yPos = spawnHeight + pow(l, 0.92) * 3.35 * distanceScale + uWind.y * windInfluence + verticalSpread + turbulence.y;
    float zPos = sin(baseAngle) * radius * 0.85 + uWind.z * windInfluence + turbulence.z;

    return vec3(xPos, yPos, zPos);
  }

  void main() {
    vUv = uv;
    vSeed = aSeed.yz;

    float t = uTime + uTimeOffset;
    float speed = (0.020 + aSeed.z * 0.015) / max(uSmokeLifetime, 0.1);

    float totalLifeNow = aSeed.x + t * speed;
    float life = fract(totalLifeNow);
    vLife = life;

    // 1. Reguläre Grundposition berechnen
    vec3 offset = uFlarePos + getSmokeLocalPos(life, t);

    // 2. NEU (ETAPPE 2): Abfrage der 2D Velocity Flowmap an der aktuellen Bildschirmposition
    vec4 baseClip = projectionMatrix * modelViewMatrix * vec4(offset, 1.0);
    vec2 screenUv = (baseClip.xy / max(baseClip.w, 0.0001)) * 0.5 + 0.5;
    vec4 flowData = texture2D(uFlowMap, clamp(screenUv, 0.0, 1.0));

    // Direkt an der Fackeldüse (life ~ 0) bleibt der Rauch verankert,
    // weiter oben lässt er sich butterweich von der Flowmap mittragen
    float flowSensitivity = smoothstep(0.02, 0.28, life);
    offset.xy += flowData.xy * (1.05 + aSeed.z * 0.45) * flowSensitivity;
    offset.z -= flowData.z * 0.25 * flowSensitivity;

    float flowEnergy = flowData.z * flowSensitivity;

    // Größen- und Rotationsanpassung durch das Strömungs-Grid
    float spreadScaleBoost = mix(1.0, uSmokeSpread, 0.25 * life);
    float baseScale = mix(0.75, 1.75, smoothstep(0.0, 0.85, life)) * (0.85 + aSeed.y * 0.35) * spreadScaleBoost;
    float scale = baseScale * (1.0 + flowEnergy * 0.38);

    float windRollDir = sign(uWind.x != 0.0 ? uWind.x : 1.0);
    float flowSpin = (flowData.x - flowData.y) * 0.55 * flowSensitivity;
    float angle = aSeed.y * 6.2831 - (life * 0.9 + flowSpin) * windRollDir * (0.5 + aSeed.z * 0.5);
    float s = sin(angle);
    float c = cos(angle);
    vec2 rotatedPos = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * scale;

    float flickerBoost = 0.92 + 0.08 * sin(t * 42.0);
    vHeatFactor = exp(-life * 2.1) * flickerBoost;

    float lifeFade = smoothstep(0.0, 0.12, life) * pow(1.0 - life, 1.25);
    float dispersionFade = 1.0 / (1.0 + flowEnergy * 0.45);
    float densityOpacity = clamp(0.56 * uSmokeDensity, 0.0, 1.0) * dispersionFade;
    vAlphaMultiplier = lifeFade * densityOpacity;

    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    mvPosition.xy += rotatedPos;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const smokeFragmentShader = `
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uAuraColor;
  uniform vec3 uFogColor;
  uniform float uSmokeDensity;

  varying vec2 vUv;
  varying vec2 vSeed;
  varying float vHeatFactor;
  varying float vAlphaMultiplier;
  varying float vLife;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float softNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i + vec2(0.0, 0.0)), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float t = uTime + uTimeOffset;
    float oneMinusDistSq = 1.0 - distSq;
    float radialEnvelope = oneMinusDistSq * oneMinusDistSq;

    // ETAPPE 1 CLEANUP: Schnelles, sauberes 2-Oktaven-Noise ohne das teure 50.000er Sub-Pixel-Grid
    vec2 mistUv = vUv * 2.4 + vSeed * 11.0 + vec2(0.0, -t * 0.14);
    float n1 = softNoise(mistUv);
    float n2 = softNoise(mistUv * 2.1 + vec2(3.4, -t * 0.22));
    float mistNoise = n1 * 0.65 + n2 * 0.35;

    float softMist = radialEnvelope * smoothstep(0.18, 0.82, mistNoise) * 0.52 * uSmokeDensity;

    vec3 ambientSmoke = mix(vec3(0.04, 0.05, 0.09), uFogColor * 0.55, mistNoise);
    vec3 finalColor = mix(ambientSmoke, uAuraColor * 1.25, clamp(vHeatFactor * 0.90, 0.0, 1.0));

    float alpha = clamp(softMist * vAlphaMultiplier, 0.0, 1.0);
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ============================================================================
// FUNKEN SHADER (Gekoppelt an uFlowMap)
// ============================================================================
export const sparksVertexShader = `
  attribute vec4 aSparkSeed;
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uFlarePos;
  uniform vec3 uAuraColor;
  uniform vec3 uWind;
  uniform sampler2D uFlowMap;

  varying vec3 vColor;
  varying float vFade;

  void main() {
    float t = uTime + uTimeOffset;
    float speed = 0.48 + aSparkSeed.z * 0.55;
    float cycle = fract(aSparkSeed.x + t * speed);
    float activeWindow = 0.16 + aSparkSeed.w * 0.12;

    if (cycle >= activeWindow) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vFade = 0.0;
      return;
    }

    float life = cycle / activeWindow;
    bool isSlagDrop = aSparkSeed.y < 0.15;

    vec3 startPos;
    vec3 velocity;
    float gravity;

    if (isSlagDrop) {
      startPos = vec3((aSparkSeed.w - 0.5) * 0.05, -0.02, 0.0);
      velocity = vec3((aSparkSeed.w - 0.5) * 0.45, -0.25, (aSparkSeed.z - 0.5) * 0.2);
      gravity = 3.2;
    } else {
      float spawnY = 0.22 + aSparkSeed.w * 0.16;
      float spreadAngle = (aSparkSeed.y - 0.575) * 3.1;

      startPos = vec3(
        sin(spreadAngle) * 0.06 + uWind.x * 0.04,
        spawnY,
        (aSparkSeed.z - 0.5) * 0.06
      );

      float ejectPower = 1.6 + aSparkSeed.z * 1.9;
      float sideBurst = sin(spreadAngle) * (0.9 + aSparkSeed.w * 1.4);
      float upBurst = cos(spreadAngle * 0.55) * ejectPower;

      velocity = vec3(
        sideBurst + uWind.x * 0.32,
        upBurst,
        (aSparkSeed.z - 0.5) * 0.8
      );
      gravity = 3.8;
    }

    float drag = 1.0 - life * 0.35;
    vec3 pos = uFlarePos + startPos + velocity * life * drag;
    pos.y -= 0.5 * gravity * life * life;

    // NEU: Funken lassen sich ebenfalls von der Flowmap verwirbeln
    vec4 baseClip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vec2 screenUv = (baseClip.xy / max(baseClip.w, 0.0001)) * 0.5 + 0.5;
    vec4 flowData = texture2D(uFlowMap, clamp(screenUv, 0.0, 1.0));
    pos.xy += flowData.xy * 0.85 * life;

    vec3 hotWhite = vec3(3.6, 2.9, 2.0);
    vec3 brightSparkColor = mix(vec3(2.2, 1.4, 0.6), uAuraColor * 2.5, 0.6);
    vColor = mix(hotWhite, brightSparkColor, smoothstep(0.15, 0.75, life));

    float sputter = 0.75 + 0.25 * sin(t * 90.0 + aSparkSeed.w * 140.0);
    vFade = (1.0 - pow(life, 2.2)) * sputter;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float baseSize = mix(42.0, 14.0, pow(life, 0.6)) * (0.75 + aSparkSeed.z * 0.5);
    gl_PointSize = baseSize * (1.0 / -mvPosition.z);
  }
`;

export const sparksFragmentShader = `
  varying vec3 vColor;
  varying float vFade;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float core = exp(-distSq * 3.2);
    gl_FragColor = vec4(vColor, core * vFade);
  }
`;

// ============================================================================
// REGEN & KLICK-STAUB SHADER
// ============================================================================
export const rainVertexShader = `
  attribute vec4 aRainSeed;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform vec3 uWind;
  uniform sampler2D uFlowMap;
  uniform vec3 uFlarePos1;
  uniform vec3 uAuraColor1;
  uniform vec3 uFlarePos2;
  uniform vec3 uAuraColor2;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vUv = uv;

    float speed = 0.52 + aRainSeed.w * 0.32;
    float life = fract(aRainSeed.x + uTime * speed);

    float fallDistance = 9.5;
    vec3 drift = vec3(uWind.x * 0.32, -fallDistance, uWind.z * 0.32);

    vec3 startPos = vec3(
      (aRainSeed.y - 0.5) * 14.0 - uWind.x * 0.18,
      6.2,
      (aRainSeed.z - 0.5) * 7.5
    );

    vec3 pos = startPos + drift * life;

    vec4 baseClip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vec2 screenUv = (baseClip.xy / max(baseClip.w, 0.0001)) * 0.5 + 0.5;
    vec4 flowData = texture2D(uFlowMap, clamp(screenUv, 0.0, 1.0));
    pos.xy += flowData.xy * 0.45;

    vec3 toFlare1 = pos - (uFlarePos1 + vec3(0.0, 0.25, 0.0));
    float distSq1 = dot(toFlare1, toFlare1);
    float core1 = exp(-distSq1 * 0.85);
    float scatter1 = exp(-distSq1 * 0.16);
    float light1 = clamp(core1 + scatter1 * 0.45, 0.0, 1.0);
    vec3 glow1 = mix(uAuraColor1 * 1.65, vec3(2.2, 1.2, 1.2), core1 * 0.6) * light1;

    vec3 toFlare2 = pos - (uFlarePos2 + vec3(0.0, 0.25, 0.0));
    float distSq2 = dot(toFlare2, toFlare2);
    float core2 = exp(-distSq2 * 0.85);
    float scatter2 = exp(-distSq2 * 0.16);
    float light2 = clamp(core2 + scatter2 * 0.45, 0.0, 1.0);
    vec3 glow2 = mix(uAuraColor2 * 1.65, vec3(1.5, 2.0, 2.2), core2 * 0.6) * light2;

    float totalLight = clamp(light1 + light2, 0.0, 1.0);
    vec3 darkRainColor = uFogColor * 0.45;
    vColor = darkRainColor * (1.0 - totalLight * 0.5) + glow1 + glow2;

    float edgeFade = smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.88, life);
    float depthFade = smoothstep(-4.0, 2.5, pos.z) * 0.5 + 0.5;
    vAlpha = mix(0.16, 0.85, totalLight) * edgeFade * depthFade;

    vec2 upDir = normalize(vec2(-drift.x, -drift.y));
    vec2 rightDir = vec2(upDir.y, -upDir.x);

    float dropWidth = 0.025 * (0.85 + aRainSeed.w * 0.3);
    float dropLength = 0.20 + aRainSeed.w * 0.12;

    vec2 orientedOffset = rightDir * (position.x * dropWidth) + upDir * (position.y * dropLength);
    vec3 finalWorldPos = pos + vec3(orientedOffset, 0.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalWorldPos, 1.0);
  }
`;

export const rainFragmentShader = `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float headCurve = smoothstep(0.0, 0.22, vUv.y);
    float tailTaper = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.72);
    float dropEnvelope = mix(0.25, 1.0, headCurve) * tailTaper;

    float distFromCenter = abs(vUv.x - 0.5) * 2.0;
    float normalizedX = distFromCenter / max(dropEnvelope, 0.001);
    if (normalizedX > 1.0) discard;

    float horizontalSoftness = smoothstep(1.0, 0.12, normalizedX);
    float verticalStreak = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - vUv.y, 1.15);
    float dropletHead = exp(-pow((vUv.y - 0.20) * 5.2, 2.0)) * 0.45;

    float alpha = horizontalSoftness * clamp(verticalStreak + dropletHead, 0.0, 1.0) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

export const clickDustVertexShader = `
  attribute vec4 aDustSeed;
  uniform float uTime;
  uniform float uClickTime;
  uniform vec3 uClickPos;
  uniform vec3 uWind;
  uniform vec3 uFogColor;
  uniform vec3 uFlarePos1;
  uniform vec3 uAuraColor1;
  uniform vec3 uFlarePos2;
  uniform vec3 uAuraColor2;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float elapsed = uTime - uClickTime;
    float duration = 1.1 + aDustSeed.w * 1.1;

    if (elapsed <= 0.0 || elapsed >= duration) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vAlpha = 0.0;
      return;
    }

    float life = elapsed / duration;

    float angle = aDustSeed.x * 6.2831853;
    float elevation = (aDustSeed.y - 0.5) * 2.4;
    float spreadRadius = 0.25 + pow(aDustSeed.z, 0.85) * 1.85;
    float burstProgress = 1.0 - exp(-elapsed * 3.8);

    vec3 dir = vec3(
      cos(angle) * cos(elevation * 0.5),
      sin(angle) * cos(elevation * 0.5),
      sin(elevation) * 0.4
    );

    vec3 turbulence = vec3(
      sin(elapsed * 2.8 + aDustSeed.y * 12.0),
      cos(elapsed * 2.3 + aDustSeed.x * 12.0),
      0.0
    ) * 0.14 * life;

    vec3 windDrift = uWind * 0.16 * elapsed * elapsed;
    vec3 pos = uClickPos + dir * spreadRadius * burstProgress + turbulence + windDrift;

    float d1 = dot(pos - uFlarePos1, pos - uFlarePos1);
    float d2 = dot(pos - uFlarePos2, pos - uFlarePos2);
    float glow1 = exp(-d1 * 0.45);
    float glow2 = exp(-d2 * 0.45);

    vec3 baseDustColor = mix(uFogColor * 1.7, vec3(0.88, 0.94, 1.0), 0.65);
    vColor = baseDustColor + uAuraColor1 * glow1 * 1.9 + uAuraColor2 * glow2 * 1.9;

    float twinkle = 0.55 + 0.45 * sin(elapsed * 22.0 + aDustSeed.w * 80.0);
    float fadeIn = smoothstep(0.0, 0.06, life);
    float fadeOut = pow(1.0 - life, 1.6);
    vAlpha = fadeIn * fadeOut * twinkle;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float baseSize = mix(24.0, 5.0, pow(life, 0.55)) * (0.45 + pow(aDustSeed.z, 1.8) * 1.1);
    gl_PointSize = baseSize * (1.0 / -mvPosition.z);
  }
`;

export const clickDustFragmentShader = `
  varying vec3 vColor;
  varying float vFade;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float particleMask = exp(-distSq * 3.8);
    gl_FragColor = vec4(vColor, particleMask * vAlpha);
  }
`;