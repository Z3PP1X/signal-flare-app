import {
  Component,
  ElementRef,
  inject,
  NgZone,
  DestroyRef,
  viewChild,
  afterNextRender
} from '@angular/core';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  flowmapVertexShader,
  flowmapFragmentShader,
  flareCoreVertexShader,
  flareCoreFragmentShader,
  smokeVertexShader,
  smokeFragmentShader,
  sparksVertexShader,
  sparksFragmentShader,
  rainVertexShader,
  rainFragmentShader,
  clickDustVertexShader,
  clickDustFragmentShader
} from '../flare-shaders';

interface FlareConfig {
  position: THREE.Vector3;
  color: THREE.Color;
  timeOffset: number;
  smokeCount?: number;
  smokeLifetime?: number;
  smokeDensity?: number;
  smokeSpread?: number;
  sparkCount?: number;
}

@Component({
  selector: 'app-root',
  template: `
    <canvas #flareCanvas class="flare-canvas"></canvas>

    <div class="hero-overlay">
      <div class="hero-content">
        <h1 class="hero-title">Was tun?</h1>
        <p class="hero-subtitle">Der Bewegungskongress April 2027</p>
        <button class="hero-btn" (click)="onButtonClick()">Learn more</button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #03060c;
      position: relative;
    }

    .flare-canvas {
      width: 100%;
      height: 100%;
      display: block;
      position: absolute;
      inset: 0;
      z-index: 1;
    }

    .hero-overlay {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      padding: 2rem;
      user-select: none;
    }

    .hero-content {
      max-width: 820px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }

    .hero-title {
      margin: 0;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: clamp(2.5rem, 6vw, 4.8rem);
      font-weight: 500;
      line-height: 1.08;
      letter-spacing: -0.03em;
      text-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
    }

    .hero-subtitle {
      margin: 0;
      color: rgba(255, 255, 255, 0.72);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: clamp(1rem, 1.8vw, 1.25rem);
      font-weight: 400;
      line-height: 1.5;
      max-width: 580px;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    }

    .hero-btn {
      pointer-events: auto;
      margin-top: 0.5rem;
      padding: 0.75rem 1.75rem;
      background: rgba(255, 255, 255, 0.95);
      color: #03060c;
      border: none;
      border-radius: 9999px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;

      &:hover {
        background: #ffffff;
        transform: scale(1.04);
        box-shadow: 0 6px 24px rgba(255, 255, 255, 0.2);
      }

      &:active {
        transform: scale(0.98);
      }
    }
  `]
})
export class SignalFlareComponent {
  protected readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('flareCanvas');

  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  protected onButtonClick(): void {
    console.log('Learn more geklickt!');
  }

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;
  private readonly clock = new THREE.Clock();
  private animationFrameId: number | null = null;

  // --- NEU (ETAPPE 2): Ping-Pong Flowmap FBO Variablen ---
  private flowmapTargetA!: THREE.WebGLRenderTarget;
  private flowmapTargetB!: THREE.WebGLRenderTarget;
  private flowmapScene!: THREE.Scene;
  private flowmapCamera!: THREE.OrthographicCamera;
  private flowmapMaterial!: THREE.ShaderMaterial;

  private readonly mouseUv = new THREE.Vector2(0.5, 0.5);
  private readonly prevMouseUv = new THREE.Vector2(0.5, 0.5);
  private readonly mouseVelocity = new THREE.Vector2(0, 0);
  private pointerInitialized = false;

  private readonly flowmapUniforms = {
    uPrevFlowMap: { value: null as THREE.Texture | null },
    uMouseUv: { value: new THREE.Vector2(0.5, 0.5) },
    uMouseVelocity: { value: new THREE.Vector2(0, 0) },
    uAspect: { value: 1.0 },
    uBrushRadius: { value: 0.11 }, // Größe des Maus-Strömungsfeldes
    uDissipation: { value: 0.966 }, // Wie lange die Strömung nachwirkt (0.966 ~ 1.5 Sek.)
    uClickUv: { value: new THREE.Vector2(0.5, 0.5) },
    uClickImpulse: { value: 0.0 }
  };

  // Definition der Fackeln
  private readonly flare1Config: FlareConfig = {
    position: new THREE.Vector3(-4.5, -1.65, 0.0),
    color: new THREE.Color(0xff1e38),
    timeOffset: 4.0,
    smokeCount: 95,
    smokeLifetime: 1.25,
    smokeDensity: 1.35,
    smokeSpread: 1.55
  };

  private readonly flareBlackConfig: FlareConfig = {
    position: new THREE.Vector3(-4.0, -1.65, 0.0),
    color: new THREE.Color(0x000000),
    timeOffset: 0.0,
    smokeCount: 85,
    smokeLifetime: 1.1,
    smokeDensity: 1.2,
    smokeSpread: 1.2
  };

  private readonly flare2Config: FlareConfig = {
    position: new THREE.Vector3(3.2, -0.15, -0.35),
    color: new THREE.Color(0x7623b3),
    timeOffset: 37.5
  };

  // Globale Uniforms (inklusive uFlowMap für alle Shader)
  private readonly sharedUniforms = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x3b4d66) },
    uFlowMap: { value: null as THREE.Texture | null },
    uWind: { value: new THREE.Vector3(2.2, 0.0, 0.3) },
    uFlarePos1: { value: this.flare1Config.position },
    uAuraColor1: { value: this.flare1Config.color },
    uFlareBlack: { value: this.flareBlackConfig.position },
    uAuraColorBlack: { value: this.flareBlackConfig.color },
    uFlarePos2: { value: this.flare2Config.position },
    uAuraColor2: { value: this.flare2Config.color },
    uClickPos: { value: new THREE.Vector3(999, 999, 999) },
    uClickTime: { value: -100 }
  };

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  constructor() {
    afterNextRender(() => {
      this.initScene();
      this.initFlowmap();

      this.createFlare(this.flare1Config);
      this.createFlare(this.flareBlackConfig);
      this.createFlare(this.flare2Config);

      this.createRain(0);
      this.createClickDust(180);

      // ETAPPE 1 FIX: Nur noch EIN Render-Loop außerhalb von Angular!
      this.ngZone.runOutsideAngular(() => {
        window.addEventListener('pointermove', this.onPointerMove, { passive: true });
        window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
        window.addEventListener('resize', this.onWindowResize, { passive: true });
        this.animate();
      });

      this.destroyRef.onDestroy(() => {
        if (this.animationFrameId !== null) {
          cancelAnimationFrame(this.animationFrameId);
        }
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('resize', this.onWindowResize);

        this.scene?.traverse((obj) => {
          if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });

        this.flowmapTargetA?.dispose();
        this.flowmapTargetB?.dispose();
        this.flowmapMaterial?.dispose();
        this.composer?.dispose();
        this.renderer?.dispose();
      });
    });
  }

  private initScene(): void {
    const canvas = this.canvasRef().nativeElement;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03060c);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 1.8, 6.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(pixelRatio);

    const renderPass = new RenderPass(this.scene, this.camera);

    // ETAPPE 1 TUNING: Höherer Threshold (0.48) für knackige HD-Kontraste statt Matsch-Glow
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width * 0.5, height * 0.5),
      0.68, // Strength
      0.45, // Radius
      0.48  // Threshold
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bloomPass);
  }

  /**
   * ETAPPE 2: Initialisiert das 128x128 Ping-Pong RenderTarget für die Velocity Flowmap
   */
  private initFlowmap(): void {
    const fboOptions: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    };

    this.flowmapTargetA = new THREE.WebGLRenderTarget(128, 128, fboOptions);
    this.flowmapTargetB = new THREE.WebGLRenderTarget(128, 128, fboOptions);

    this.flowmapScene = new THREE.Scene();
    this.flowmapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.flowmapUniforms.uAspect.value = window.innerWidth / window.innerHeight;

    this.flowmapMaterial = new THREE.ShaderMaterial({
      vertexShader: flowmapVertexShader,
      fragmentShader: flowmapFragmentShader,
      uniforms: this.flowmapUniforms,
      depthTest: false,
      depthWrite: false
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flowmapMaterial);
    this.flowmapScene.add(quad);

    this.sharedUniforms.uFlowMap.value = this.flowmapTargetA.texture;
  }

  /**
   * ETAPPE 2: Berechnet pro Frame das neue Strömungs-Grid im Ping-Pong-Verfahren
   */
  private updateFlowmap(): void {
    // 1. Maus-Geschwindigkeit glätten
    const deltaX = this.mouseUv.x - this.prevMouseUv.x;
    const deltaY = this.mouseUv.y - this.prevMouseUv.y;
    this.prevMouseUv.copy(this.mouseUv);

    this.mouseVelocity.x = THREE.MathUtils.lerp(this.mouseVelocity.x, deltaX, 0.35);
    this.mouseVelocity.y = THREE.MathUtils.lerp(this.mouseVelocity.y, deltaY, 0.35);

    this.flowmapUniforms.uMouseUv.value.copy(this.mouseUv);
    this.flowmapUniforms.uMouseVelocity.value.copy(this.mouseVelocity);
    this.flowmapUniforms.uPrevFlowMap.value = this.flowmapTargetA.texture;

    // 2. In Target B rendern
    this.renderer.setRenderTarget(this.flowmapTargetB);
    this.renderer.render(this.flowmapScene, this.flowmapCamera);
    this.renderer.setRenderTarget(null);

    // 3. Ping-Pong Swap (B wird zu A)
    const temp = this.flowmapTargetA;
    this.flowmapTargetA = this.flowmapTargetB;
    this.flowmapTargetB = temp;

    // 4. Aktuelle Textur an alle Partikel-/Rauch-Shader übergeben
    this.sharedUniforms.uFlowMap.value = this.flowmapTargetA.texture;

    // 5. Klick-Schockwelle sanft ausklingen lassen
    this.flowmapUniforms.uClickImpulse.value *= 0.88;
  }

  private createFlare(config: FlareConfig): void {
    const flareUniforms = {
      ...this.sharedUniforms,
      uFlarePos: { value: config.position },
      uAuraColor: { value: config.color },
      uTimeOffset: { value: config.timeOffset },
      uSmokeLifetime: { value: config.smokeLifetime ?? 1.0 },
      uSmokeDensity: { value: config.smokeDensity ?? 1.0 },
      uSmokeSpread: { value: config.smokeSpread ?? 1.0 }
    };

    this.createRisingSmoke(config.smokeCount ?? 95, flareUniforms);
    this.createFlareCore(flareUniforms);
    this.createSparks(config.sparkCount ?? 14, flareUniforms);
  }

  private createFlareCore(flareUniforms: Record<string, THREE.IUniform>): void {
    const geometry = new THREE.PlaneGeometry(1.5, 1.9);
    const material = new THREE.ShaderMaterial({
      vertexShader: flareCoreVertexShader,
      fragmentShader: flareCoreFragmentShader,
      uniforms: flareUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const flareMesh = new THREE.Mesh(geometry, material);
    flareMesh.frustumCulled = false;
    flareMesh.renderOrder = 2;
    this.scene.add(flareMesh);
  }

  private createRisingSmoke(
    instanceCount: number,
    flareUniforms: Record<string, THREE.IUniform>
  ): void {
    const baseGeometry = new THREE.PlaneGeometry(1, 1);
    const instancedGeometry = new THREE.InstancedBufferGeometry();
    instancedGeometry.index = baseGeometry.index;
    instancedGeometry.attributes['position'] = baseGeometry.attributes['position'];
    instancedGeometry.attributes['uv'] = baseGeometry.attributes['uv'];

    const seeds = new Float32Array(instanceCount * 3);
    for (let i = 0; i < instanceCount; i++) {
      seeds[i * 3 + 0] = i / instanceCount;
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }

    instancedGeometry.setAttribute(
      'aSeed',
      new THREE.InstancedBufferAttribute(seeds, 3)
    );

    const smokeMaterial = new THREE.ShaderMaterial({
      vertexShader: smokeVertexShader,
      fragmentShader: smokeFragmentShader,
      uniforms: flareUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });

    const smokeMesh = new THREE.Mesh(instancedGeometry, smokeMaterial);
    smokeMesh.frustumCulled = false;
    smokeMesh.renderOrder = 1;
    this.scene.add(smokeMesh);
  }

  private createSparks(
    sparkCount: number,
    flareUniforms: Record<string, THREE.IUniform>
  ): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkCount * 3);
    const seeds = new Float32Array(sparkCount * 4);

    for (let i = 0; i < sparkCount; i++) {
      seeds[i * 4 + 0] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSparkSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      vertexShader: sparksVertexShader,
      fragmentShader: sparksFragmentShader,
      uniforms: flareUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const sparksPoints = new THREE.Points(geometry, material);
    sparksPoints.frustumCulled = false;
    sparksPoints.renderOrder = 3;
    this.scene.add(sparksPoints);
  }

  private createRain(dropCount: number): void {
    const baseGeometry = new THREE.PlaneGeometry(1, 1);
    const instancedGeometry = new THREE.InstancedBufferGeometry();
    instancedGeometry.index = baseGeometry.index;
    instancedGeometry.attributes['position'] = baseGeometry.attributes['position'];
    instancedGeometry.attributes['uv'] = baseGeometry.attributes['uv'];

    const seeds = new Float32Array(dropCount * 4);
    for (let i = 0; i < dropCount; i++) {
      seeds[i * 4 + 0] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }

    instancedGeometry.setAttribute(
      'aRainSeed',
      new THREE.InstancedBufferAttribute(seeds, 4)
    );

    const rainMaterial = new THREE.ShaderMaterial({
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
      uniforms: this.sharedUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const rainMesh = new THREE.Mesh(instancedGeometry, rainMaterial);
    rainMesh.frustumCulled = false;
    rainMesh.renderOrder = 4;
    this.scene.add(rainMesh);
  }

  private createClickDust(particleCount: number): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount * 4);

    for (let i = 0; i < particleCount; i++) {
      seeds[i * 4 + 0] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDustSeed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      vertexShader: clickDustVertexShader,
      fragmentShader: clickDustFragmentShader,
      uniforms: this.sharedUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    const dustPoints = new THREE.Points(geometry, material);
    dustPoints.frustumCulled = false;
    dustPoints.renderOrder = 5;
    this.scene.add(dustPoints);
  }

  private onPointerMove = (event: PointerEvent): void => {
    const uvX = event.clientX / window.innerWidth;
    const uvY = 1.0 - event.clientY / window.innerHeight;

    if (!this.pointerInitialized) {
      this.prevMouseUv.set(uvX, uvY);
      this.pointerInitialized = true;
    }

    this.mouseUv.set(uvX, uvY);
  };

  private onPointerDown = (event: PointerEvent): void => {
    const uvX = event.clientX / window.innerWidth;
    const uvY = 1.0 - event.clientY / window.innerHeight;

    // 1. Schockwelle in die Flowmap einspeisen
    this.flowmapUniforms.uClickUv.value.set(uvX, uvY);
    this.flowmapUniforms.uClickImpulse.value = 1.0;

    // 2. 3D-Weltposition für die funkelnde Staub-Explosion berechnen
    this.pointer.x = uvX * 2 - 1;
    this.pointer.y = uvY * 2 - 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.interactionPlane, this.sharedUniforms.uClickPos.value);

    this.sharedUniforms.uClickTime.value = this.clock.getElapsedTime();
  };

  private onWindowResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width * 0.5, height * 0.5);
    this.flowmapUniforms.uAspect.value = width / height;
  };

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.sharedUniforms.uTime.value = this.clock.getElapsedTime();

    // Zuerst das schnelle 128x128 Fluid-Grid aktualisieren, dann die Szene rendern
    this.updateFlowmap();
    this.composer.render();
  };
}