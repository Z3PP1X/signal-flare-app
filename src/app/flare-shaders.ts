// src/app/flare-shaders.ts

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

  float fbm(vec2 p) {
    float v = 0.50 * noise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.05;
    v += 0.28 * noise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.15;
    v += 0.14 * noise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.25;
    v += 0.08 * noise(p);
    return v;
  }

  void main() {
    float t = uTime + uTimeOffset;

    float x = (vUv.x - 0.5) * 3.4;
    float y = (vUv.y - 0.22) * 2.5;

    float flicker = 1.0
      + sin(t * 58.0) * 0.10
      + cos(t * 33.0) * 0.08
      + sin(t * 91.0) * 0.05;

    // Sanfte Windbiegung nach oben
    float windTilt = clamp(y, 0.0, 1.5);
    x -= uWind.x * 0.08 * windTilt * windTilt;

    // 1. Scharfer, intensiver Point-Flare / Starburst am Ursprung
    vec2 corePos = vec2(x, y);
    float coreDist = length(corePos);
    float hotPinpoint = exp(-coreDist * 14.0) * 2.6 * flicker;

    // Anamorphotische Lichtstrahlen (Lens-Flare-Optik wie im Bild rechts unten)
    float ray1 = exp(-abs(x * 1.8 + y * 0.6) * 16.0) * exp(-coreDist * 2.8);
    float ray2 = exp(-abs(x * 0.5 - y * 1.6) * 16.0) * exp(-coreDist * 2.8);
    float starRays = (ray1 + ray2) * 1.35 * flicker;

    // 2. Aufsteigende Energie-Filamente (Seidenfäden aus dem Kern)
    float h = clamp(y, 0.0, 1.4);
    vec2 streamUv = vec2(x * 3.2 + sin(h * 3.5 - t * 2.2) * 0.25, h * 2.2 - t * 3.8);
    float warp = fbm(streamUv * 1.4);
    float n1 = fbm(streamUv + vec2(warp * 0.85, -t * 1.5));

    // Ridge-Formel für scharfe, dünne Lichtlinien statt breiter Matsch-Flamme
    float ridge1 = pow(clamp(1.0 - abs(n1 * 2.0 - 0.92), 0.0, 1.0), 5.0);
    float ridge2 = pow(clamp(1.0 - abs(warp * 2.0 - 0.85), 0.0, 1.0), 4.0);

    float coneWidth = mix(0.06, 0.55, pow(clamp(h, 0.0, 1.0), 0.85));
    float radialDist = abs(x + (warp - 0.5) * 0.45 * h) / max(coneWidth, 0.001);

    float verticalMask = smoothstep(-0.08, 0.04, y) * smoothstep(1.35, 0.15, y);
    float streamMask = exp(-radialDist * radialDist * 1.4) * verticalMask;

    float filaments = (ridge1 * 1.4 + ridge2 * 0.9) * streamMask * flicker;
    float innerJet = smoothstep(1.2, 0.15, radialDist) * smoothstep(0.65, 0.0, y) * verticalMask * 1.3;

    // 3. Weiche tiefenvolumetrische Aura
    vec2 glowPos = vec2(x * 0.75, (y - 0.15) * 0.85);
    float outerAura = exp(-dot(glowPos, glowPos) * 4.5) * 0.48 * flicker;

    vec2 edgeVec = (vUv - 0.5) * 2.0;
    float quadMask = smoothstep(1.0, 0.68, max(abs(edgeVec.x), abs(edgeVec.y)));

    vec3 whiteHot = vec3(1.0, 0.97, 0.95) * (hotPinpoint + innerJet + starRays * 0.7);
    vec3 filamentColor = mix(uAuraColor * 1.8, vec3(1.0, 0.88, 0.98), 0.45) * (filaments + starRays * 0.5);
    vec3 auraColor = uAuraColor * outerAura;

    vec3 finalColor = (whiteHot + filamentColor + auraColor) * quadMask;
    float alpha = clamp((hotPinpoint + innerJet + filaments * 0.9 + outerAura + starRays) * quadMask, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const smokeVertexShader = `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uFlarePos;
  uniform vec3 uMouse3D;
  uniform float uInteractionRadius;
  uniform vec3 uWind;

  uniform float uSmokeLifetime;
  uniform float uSmokeDensity;
  uniform float uSmokeSpread;

  uniform vec3 uClickPositions[4];
  uniform float uClickTimes[4];

  varying vec2 vUv;
  varying vec2 vSeed;
  varying float vHeatFactor;
  varying float vAlphaMultiplier;
  varying float vLife;
  varying float vFlowAngle;

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  vec3 getSmokeLocalPos(float l, float t) {
    vec3 rnd = hash33(aSeed * 17.31);

    float spawnHeight = 0.02 + rnd.y * 0.30;
    float distanceScale = uSmokeLifetime;
    float windInfluence = pow(l, 1.18) * distanceScale;

    // Organische S-Kurven-Strömung wie im Konzeptbild
    float radialEnvelope = 0.24 + (smoothstep(0.0, 0.7, l) * 0.68 + pow(l, 1.45) * 0.35) * uSmokeSpread * sqrt(distanceScale);

    float baseAngle = rnd.x * 6.2831853 + l * (1.35 + rnd.z * 1.5) * (rnd.y > 0.5 ? 1.0 : -1.0);
    float radius = sqrt(rnd.z) * radialEnvelope;

    float swirlPhase = l * 4.2 - t * 0.65 + rnd.y * 6.2831853;
    vec3 turbulence = vec3(
      sin(swirlPhase) * 0.32 + cos(swirlPhase * 1.8 + rnd.x * 5.0) * 0.16,
      sin(swirlPhase * 1.4 + rnd.z * 4.0) * 0.22,
      cos(swirlPhase * 0.9 + rnd.x * 6.0) * 0.28
    ) * smoothstep(0.0, 0.35, l) * mix(1.0, uSmokeSpread, 0.6);

    float verticalSpread = (rnd.y - 0.5) * 0.42 * mix(1.0, uSmokeSpread, l);

    float xPos = cos(baseAngle) * radius * 0.85 + uWind.x * windInfluence * (0.72 + rnd.z * 0.38) + turbulence.x;
    float yPos = spawnHeight + pow(l, 0.90) * 3.45 * distanceScale + uWind.y * windInfluence + verticalSpread + turbulence.y;
    float zPos = sin(baseAngle) * radius * 0.85 + uWind.z * windInfluence + turbulence.z;

    return vec3(xPos, yPos, zPos);
  }

  void main() {
    vUv = uv;
    vSeed = aSeed.yz;

    float t = uTime + uTimeOffset;
    float speed = (0.020 + aSeed.z * 0.015) / max(uSmokeLifetime, 0.1);

    float totalLifeNow = aSeed.x + t * speed;
    float currentCycle = floor(totalLifeNow);
    float life = fract(totalLifeNow);
    vLife = life;

    vec3 localNow = getSmokeLocalPos(life, t);
    vec3 localNext = getSmokeLocalPos(min(life + 0.04, 1.0), t);
    vec2 flowDir = normalize(localNext.xy - localNow.xy + vec2(0.0001));
    vFlowAngle = atan(flowDir.y, flowDir.x);

    vec3 offset = uFlarePos + localNow;

    // Dauerhafte Klick-Verdrängung
    float permanentExpansion = 0.0;
    for (int i = 0; i < 4; i++) {
      float cTime = uClickTimes[i];
      float clickAge = uTime - cTime;

      if (clickAge > 0.0) {
        float tClick = cTime + uTimeOffset;
        float totalLifeAtClick = aSeed.x + tClick * speed;

        if (currentCycle == floor(totalLifeAtClick)) {
          float lifeAtClick = fract(totalLifeAtClick);
          vec3 posAtClick = uFlarePos + getSmokeLocalPos(lifeAtClick, tClick);
          vec3 fromClick = posAtClick - uClickPositions[i];
          float dist = length(fromClick);
          float maxRadius = 2.6;

          if (dist < maxRadius && dist > 0.001) {
            float pushCurve = 1.0 - exp(-clickAge * 5.5);
            float radialFalloff = pow(1.0 - dist / maxRadius, 1.25);
            float furtherDrift = 1.0 + (life - lifeAtClick) * 0.9;
            float pushStrength = pushCurve * radialFalloff * furtherDrift;

            offset += normalize(fromClick) * pushStrength * 1.45;
            permanentExpansion += pushStrength * 0.35;
          }
        }
      }
    }

    // Maus-Interaktion
    vec3 toMouse = offset - uMouse3D;
    float distSq = dot(toMouse, toMouse);
    float radiusSq = uInteractionRadius * uInteractionRadius;
    float pullFactor = 0.0;

    if (distSq < radiusSq) {
      float normDist = 1.0 - (sqrt(distSq) / uInteractionRadius);
      pullFactor = pow(normDist, 1.4);
      offset = mix(offset, uMouse3D, pullFactor * 0.85);
    }

    float spreadScaleBoost = mix(1.0, uSmokeSpread, 0.28 * life);
    float baseScale = mix(0.70, 1.85, smoothstep(0.0, 0.85, life)) * (0.85 + aSeed.y * 0.35) * spreadScaleBoost;
    float scale = baseScale * mix(1.0, 0.55, pullFactor) * (1.0 + permanentExpansion * 0.6);

    float windRollDir = sign(uWind.x != 0.0 ? uWind.x : 1.0);
    float angle = aSeed.y * 6.2831 - (life * 0.75 + pullFactor * 0.4 + permanentExpansion * 0.6) * windRollDir * (0.5 + aSeed.z * 0.5);
    float s = sin(angle);
    float c = cos(angle);
    vec2 rotatedPos = vec2(
      position.x * c - position.y * s,
      position.x * s + position.y * c
    ) * scale;

    float flickerBoost = 0.94 + 0.06 * sin(t * 38.0);
    // Wärme & Leuchtkraft reichen höher in den Rauch hinein (für den farbigen Glow im Bild)
    vHeatFactor = exp(-life * 1.65) * flickerBoost;

    float lifeFade = smoothstep(0.0, 0.10, life) * pow(1.0 - life, 1.35);
    float dispersionFade = 1.0 / (1.0 + permanentExpansion * 0.55);
    float densityOpacity = clamp(mix(0.55, 0.95, pullFactor) * uSmokeDensity, 0.0, 1.0) * dispersionFade;
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
  varying float vFlowAngle;

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

  // 3-Oktaven FBM für gestochen scharfe, hochaufgelöste Rauch-Texturierung
  float fbm3(vec2 p) {
    float v = 0.52 * softNoise(p);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.08;
    v += 0.31 * softNoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.15;
    v += 0.17 * softNoise(p);
    return v;
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float t = uTime + uTimeOffset;
    float oneMinusDistSq = 1.0 - distSq;
    float radialEnvelope = oneMinusDistSq * oneMinusDistSq;

    // 1. Domain-Warping: Verzerrt die Koordinaten organisch für echte HD-Rauchwirbel
    vec2 baseUv = vUv * 2.8 + vSeed * 13.7;
    vec2 warp = vec2(
      softNoise(baseUv + vec2(0.0, -t * 0.22)),
      softNoise(baseUv + vec2(5.2, -t * 0.18))
    ) - 0.5;

    vec2 warpedUv = baseUv + warp * 0.85 + vec2(0.0, -t * 0.16);
    float smokeFbm = fbm3(warpedUv);

    // 2. Scharfe Billow-Kanten (Wolkendefinition wie auf dem HD-Bild)
    float billow = smoothstep(0.22, 0.78, smokeFbm);
    float crispEdge = pow(1.0 - abs(smokeFbm * 2.0 - 1.0), 2.4);

    // 3. Seidenartige Strömungslinien / Energie-Filamente entlang der Flussrichtung
    float ca = cos(vFlowAngle);
    float sa = sin(vFlowAngle);
    vec2 streamCoord = mat2(ca, -sa, sa, ca) * centered;
    // Langgezogene Frequenz quer zur Strömung erzeugt die feinen Lichtfäden
    vec2 silkUv = vec2(streamCoord.x * 1.8 - t * 0.45, streamCoord.y * 9.5 + warp.x * 2.2) + vSeed * 7.3;
    float silkNoise = softNoise(silkUv);
    float silkStrand = pow(clamp(1.0 - abs(silkNoise * 2.0 - 1.0), 0.0, 1.0), 5.5);
    float silkMask = silkStrand * smoothstep(0.0, 0.55, oneMinusDistSq) * (0.35 + 0.65 * vHeatFactor);

    // 4. Volumetrisches Shading (Tiefe durch dunklen Rauchkern & leuchtende Kanten)
    float luminance = dot(uAuraColor, vec3(0.299, 0.587, 0.114));
    bool isDarkSmoke = luminance < 0.05; // Erkennt deine schwarze Kontrast-Fackel (0x000000)

    vec3 deepShadow = vec3(0.015, 0.02, 0.04);
    vec3 litSmokeColor = uAuraColor * 1.35 + vec3(0.18, 0.08, 0.22) * vHeatFactor;
    vec3 filamentHighlight = mix(uAuraColor * 1.9, vec3(1.0, 0.90, 0.96), 0.50);

    vec3 finalColor;
    if (isDarkSmoke) {
      // Schwarzer Rauch bleibt tiefdunkel für maximalen HD-Kontrast
      finalColor = mix(deepShadow, uFogColor * 0.18, crispEdge * 0.4);
    } else {
      // Farbiger Rauch: Schattierte Tiefe + leuchtende Rauchkanten + helle Seidenfäden
      vec3 bodyColor = mix(deepShadow, litSmokeColor, clamp(billow * 0.75 + vHeatFactor * 0.55, 0.0, 1.0));
      bodyColor += uAuraColor * crispEdge * (0.35 + vHeatFactor * 0.65);
      finalColor = mix(bodyColor, filamentHighlight, clamp(silkMask * 1.35, 0.0, 1.0));
    }

    float densityShape = (billow * 0.48 + crispEdge * 0.24 + silkMask * 0.55) * radialEnvelope * uSmokeDensity;
    float alpha = clamp(densityShape * vAlphaMultiplier, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const sparksVertexShader = `
  attribute vec4 aSparkSeed;
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uFlarePos;
  uniform vec3 uAuraColor;
  uniform vec3 uMouse3D;
  uniform float uInteractionRadius;
  uniform vec3 uWind;

  varying vec3 vColor;
  varying float vFade;

  void main() {
    // Für die rein schwarze Kontrast-Fackel keine leuchtenden Funken erzeugen
    if (dot(uAuraColor, uAuraColor) < 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vFade = 0.0;
      return;
    }

    float t = uTime + uTimeOffset;

    // 2 Partikel-Typen wie im HD-Bild:
    // 15% schnelle Fackel-Funken direkt an der Quelle, 85% aufsteigende Glühpartikel im Rauchstrom
    bool isRisingEmber = aSparkSeed.y >= 0.15;

    vec3 pos;
    float life;

    if (isRisingEmber) {
      // Langsam aufsteigende, schwebende Glühpartikel (füllen den gesamten Rauch- und Strömungsraum)
      float emberSpeed = 0.045 + aSparkSeed.z * 0.065;
      life = fract(aSparkSeed.x + t * emberSpeed);

      float climb = pow(life, 0.92) * 5.2;
      float windDrift = pow(life, 1.18) * 1.45;

      // Spiralförmige Strömungsbahn passend zum Rauch
      float swirlAngle = aSparkSeed.w * 6.283185 + life * (3.5 + aSparkSeed.y * 2.5);
      float spreadRadius = (0.12 + pow(life, 0.85) * 1.85) * sqrt(aSparkSeed.z);

      pos = uFlarePos + vec3(
        cos(swirlAngle) * spreadRadius + uWind.x * windDrift * (0.65 + aSparkSeed.y * 0.45),
        0.10 + climb + sin(swirlAngle * 1.3) * 0.35,
        sin(swirlAngle) * spreadRadius * 0.8 + uWind.z * windDrift
      );
    } else {
      // Klassische schnelle Auswurf-Funken direkt am Fackelkern
      float speed = 0.45 + aSparkSeed.z * 0.50;
      float cycle = fract(aSparkSeed.x + t * speed);
      float activeWindow = 0.25 + aSparkSeed.w * 0.15;

      if (cycle >= activeWindow) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vFade = 0.0;
        return;
      }

      life = cycle / activeWindow;
      float spreadAngle = (aSparkSeed.y / 0.15 - 0.5) * 2.8;
      float ejectPower = 1.6 + aSparkSeed.z * 1.8;

      vec3 startPos = vec3(sin(spreadAngle) * 0.06, 0.25 + aSparkSeed.w * 0.12, (aSparkSeed.z - 0.5) * 0.06);
      vec3 velocity = vec3(
        sin(spreadAngle) * (0.9 + aSparkSeed.w * 1.3) + uWind.x * 0.35,
        cos(spreadAngle * 0.55) * ejectPower,
        (aSparkSeed.z - 0.5) * 0.8
      );

      float drag = 1.0 - life * 0.35;
      pos = uFlarePos + startPos + velocity * life * drag;
      pos.y -= 0.5 * 3.4 * life * life;
    }

    // Maus-Interaktion
    vec3 toMouse = pos - uMouse3D;
    float distSq = dot(toMouse, toMouse);
    float radiusSq = uInteractionRadius * uInteractionRadius;
    if (distSq < radiusSq) {
      float normDist = 1.0 - (sqrt(distSq) / uInteractionRadius);
      float pullFactor = pow(normDist, 1.3);
      pos = mix(pos, uMouse3D, pullFactor * 0.88);
    }

    // HDR-Farben für intensives Leuchten im Bloom-Pass
    vec3 hotWhite = vec3(3.2, 2.7, 2.3);
    vec3 brightAura = uAuraColor * 2.8 + vec3(0.5, 0.2, 0.3);
    vColor = mix(hotWhite, brightAura, smoothstep(0.05, 0.60, life));

    // Sanftes Funkeln (Twinkle)
    float twinkle = 0.60 + 0.40 * sin(t * (14.0 + aSparkSeed.w * 20.0) + aSparkSeed.x * 90.0);
    float fadeIn = smoothstep(0.0, 0.08, life);
    float fadeOut = pow(1.0 - life, 1.5);
    vFade = fadeIn * fadeOut * twinkle;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Bokeh-Größenvariation: Viele feine scharfe Punkte + einige größere leuchtende Orbs
    float sizeDistribution = mix(9.0, 34.0, pow(aSparkSeed.w, 3.0));
    float lifeScale = mix(1.0, 0.45, life);
    gl_PointSize = sizeDistribution * lifeScale * (1.0 / -mvPosition.z);
  }
`;

export const sparksFragmentShader = `
  varying vec3 vColor;
  varying float vFade;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    // Gestochen scharfer, heller Kern + weiche Korona
    float sharpPinpoint = exp(-distSq * 10.0);
    float softHalo = exp(-distSq * 2.4) * 0.45;
    float mask = clamp(sharpPinpoint + softHalo, 0.0, 1.0);

    gl_FragColor = vec4(vColor, mask * vFade);
  }
`;

export const rainVertexShader = `
  attribute vec4 aRainSeed;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform vec3 uWind;
  uniform vec3 uMouse3D;
  uniform float uInteractionRadius;
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

    vec3 toMouse = pos - uMouse3D;
    float distSqMouse = dot(toMouse, toMouse);
    float radiusSq = uInteractionRadius * uInteractionRadius;
    if (distSqMouse < radiusSq) {
      float pull = 1.0 - (sqrt(distSqMouse) / uInteractionRadius);
      pos = mix(pos, uMouse3D, pull * pull * 0.35);
    }

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
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float particleMask = exp(-distSq * 3.8);
    gl_FragColor = vec4(vColor, particleMask * vAlpha);
  }
`;