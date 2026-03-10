/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // --- World Generation Parameters ---
  const [seed, setSeed] = useState(Math.random() * 100);
  const [terrainScale, setTerrainScale] = useState(1.5);
  const [elevation, setElevation] = useState(1.0);
  const [waterLevel, setWaterLevel] = useState(0.45);

  // --- Climate & Biome Parameters ---
  const [temperature, setTemperature] = useState(0.0);
  const [moisture, setMoisture] = useState(0.0);
  const [cloudCover, setCloudCover] = useState(0.5);
  const [atmosphere, setAtmosphere] = useState(1.0);

  // --- View & Camera Parameters ---
  const [projection, setProjection] = useState<'globe' | 'map'>('globe');
  const [zoom, setZoom] = useState(2.0);
  const [speed, setSpeed] = useState(0.2);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0.2);
  const [isPaused, setIsPaused] = useState(false);

  // --- UI State ---
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'presets' | 'world' | 'climate' | 'view'>('presets');
  const [audioStarted, setAudioStarted] = useState(false);

  const startAudio = () => {
    if (audioStarted) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    // Ambient space drone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(50, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    // Wind/atmosphere noise
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(300, ctx.currentTime);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.05, ctx.currentTime);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start();

    setAudioStarted(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) return;

    const vsSource = `
      attribute vec4 aVertexPosition;
      void main() { gl_Position = aVertexPosition; }
    `;

    const fsSource = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_rotation;
      
      // World Params
      uniform float u_seed;
      uniform float u_terrainScale;
      uniform float u_elevation;
      uniform float u_waterLevel;
      
      // Climate Params
      uniform float u_temperature;
      uniform float u_moisture;
      uniform float u_cloudCover;
      uniform float u_atmosphere;
      
      // View Params
      uniform float u_speed;
      uniform float u_zoom;
      uniform float u_projection; // 0.0 = globe, 1.0 = map

      // --- UTILS ---
      mat2 rot(float a) {
        float s = sin(a), c = cos(a);
        return mat2(c, -s, s, c);
      }

      float hash(vec3 p) {
        p = fract(p * vec3(123.34, 456.21, 789.18));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                       mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                       mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100);
        for (int i = 0; i < 6; ++i) {
          v += a * noise(p);
          p = p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      // --- PLANET ---
      vec2 sphIntersect(vec3 ro, vec3 rd, vec3 ce, float ra) {
        vec3 oc = ro - ce;
        float b = dot(oc, rd);
        float c = dot(oc, oc) - ra * ra;
        float h = b * b - c;
        if (h < 0.0) return vec2(-1.0);
        h = sqrt(h);
        return vec2(-b - h, -b + h);
      }

      // --- PROCEDURAL TEXTURES ---
      float crackedEarth(vec3 p) {
        float n1 = fbm(p * 15.0);
        float n2 = fbm(p * 25.0 + vec3(10.0));
        return smoothstep(0.4, 0.5, abs(n1 - n2));
      }

      float canopyTexture(vec3 p) {
        float n = fbm(p * 30.0);
        return smoothstep(0.3, 0.7, n) * 0.5 + 0.5;
      }

      float rockTexture(vec3 p) {
        vec3 pStretched = vec3(p.x * 5.0, p.y * 20.0, p.z * 5.0);
        float n = fbm(pStretched);
        return n;
      }

      float duneTexture(vec3 p) {
        float n = sin(p.x * 40.0 + fbm(p * 10.0) * 5.0) * 0.5 + 0.5;
        return n;
      }

      float iceTexture(vec3 p) {
        float n = fbm(p * 50.0);
        return pow(n, 3.0);
      }

      vec3 getTerrainColor(float h, vec3 p, out float roughness) {
        vec3 waterDeep = vec3(0.02, 0.1, 0.3);
        vec3 waterShallow = vec3(0.05, 0.3, 0.5);
        vec3 sand = vec3(0.8, 0.7, 0.5);
        vec3 grass = vec3(0.2, 0.4, 0.15);
        vec3 forest = vec3(0.05, 0.25, 0.1);
        vec3 jungle = vec3(0.02, 0.15, 0.05);
        vec3 desert = vec3(0.8, 0.5, 0.3);
        vec3 scorched = vec3(0.4, 0.2, 0.1);
        vec3 rock = vec3(0.35, 0.35, 0.35);
        vec3 darkRock = vec3(0.15, 0.15, 0.15);
        vec3 snow = vec3(0.95, 0.95, 0.95);
        vec3 ice = vec3(0.6, 0.8, 0.9);

        roughness = 0.8;

        if (h < u_waterLevel) {
          vec3 wCol = mix(waterDeep, waterShallow, h / u_waterLevel);
          float freeze = smoothstep(-0.2, -0.6, u_temperature);
          
          if (freeze > 0.0) {
            float iceTex = iceTexture(p);
            vec3 iceCol = mix(ice, snow, iceTex);
            roughness = mix(0.1, 0.5, freeze);
            return mix(wCol, iceCol, freeze);
          }
          
          roughness = 0.05;
          return wCol;
        }
        
        float l = clamp((h - u_waterLevel) / (1.0 - u_waterLevel), 0.0, 1.0);
        
        float latTemp = 1.0 - abs(p.y);
        float temp = u_temperature + latTemp * 0.5 - l * 0.8;
        float moist = u_moisture + (1.0 - abs(p.y)) * 0.3 + l * 0.2;
        
        vec3 color = grass;
        
        if (temp < -0.3) {
          float iceTex = iceTexture(p);
          color = mix(rock, mix(ice, snow, iceTex), smoothstep(-0.3, -0.6, temp));
          roughness = 0.6;
        } else if (temp > 0.4) {
          if (moist < -0.2) {
            float crack = crackedEarth(p);
            color = mix(desert, scorched, crack);
            roughness = 0.9;
          } else if (moist > 0.4) {
            float canopy = canopyTexture(p);
            color = mix(forest, jungle, canopy);
            roughness = 0.95;
          } else {
            float dune = duneTexture(p);
            color = mix(sand, grass, smoothstep(-0.2, 0.4, moist) * dune);
            roughness = 0.85;
          }
        } else {
          if (moist < -0.3) {
            float rockTex = rockTexture(p);
            color = mix(grass, mix(rock, darkRock, rockTex), smoothstep(-0.3, -0.6, moist));
            roughness = 0.8;
          } else if (moist > 0.3) {
            float canopy = canopyTexture(p * 0.5);
            color = mix(grass, forest, canopy);
            roughness = 0.9;
          } else {
            color = grass;
            roughness = 0.7;
          }
        }
        
        if (l > 0.6) {
          float rockTex = rockTexture(p);
          vec3 mountainCol = mix(rock, darkRock, rockTex);
          color = mix(color, mountainCol, smoothstep(0.6, 0.75, l));
          roughness = 0.85;
        }
        if (l > 0.8) {
          float iceTex = iceTexture(p);
          vec3 peakCol = mix(snow, ice, iceTex * 0.5);
          color = mix(color, peakCol, smoothstep(0.8, 0.9, l));
          roughness = 0.7;
        }
        
        if (l < 0.05 && temp > -0.3) {
          float dune = duneTexture(p * 2.0);
          color = mix(mix(sand, vec3(0.9, 0.8, 0.6), dune), color, smoothstep(0.0, 0.05, l));
          roughness = 0.75;
        }
        
        return color;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
        vec3 lightDir = normalize(vec3(1.0, 0.5, 1.0));
        vec3 col = vec3(0.0);

        if (u_projection > 0.5) {
          // --- 2D MAP PROJECTION (Equirectangular) ---
          vec2 mapUV = gl_FragCoord.xy / u_resolution.xy;
          
          // Apply zoom and pan
          mapUV = (mapUV - 0.5) / (u_zoom * 0.5) + 0.5;
          
          float lon = (mapUV.x - 0.5) * 6.28318530718; // -PI to PI
          float lat = (mapUV.y - 0.5) * 3.14159265359; // -PI/2 to PI/2
          
          // Apply rotation/panning
          lon -= u_rotation.x + u_time * u_speed * 0.5;
          lat += u_rotation.y;
          
          // Clamp latitude to prevent wrapping over the poles
          if (lat > 1.57079632 || lat < -1.57079632) {
            gl_FragColor = vec4(0.02, 0.02, 0.02, 1.0); // Dark background outside map
            return;
          }
          
          // Convert to 3D sphere coordinate for noise sampling
          vec3 p = vec3(cos(lat)*sin(lon), sin(lat), cos(lat)*cos(lon));
          vec3 pSample = p + vec3(u_seed, u_seed * 1.3, -u_seed * 0.8);
          
          float h = fbm(pSample * u_terrainScale) * u_elevation;
          float roughness;
          vec3 albedo = getTerrainColor(h, pSample, roughness);
          
          // Normal mapping
          vec2 e = vec2(0.005, 0.0);
          float hx = fbm(normalize(pSample + e.xyy) * u_terrainScale) * u_elevation;
          float hy = fbm(normalize(pSample + e.yxy) * u_terrainScale) * u_elevation;
          float hz = fbm(normalize(pSample + e.yyx) * u_terrainScale) * u_elevation;
          vec3 bump = normalize(vec3(hx - h, hy - h, hz - h));
          
          vec3 n = normalize(p);
          vec3 tn = normalize(n - bump * roughness);
          
          float diff = max(dot(tn, lightDir), 0.0);
          float amb = 0.2; // Higher ambient for map view
          
          col = albedo * (diff + amb);
          
          // Clouds
          vec3 cSample = p * 1.02 + vec3(u_seed) + u_time * 0.05;
          float c = fbm(cSample);
          float cDetail = fbm(cSample * 5.0);
          c = mix(c, cDetail, 0.3);
          float cloudAlpha = smoothstep(1.0 - u_cloudCover, 1.0, c);
          col = mix(col, vec3(1.0), cloudAlpha * 0.9);
          
          col = pow(col, vec3(0.4545));
          gl_FragColor = vec4(col, 1.0);
          return;
        }

        // --- 3D GLOBE PROJECTION ---
        vec3 ro = vec3(0.0, 0.0, u_zoom);
        vec3 rd = normalize(vec3(uv, -1.0));
        
        float pitch = u_rotation.y;
        float yaw = u_rotation.x;
        ro.yz *= rot(pitch);
        rd.yz *= rot(pitch);
        ro.xz *= rot(yaw);
        rd.xz *= rot(yaw);

        // Starfield
        float stars = pow(hash(vec3(rd.xy * 100.0, 1.0)), 100.0) * 2.0;
        col += vec3(stars);

        vec2 t = sphIntersect(ro, rd, vec3(0.0), 1.0);
        
        if (t.x > 0.0) {
          vec3 p = ro + rd * t.x;
          vec3 n = normalize(p);
          
          vec3 pRot = p;
          pRot.xz *= rot(u_time * u_speed * 0.5);
          
          vec3 pSample = pRot + vec3(u_seed, u_seed * 1.3, -u_seed * 0.8);
          
          float h = fbm(pSample * u_terrainScale) * u_elevation;
          
          float roughness;
          vec3 albedo = getTerrainColor(h, pSample, roughness);
          
          vec2 e = vec2(0.005, 0.0);
          float hx = fbm(normalize(pSample + e.xyy) * u_terrainScale) * u_elevation;
          float hy = fbm(normalize(pSample + e.yxy) * u_terrainScale) * u_elevation;
          float hz = fbm(normalize(pSample + e.yyx) * u_terrainScale) * u_elevation;
          vec3 bump = normalize(vec3(hx - h, hy - h, hz - h));
          
          vec3 tn = normalize(n - bump * roughness);
          
          float diff = max(dot(tn, lightDir), 0.0);
          float amb = 0.05;
          
          float spec = 0.0;
          if (roughness < 0.5) {
            vec3 ref = reflect(rd, tn);
            float specPower = mix(64.0, 8.0, roughness * 2.0);
            spec = pow(max(dot(ref, lightDir), 0.0), specPower) * (1.0 - roughness);
          }
          
          col = albedo * (diff + amb) + spec;
          
          vec2 tc = sphIntersect(ro, rd, vec3(0.0), 1.02);
          if (tc.x > 0.0) {
            vec3 pc = ro + rd * tc.x;
            vec3 pcRot = pc;
            pcRot.xz *= rot(u_time * u_speed * 0.7);
            
            vec3 cSample = pcRot * 2.0 + vec3(u_seed) + u_time * 0.05;
            float c = fbm(cSample);
            float cDetail = fbm(cSample * 5.0);
            c = mix(c, cDetail, 0.3);
            
            float cloudAlpha = smoothstep(1.0 - u_cloudCover, 1.0, c);
            float cloudDiff = max(dot(normalize(pc), lightDir), 0.0);
            vec3 cloudCol = vec3(1.0) * (cloudDiff + 0.2);
            col = mix(col, cloudCol, cloudAlpha * 0.9);
            
            float shadow = smoothstep(1.0 - u_cloudCover, 1.0, fbm(pRot * 2.0 + vec3(u_seed) + u_time * 0.05));
            col *= (1.0 - shadow * 0.5);
          }
          
          float atmo = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
          vec3 atmoColor = mix(vec3(0.3, 0.6, 1.0), vec3(0.8, 0.4, 0.2), smoothstep(0.5, 1.0, u_temperature));
          col += atmoColor * atmo * u_atmosphere * diff;
        } else {
          vec2 ta = sphIntersect(ro, rd, vec3(0.0), 1.2);
          if (ta.x > 0.0 || ta.y > 0.0) {
            float dist = length(cross(ro, rd));
            float glow = smoothstep(1.2, 1.0, dist);
            vec3 atmoColor = mix(vec3(0.1, 0.3, 0.6), vec3(0.5, 0.2, 0.1), smoothstep(0.5, 1.0, u_temperature));
            col += atmoColor * glow * u_atmosphere;
          }
        }

        col = pow(col, vec3(0.4545));
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function createShader(gl: WebGLRenderingContext, type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, 'aVertexPosition');
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      res: gl.getUniformLocation(program, 'u_resolution'),
      rotation: gl.getUniformLocation(program, 'u_rotation'),
      
      seed: gl.getUniformLocation(program, 'u_seed'),
      terrainScale: gl.getUniformLocation(program, 'u_terrainScale'),
      elevation: gl.getUniformLocation(program, 'u_elevation'),
      waterLevel: gl.getUniformLocation(program, 'u_waterLevel'),
      
      temperature: gl.getUniformLocation(program, 'u_temperature'),
      moisture: gl.getUniformLocation(program, 'u_moisture'),
      cloudCover: gl.getUniformLocation(program, 'u_cloudCover'),
      atmosphere: gl.getUniformLocation(program, 'u_atmosphere'),
      
      speed: gl.getUniformLocation(program, 'u_speed'),
      zoom: gl.getUniformLocation(program, 'u_zoom'),
      projection: gl.getUniformLocation(program, 'u_projection'),
    };

    let isDragging = false;
    let lastMouseX = 0, lastMouseY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      
      const newYaw = ((window as any)._shaderYaw || 0) - dx * 0.01;
      const newPitch = ((window as any)._shaderPitch || 0) - dy * 0.01;
      
      // Allow full pitch rotation in map mode, clamp in globe mode
      const isMap = (window as any)._shaderProjection > 0.5;
      const clampedPitch = isMap ? newPitch : Math.max(-Math.PI / 2, Math.min(Math.PI / 2, newPitch));
      
      (window as any)._shaderYaw = newYaw;
      (window as any)._shaderPitch = clampedPitch;
      
      setYaw(newYaw);
      setPitch(clampedPitch);
      
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };

    const handleMouseUp = () => isDragging = false;

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener('resize', resize);
    resize();

    let animationFrameId: number;
    let lastTime = 0;

    const render = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      gl.uniform1f(uniforms.time, time * 0.001);
      gl.uniform2f(uniforms.res, canvas.width, canvas.height);
      
      if (!(window as any)._shaderPaused) {
        const currentYaw = (window as any)._shaderYaw || 0;
        const currentSpeed = (window as any)._shaderSpeed || 0.2;
        const newYaw = currentYaw + 0.0005 * currentSpeed * deltaTime;
        (window as any)._shaderYaw = newYaw;
        setYaw(newYaw);
      }

      gl.uniform2f(uniforms.rotation, (window as any)._shaderYaw || 0, (window as any)._shaderPitch || 0);
      
      const getVal = (key: string, fallback: number) => {
        const val = (window as any)[key];
        return typeof val === 'number' ? val : fallback;
      };

      // World
      gl.uniform1f(uniforms.seed, getVal('_shaderSeed', 0.0));
      gl.uniform1f(uniforms.terrainScale, getVal('_shaderTerrainScale', 1.5));
      gl.uniform1f(uniforms.elevation, getVal('_shaderElevation', 1.0));
      gl.uniform1f(uniforms.waterLevel, getVal('_shaderWaterLevel', 0.45));
      
      // Climate
      gl.uniform1f(uniforms.temperature, getVal('_shaderTemperature', 0.0));
      gl.uniform1f(uniforms.moisture, getVal('_shaderMoisture', 0.0));
      gl.uniform1f(uniforms.cloudCover, getVal('_shaderCloudCover', 0.5));
      gl.uniform1f(uniforms.atmosphere, getVal('_shaderAtmosphere', 1.0));
      
      // View
      gl.uniform1f(uniforms.speed, getVal('_shaderSpeed', 0.2));
      gl.uniform1f(uniforms.zoom, getVal('_shaderZoom', 2.0));
      gl.uniform1f(uniforms.projection, getVal('_shaderProjection', 0.0));

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const applyPreset = (preset: any) => {
    const s = preset.settings;
    if (s.seed !== undefined) setSeed(s.seed);
    if (s.terrainScale !== undefined) setTerrainScale(s.terrainScale);
    if (s.elevation !== undefined) setElevation(s.elevation);
    if (s.waterLevel !== undefined) setWaterLevel(s.waterLevel);
    
    if (s.temperature !== undefined) setTemperature(s.temperature);
    if (s.moisture !== undefined) setMoisture(s.moisture);
    if (s.cloudCover !== undefined) setCloudCover(s.cloudCover);
    if (s.atmosphere !== undefined) setAtmosphere(s.atmosphere);
    
    if (s.speed !== undefined) setSpeed(s.speed);
    if (s.zoom !== undefined) setZoom(s.zoom);
    if (s.yaw !== undefined) setYaw(s.yaw);
    if (s.pitch !== undefined) setPitch(s.pitch);
    if (s.isPaused !== undefined) setIsPaused(s.isPaused);
    if (s.projection !== undefined) setProjection(s.projection);
    
    setIsCollapsed(true);
  };

  const presets = [
    {
      id: 'earth-like',
      name: 'Earth-like',
      settings: { seed: Math.random() * 100, terrainScale: 1.5, elevation: 1.0, waterLevel: 0.45, temperature: 0.0, moisture: 0.0, cloudCover: 0.5, atmosphere: 1.0, speed: 0.2, zoom: 2.0, yaw: 0, pitch: 0.2, isPaused: false, projection: 'globe' }
    },
    {
      id: 'ocean',
      name: 'Ocean World',
      settings: { seed: Math.random() * 100, terrainScale: 1.0, elevation: 0.5, waterLevel: 0.85, temperature: 0.2, moisture: 0.5, cloudCover: 0.7, atmosphere: 1.5, speed: 0.1, zoom: 1.8, yaw: 1.5, pitch: -0.1, isPaused: false, projection: 'globe' }
    },
    {
      id: 'desert',
      name: 'Scorched Desert',
      settings: { seed: Math.random() * 100, terrainScale: 2.5, elevation: 1.2, waterLevel: 0.05, temperature: 0.8, moisture: -0.8, cloudCover: 0.1, atmosphere: 0.5, speed: 0.3, zoom: 2.2, yaw: 3.14, pitch: 0.5, isPaused: false, projection: 'globe' }
    },
    {
      id: 'ice',
      name: 'Frozen Wasteland',
      settings: { seed: Math.random() * 100, terrainScale: 3.0, elevation: 1.5, waterLevel: 0.6, temperature: -0.9, moisture: 0.2, cloudCover: 0.8, atmosphere: 1.2, speed: 0.05, zoom: 1.9, yaw: -1.0, pitch: 0.8, isPaused: false, projection: 'globe' }
    },
    {
      id: 'jungle',
      name: 'Primordial Jungle',
      settings: { seed: Math.random() * 100, terrainScale: 1.2, elevation: 0.8, waterLevel: 0.3, temperature: 0.6, moisture: 0.9, cloudCover: 0.6, atmosphere: 1.8, speed: 0.15, zoom: 2.1, yaw: 0, pitch: 0, isPaused: false, projection: 'globe' }
    },
    {
      id: 'map-view',
      name: 'Cartographer (Map View)',
      settings: { seed: Math.random() * 100, terrainScale: 1.5, elevation: 1.0, waterLevel: 0.45, temperature: 0.0, moisture: 0.0, cloudCover: 0.5, atmosphere: 1.0, speed: 0.2, zoom: 1.0, yaw: 0, pitch: 0, isPaused: false, projection: 'map' }
    }
  ];

  const exportImage = () => {
    if (!canvasRef.current) return;
    const dataURL = canvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `procedural-world-${projection}-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  };

  useEffect(() => {
    (window as any)._shaderSeed = seed;
    (window as any)._shaderTerrainScale = terrainScale;
    (window as any)._shaderElevation = elevation;
    (window as any)._shaderWaterLevel = waterLevel;
    
    (window as any)._shaderTemperature = temperature;
    (window as any)._shaderMoisture = moisture;
    (window as any)._shaderCloudCover = cloudCover;
    (window as any)._shaderAtmosphere = atmosphere;
    
    (window as any)._shaderSpeed = speed;
    (window as any)._shaderZoom = zoom;
    (window as any)._shaderYaw = yaw;
    (window as any)._shaderPitch = pitch;
    (window as any)._shaderPaused = isPaused;
    (window as any)._shaderProjection = projection === 'map' ? 1.0 : 0.0;
  }, [seed, terrainScale, elevation, waterLevel, temperature, moisture, cloudCover, atmosphere, speed, zoom, yaw, pitch, isPaused, projection]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block cursor-move" />
      
      <AnimatePresence>
        {!audioStarted && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.1 }}
            className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xl bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-500/10 rounded-full blur-[100px]" />
              <div className="relative space-y-8">
                <div>
                  <h2 className="text-white font-mono text-2xl tracking-[0.2em] uppercase mb-2">Procedural World Generator</h2>
                  <div className="h-px w-16 bg-blue-500" />
                </div>
                <p className="text-white/60 font-mono text-sm leading-relaxed">
                  Generate infinite procedural planets in real-time. Shape the terrain, control the climate, and explore new worlds.
                </p>
                <button 
                  onClick={startAudio}
                  className="w-full py-4 bg-white text-black font-mono text-sm uppercase tracking-widest rounded-xl hover:bg-blue-400 transition-colors"
                >
                  Initialize Generator
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`fixed z-50 ${isCollapsed ? 'top-6 right-6' : 'inset-0 md:top-6 md:right-6 md:inset-auto'}`}>
        <AnimatePresence>
          {audioStarted && (
            <motion.div
              initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
              className="w-full h-full flex flex-col items-end justify-start"
            >
              {isCollapsed ? (
                <motion.button 
                  layoutId="panel" onClick={() => setIsCollapsed(false)}
                  className="w-12 h-12 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 transition-all"
                >
                  <div className="w-2 h-2 rounded-full bg-white/60" />
                </motion.button>
              ) : (
                <motion.div 
                  layoutId="panel"
                  className="w-full h-full md:w-[340px] md:h-auto bg-black/60 backdrop-blur-xl md:border border-white/10 md:rounded-2xl overflow-hidden flex flex-col"
                >
                  <div className="border-b border-white/10 p-4 flex justify-between items-center bg-black/20">
                    <h2 className="text-white/80 font-mono text-xs uppercase tracking-widest">Generator Controls</h2>
                    <button onClick={() => setIsCollapsed(true)} className="text-white/40 hover:text-white">[-]</button>
                  </div>
                  
                  <div className="flex border-b border-white/10 overflow-x-auto no-scrollbar bg-black/20">
                    {[
                      { id: 'presets', label: 'Presets' },
                      { id: 'world', label: 'World' },
                      { id: 'climate', label: 'Climate' },
                      { id: 'view', label: 'View' }
                    ].map(tab => (
                      <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`flex-1 py-3 px-2 text-[9px] font-mono uppercase tracking-widest whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-white/10 text-white border-b border-white' : 'text-white/40 hover:bg-white/5 border-b border-transparent'}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
                    {activeTab === 'presets' && (
                      <div className="space-y-3">
                        {presets.map(p => (
                          <button 
                            key={p.id} onClick={() => applyPreset(p)}
                            className="w-full p-4 border border-white/10 rounded-xl bg-white/5 hover:bg-white/10 text-left transition-colors"
                          >
                            <span className="text-white font-mono text-xs uppercase tracking-wider">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {activeTab === 'world' && (
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-[10px] font-mono uppercase">
                            <span className="text-white/40">Seed Offset</span>
                            <button 
                              onClick={() => setSeed(Math.random() * 100)}
                              className="text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded"
                            >
                              Randomize
                            </button>
                          </div>
                          <input 
                            type="range" min="0" max="100" step="0.1" value={seed}
                            onChange={(e) => setSeed(parseFloat(e.target.value))}
                            className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                          />
                        </div>
                        {[
                          { label: 'Terrain Scale', val: terrainScale, set: setTerrainScale, min: 0.1, max: 5 },
                          { label: 'Elevation Multiplier', val: elevation, set: setElevation, min: 0.1, max: 3 },
                          { label: 'Water Level', val: waterLevel, set: setWaterLevel, min: 0, max: 1 }
                        ].map(ctrl => (
                          <div key={ctrl.label} className="space-y-2">
                            <div className="flex justify-between text-[10px] font-mono uppercase">
                              <span className="text-white/40">{ctrl.label}</span>
                              <span className="text-white/80">{ctrl.val.toFixed(2)}</span>
                            </div>
                            <input 
                              type="range" min={ctrl.min} max={ctrl.max} step="0.01" value={ctrl.val}
                              onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                              className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'climate' && (
                      <div className="space-y-5">
                        {[
                          { label: 'Temperature', val: temperature, set: setTemperature, min: -1, max: 1 },
                          { label: 'Moisture', val: moisture, set: setMoisture, min: -1, max: 1 },
                          { label: 'Cloud Cover', val: cloudCover, set: setCloudCover, min: 0, max: 1 },
                          { label: 'Atmosphere Density', val: atmosphere, set: setAtmosphere, min: 0, max: 3 }
                        ].map(ctrl => (
                          <div key={ctrl.label} className="space-y-2">
                            <div className="flex justify-between text-[10px] font-mono uppercase">
                              <span className="text-white/40">{ctrl.label}</span>
                              <span className="text-white/80">{ctrl.val.toFixed(2)}</span>
                            </div>
                            <input 
                              type="range" min={ctrl.min} max={ctrl.max} step="0.01" value={ctrl.val}
                              onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                              className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'view' && (
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase text-white/40">Projection</span>
                          <div className="flex bg-white/5 rounded-full p-1">
                            <button 
                              onClick={() => setProjection('globe')}
                              className={`px-3 py-1 rounded-full font-mono text-[9px] uppercase transition-colors ${projection === 'globe' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white'}`}
                            >
                              Globe
                            </button>
                            <button 
                              onClick={() => setProjection('map')}
                              className={`px-3 py-1 rounded-full font-mono text-[9px] uppercase transition-colors ${projection === 'map' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white'}`}
                            >
                              Map
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase text-white/40">Auto-Rotation</span>
                          <button 
                            onClick={() => setIsPaused(!isPaused)}
                            className={`px-3 py-1 rounded-full font-mono text-[9px] uppercase ${isPaused ? 'bg-white/10 text-white/40' : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'}`}
                          >
                            {isPaused ? 'Paused' : 'Active'}
                          </button>
                        </div>
                        {[
                          { label: 'Rotation Speed', val: speed, set: setSpeed, min: 0, max: 2 },
                          { label: 'Camera Zoom', val: zoom, set: setZoom, min: 0.5, max: 5 }
                        ].map(ctrl => (
                          <div key={ctrl.label} className="space-y-2">
                            <div className="flex justify-between text-[10px] font-mono uppercase">
                              <span className="text-white/40">{ctrl.label}</span>
                              <span className="text-white/80">{ctrl.val.toFixed(2)}</span>
                            </div>
                            <input 
                              type="range" min={ctrl.min} max={ctrl.max} step="0.01" value={ctrl.val}
                              onChange={(e) => ctrl.set(parseFloat(e.target.value))}
                              className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                            />
                          </div>
                        ))}

                        <div className="pt-4 border-t border-white/10 mt-4">
                          <button
                            onClick={exportImage}
                            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-mono text-[10px] uppercase tracking-widest rounded-xl transition-colors flex items-center justify-center gap-2"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            Export Image
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
