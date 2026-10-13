export const smokeFragmentShader = `
  uniform float uTime;
  uniform float uTimeOffset;
  uniform vec3 uAuraColor;
  uniform vec3 uFogColor;

  varying vec2 vUv;
  varying vec2 vSeed;
  varying float vHeatFactor;
  varying float vAlphaMultiplier;
  varying float vLife;

  // Schneller, hochfrequenter Hash für feinste 1-Pixel-Partikelstruktur
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  // Weiches Value-Noise für die organische Rauch-Grundform
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

  // 2-Oktaven-Wolkenstruktur (schnell & bricht die runde Billboard-Form auf)
  float smokeShape(vec2 p) {
    float v = 0.65 * softNoise(p);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1;
    v += 0.35 * softNoise(p);
    return v;
  }

  // Ultrafeiner, pudriger Mikro-Staub (keine groben Kreise, kein Verschwinden)
  float finePowderGrain(vec2 uv, float scale, float t) {
    vec2 p = uv * scale;
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    // Jede Mikro-Zelle pulsiert sanft zeitversetzt
    float a = sin(hash12(i) * 6.2831 + t) * 0.5 + 0.5;
    float b = sin(hash12(i + vec2(1.0, 0.0)) * 6.2831 + t) * 0.5 + 0.5;
    float c = sin(hash12(i + vec2(0.0, 1.0)) * 6.2831 + t) * 0.5 + 0.5;
    float d = sin(hash12(i + vec2(1.0, 1.0)) * 6.2831 + t) * 0.5 + 0.5;

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float distSq = dot(centered, centered) * 4.0;
    if (distSq > 1.0) discard;

    float t = uTime + uTimeOffset;

    // 1. Extrem weicher Randabfall (verhindert die runden "Blasen"-Ränder aus Bild 1)
    float oneMinusDistSq = 1.0 - distSq;
    float radialMask = pow(oneMinusDistSq, 2.2);

    // 2. Organische Rauchwolken-Dichte als Basis
    vec2 flowUv = vUv * 2.4 + vSeed * 13.0 + vec2(0.0, -t * 0.10);
    float cloudNoise = smokeShape(flowUv);
    float baseSmoke = smoothstep(0.18, 0.78, cloudNoise * radialMask * 1.45);

    // 3. Pudrige Mikro-Partikel-Struktur (2 extrem feine Schichten + Sub-Pixel-Dither)
    vec2 drift1 = vec2(t * 0.02, -t * 0.09);
    vec2 drift2 = vec2(-t * 0.03, -t * 0.14);

    // Hohe Frequenz (95 und 160), aber weich interpoliert -> winzige 1-Pixel-Staubkörner ohne Flackern!
    float grain1 = finePowderGrain(vUv + drift1 + vSeed * 7.1, 95.0, t * 2.2);
    float grain2 = finePowderGrain(vUv + drift2 + vSeed * 19.3, 160.0, t * 3.1);

    // Schärft das feine Korn leicht an, damit es wie dichter Partikelstaub wirkt
    float microDust = smoothstep(0.35, 0.85, grain1 * 0.55 + grain2 * 0.45);

    // Screen-Space Dither (1-Pixel-Feinheit wie im DeepMind-Video)
    float pixelDither = hash12(gl_FragCoord.xy + fract(t) * 100.0);

    // 4. WICHTIG: Partikel-Struktur moduliert den Rauch direkt (statt grobe Punkte im Leeren)
    // Am Rand der Rauchwolke löst sich der Nebel in feinen, pudrigen Staub auf
    float dustySmoke = baseSmoke * mix(0.62, 1.28, microDust) * mix(0.88, 1.12, pixelDither);

    // 5. Dezente, winzige Einzel-Staubkörnchen (nur ganz wenige, sehr fein und weich eingebettet)
    float sparseSpecs = pow(grain1 * grain2, 3.8) * radialMask * smoothstep(0.05, 0.5, cloudNoise);

    // 6. Farbgebung: Sanfter Übergang von Fackel-Glut zu dunklem Kosmos-Rauch
    float internalScatter = vHeatFactor * smoothstep(0.2, 0.75, cloudNoise) * 1.1;
    vec3 darkSmoke = mix(vec3(0.05, 0.05, 0.08), uFogColor * 0.48, cloudNoise);
    vec3 litSmoke = uAuraColor * mix(0.85, 1.40, cloudNoise * vHeatFactor);
    vec3 baseColor = mix(darkSmoke, litSmoke, clamp(vHeatFactor * 0.85 + internalScatter, 0.0, 1.0));

    // Die feinen Körnchen schimmern nur ganz dezent heller als der Rauch selbst (kein harter Glitzer)
    vec3 specHighlight = mix(uFogColor * 1.1, uAuraColor * 1.35, vHeatFactor) * sparseSpecs * 0.45;
    vec3 finalColor = baseColor + specHighlight;

    float alpha = clamp(dustySmoke + sparseSpecs * 0.25, 0.0, 1.0) * vAlphaMultiplier;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;