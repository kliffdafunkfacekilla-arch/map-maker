/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// --- JS Math Utils for Raycasting & Biome Sampling ---
function fract(x: number) { return x - Math.floor(x); }

function hash(x: number, y: number, z: number) {
  let px = x * 123.34; px = px - Math.floor(px);
  let py = y * 456.21; py = py - Math.floor(py);
  let pz = z * 789.18; pz = pz - Math.floor(pz);
  
  let dotVal = px * (py + 19.19) + py * (pz + 19.19) + pz * (px + 19.19);
  px += dotVal;
  py += dotVal;
  pz += dotVal;
  
  let res = (px + py) * pz;
  return res - Math.floor(res);
}

function mix(x: number, y: number, a: number) {
  return x * (1 - a) + y * a;
}

function noise(x: number, y: number, z: number) {
  let ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  
  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uy = fy * fy * (3.0 - 2.0 * fy);
  let uz = fz * fz * (3.0 - 2.0 * fz);
  
  let n000 = hash(ix, iy, iz);
  let n100 = hash(ix + 1, iy, iz);
  let n010 = hash(ix, iy + 1, iz);
  let n110 = hash(ix + 1, iy + 1, iz);
  let n001 = hash(ix, iy, iz + 1);
  let n101 = hash(ix + 1, iy, iz + 1);
  let n011 = hash(ix, iy + 1, iz + 1);
  let n111 = hash(ix + 1, iy + 1, iz + 1);
  
  return mix(
    mix(mix(n000, n100, ux), mix(n010, n110, ux), uy),
    mix(mix(n001, n101, ux), mix(n011, n111, ux), uy),
    uz
  );
}

function fbm(x: number, y: number, z: number) {
  let v = 0.0;
  let a = 0.5;
  let px = x, py = y, pz = z;
  for (let i = 0; i < 6; ++i) {
    v += a * noise(px, py, pz);
    px = px * 2.0 + 100.0;
    py = py * 2.0 + 100.0;
    pz = pz * 2.0 + 100.0;
    a *= 0.5;
  }
  return v;
}

function normalize(v: number[]) {
  let len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  return [v[0]/len, v[1]/len, v[2]/len];
}

function sphIntersect(ro: number[], rd: number[], ce: number[], ra: number) {
  let oc = [ro[0]-ce[0], ro[1]-ce[1], ro[2]-ce[2]];
  let b = oc[0]*rd[0] + oc[1]*rd[1] + oc[2]*rd[2];
  let c = oc[0]*oc[0] + oc[1]*oc[1] + oc[2]*oc[2] - ra*ra;
  let h = b*b - c;
  if (h < 0.0) return -1.0;
  h = Math.sqrt(h);
  return -b - h;
}

function getBiome(h: number, temp: number, moist: number, waterLevel: number) {
  if (h < waterLevel) {
    if (temp < -0.2) return { name: 'Frozen Ocean', description: 'Thick ice sheets covering deep waters.' };
    if (h < waterLevel - 0.2) return { name: 'Deep Ocean', description: 'Abyssal depths largely unexplored.' };
    return { name: 'Coastal Waters', description: 'Shallow, life-rich marine environments.' };
  }
  
  if (temp < -0.3) return { name: 'Glacial Wasteland', description: 'Barren ice and snow as far as the eye can see.' };
  if (temp > 0.4) {
    if (moist < -0.2) return { name: 'Scorched Desert', description: 'Arid, cracked earth with extreme temperatures.' };
    if (moist > 0.4) return { name: 'Primordial Jungle', description: 'Dense, overgrown rainforest teeming with life.' };
    return { name: 'Savanna', description: 'Dry grasslands with scattered resilient trees.' };
  }
  
  if (moist < -0.3) return { name: 'Rocky Steppe', description: 'Harsh, rocky terrain with sparse vegetation.' };
  if (moist > 0.3) return { name: 'Temperate Forest', description: 'Lush woodlands with diverse flora and fauna.' };
  
  return { name: 'Plains', description: 'Vast, rolling grasslands suitable for agriculture.' };
}

function generateHistory(biome: string, seed: number, px: number, py: number, pz: number) {
  const events = [
    "Site of the ancient battle of the First Era.",
    "Ruins of a forgotten civilization lie buried here.",
    "A massive meteor struck this region millennia ago.",
    "Legends speak of a mythical creature dwelling here.",
    "Once the capital of a prosperous global empire.",
    "An anomaly in the magnetic field was recorded here.",
    "First landing site of the celestial voyagers.",
    "A great cataclysm reshaped this land.",
    "Known for its rare and magical flora.",
    "A sacred pilgrimage site for nomadic tribes."
  ];
  
  let h = hash(px * 10 + seed, py * 10 + seed, pz * 10 + seed);
  let index = Math.floor(h * events.length);
  return events[index];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
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
  const [dynamicWeather, setDynamicWeather] = useState(false);
  const [showEcosystem, setShowEcosystem] = useState(true);

  // --- View & Camera Parameters ---
  const [projection, setProjection] = useState<'globe' | 'map'>('globe');
  const [zoom, setZoom] = useState(2.0);
  const [speed, setSpeed] = useState(0.2);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0.2);
  const [isPaused, setIsPaused] = useState(false);

  // --- UI State ---
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'presets' | 'world' | 'climate' | 'life' | 'civ' | 'view'>('presets');
  const [audioStarted, setAudioStarted] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<any>(null);
  const startTimeRef = useRef(Date.now());

  const [chaosActive, setChaosActive] = useState(false);

  const [speciesList, setSpeciesList] = useState<any[]>([]);
  const [civList, setCivList] = useState<any[]>([]);
  
  const [newSpecies, setNewSpecies] = useState({
    name: 'New Species',
    type: 'animal',
    habitat: 'land',
    color: '#ff0000',
    prefTemp: 0,
    prefMoist: 0
  });

  const [newCiv, setNewCiv] = useState({
    name: 'New Civilization',
    color: '#00ffff',
    aggression: 0.5,
    greed: 0.5,
    favResource: 'wood'
  });

  useEffect(() => {
    (window as any)._simulation = { species: [], entities: [], civs: [], settlements: [], units: [], chaosNodes: [], mutants: [] };
  }, []);

  const unleashChaos = () => {
    if (chaosActive) return;
    setChaosActive(true);
    const sim = (window as any)._simulation;
    sim.chaosNodes = [];
    for (let i = 0; i < 12; i++) {
      let a = i * (Math.PI / 6);
      sim.chaosNodes.push({
        p: [0, 0, 1], // Start at lat 0, lon 0
        v: [Math.sin(a), Math.cos(a), 0]
      });
    }
  };

  const spawnCiv = () => {
    const civ = { ...newCiv, id: Math.random().toString(), techLevel: 1, wealth: 0 };
    setCivList([...civList, civ]);
    
    const sim = (window as any)._simulation;
    if (sim) {
      sim.civs.push(civ);
      // Spawn initial settlement
      sim.settlements.push({
        id: Math.random().toString(),
        civId: civ.id,
        lat: (Math.random() - 0.5) * Math.PI * 0.8, // avoid poles
        lon: (Math.random() - 0.5) * 2 * Math.PI,
        population: 10,
        resources: 50,
        defense: 10,
        level: 1
      });
    }
  };

  const spawnSpecies = () => {
    const sp = { ...newSpecies, id: Math.random().toString() };
    setSpeciesList([...speciesList, sp]);
    
    const sim = (window as any)._simulation;
    if (sim) {
      sim.species.push(sp);
      for (let i = 0; i < 20; i++) {
        sim.entities.push({
          id: Math.random().toString(),
          speciesId: sp.id,
          lat: (Math.random() - 0.5) * Math.PI,
          lon: (Math.random() - 0.5) * 2 * Math.PI,
          health: 1.0,
          energy: 0.5
        });
      }
    }
  };

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
      
      // Chaos Params
      uniform float u_chaosActive;
      uniform vec3 u_chaosPoints[12];
      
      // Climate Params
      uniform float u_temperature;
      uniform float u_moisture;
      uniform float u_cloudCover;
      uniform float u_atmosphere;
      uniform float u_dynamicWeather;
      uniform float u_showEcosystem;
      
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

      vec3 getTerrainColor(float h, vec3 p, out float roughness, float currentTemp, float currentMoist) {
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
          float freeze = smoothstep(-0.2, -0.6, currentTemp);
          
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
        float temp = currentTemp + latTemp * 0.5 - l * 0.8;
        float moist = currentMoist + (1.0 - abs(p.y)) * 0.3 + l * 0.2;
        
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
            // Vegetation density based on moisture and temp
            float vegDensity = smoothstep(0.4, 1.0, moist) * smoothstep(0.4, 1.0, temp);
            vec3 denseJungle = vec3(0.01, 0.1, 0.02);
            color = mix(forest, mix(jungle, denseJungle, vegDensity), canopy);
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
            float vegDensity = smoothstep(0.3, 0.8, moist);
            vec3 denseForest = vec3(0.03, 0.2, 0.08);
            color = mix(grass, mix(forest, denseForest, vegDensity), canopy);
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

        float currentTemp = u_temperature;
        float currentMoist = u_moisture;
        float currentCloud = u_cloudCover;
        
        if (u_dynamicWeather > 0.5) {
            currentTemp += sin(u_time * 0.05) * 0.6;
            currentMoist += cos(u_time * 0.07) * 0.6;
            currentCloud += sin(u_time * 0.09) * 0.5;
            
            currentTemp = clamp(currentTemp, -1.0, 1.0);
            currentMoist = clamp(currentMoist, -1.0, 1.0);
            currentCloud = clamp(currentCloud, 0.0, 1.0);
        }

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
          vec3 albedo = getTerrainColor(h, pSample, roughness, currentTemp, currentMoist);
          
          // Normal mapping
          vec2 e = vec2(0.005, 0.0);
          float hx = fbm(normalize(pSample + e.xyy) * u_terrainScale) * u_elevation;
          float hy = fbm(normalize(pSample + e.yxy) * u_terrainScale) * u_elevation;
          float hz = fbm(normalize(pSample + e.yyx) * u_terrainScale) * u_elevation;
          vec3 bump = normalize(vec3(hx - h, hy - h, hz - h));
          
          vec3 n = normalize(p);
          vec3 tn = normalize(n - bump * roughness);
          
          // Rain shadow on ground
          vec3 cSampleGround = p * 1.02 + vec3(u_seed) + u_time * 0.05;
          float cloudValGround = fbm(cSampleGround);
          float stormFactor = smoothstep(0.5, 1.0, currentCloud) * smoothstep(0.3, 1.0, currentMoist);
          
          if (stormFactor > 0.0) {
              float rainArea = smoothstep(0.7, 1.0, cloudValGround);
              albedo = mix(albedo, albedo * 0.5, rainArea * stormFactor);
              roughness = mix(roughness, 0.2, rainArea * stormFactor);
          }
          
          float diff = max(dot(tn, lightDir), 0.0);
          float amb = 0.2; // Higher ambient for map view
          
          if (u_showEcosystem > 0.5) {
              if (h >= u_waterLevel) {
                  // Herds on plains
                  if (currentTemp > 0.0 && currentMoist > -0.2 && currentMoist < 0.4) {
                      vec3 herdPos = pSample * 150.0 + vec3(u_time * 0.2, 0.0, u_time * 0.2);
                      float herds = smoothstep(0.7, 0.8, fbm(herdPos));
                      albedo = mix(albedo, vec3(0.2, 0.15, 0.1), herds * 0.6);
                  }
                  // Birds over forests
                  if (currentMoist > 0.3) {
                      vec3 birdPos = pSample * 250.0 + vec3(u_time * 1.5, u_time * 1.0, 0.0);
                      float birds = smoothstep(0.8, 0.9, fbm(birdPos));
                      albedo = mix(albedo, vec3(0.1), birds * 0.5);
                  }
              } else {
                  // Marine life
                  if (h > u_waterLevel - 0.2 && currentTemp > 0.0) {
                      vec3 fishPos = pSample * 120.0 + vec3(u_time * 0.8, 0.0, u_time * 0.6);
                      float fish = smoothstep(0.75, 0.85, fbm(fishPos));
                      albedo = mix(albedo, vec3(0.1, 0.3, 0.4), fish * 0.4);
                  }
              }
          }
          
          col = albedo * (diff + amb);
          
          // Bioluminescence on dark side (Map view)
          vec3 bioColor = vec3(0.0);
          if (u_showEcosystem > 0.5 && diff < 0.1) {
              float darkFactor = smoothstep(0.1, 0.0, diff);
              if (h >= u_waterLevel && currentTemp > 0.0 && currentMoist > 0.2) {
                  float bio = smoothstep(0.6, 0.8, fbm(pSample * 80.0));
                  bioColor = vec3(0.1, 0.8, 0.4) * bio * darkFactor;
              } else if (h < u_waterLevel && currentTemp > 0.2) {
                  float shoreDist = u_waterLevel - h;
                  if (shoreDist < 0.05) {
                      float plankton = smoothstep(0.6, 0.9, fbm(pSample * 100.0 + u_time * 0.2));
                      bioColor = vec3(0.0, 0.6, 1.0) * plankton * darkFactor * smoothstep(0.05, 0.0, shoreDist);
                  }
              }
          }
          
          if (u_chaosActive > 0.5) {
              float minDist = 100.0;
              for (int i = 0; i < 12; i++) {
                  float d = distance(p, u_chaosPoints[i]);
                  minDist = min(minDist, d);
              }
              if (minDist < 0.15) {
                  float chaosIntensity = smoothstep(0.15, 0.0, minDist);
                  float chaosNoise = fbm(pSample * 20.0 + u_time * 2.0);
                  vec3 chaosColor = mix(vec3(0.9, 0.1, 0.8), vec3(0.4, 0.0, 1.0), chaosNoise);
                  albedo = mix(albedo, chaosColor, chaosIntensity * 0.85);
                  bioColor += chaosColor * chaosIntensity * 2.0;
              }
          }
          
          col += bioColor;
          
          // Clouds
          float cDetail = fbm(cSampleGround * 5.0);
          float c = mix(cloudValGround, cDetail, 0.3);
          float cloudAlpha = smoothstep(1.0 - currentCloud, 1.0, c);
          
          vec3 cloudCol = vec3(1.0);
          if (stormFactor > 0.0) {
              float isStormCloud = smoothstep(0.7, 1.0, c);
              cloudCol = mix(cloudCol, vec3(0.3, 0.35, 0.4), stormFactor * isStormCloud);
              
              float tFlash = floor(u_time * 12.0);
              vec3 flashCell = floor(p * 10.0 + vec3(tFlash));
              float flashHash = hash(flashCell);
              if (flashHash > 0.98) {
                  cloudCol += vec3(0.8, 0.9, 1.0) * ((flashHash - 0.98) * 50.0) * stormFactor * isStormCloud;
              }
          }
          
          col = mix(col, cloudCol, cloudAlpha * 0.9);
          
          float shadow = smoothstep(1.0 - currentCloud, 1.0, cloudValGround);
          col *= (1.0 - shadow * 0.5);
          
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
          vec3 albedo = getTerrainColor(h, pSample, roughness, currentTemp, currentMoist);
          
          vec2 e = vec2(0.005, 0.0);
          float hx = fbm(normalize(pSample + e.xyy) * u_terrainScale) * u_elevation;
          float hy = fbm(normalize(pSample + e.yxy) * u_terrainScale) * u_elevation;
          float hz = fbm(normalize(pSample + e.yyx) * u_terrainScale) * u_elevation;
          vec3 bump = normalize(vec3(hx - h, hy - h, hz - h));
          
          vec3 tn = normalize(n - bump * roughness);
          
          // Rain shadow on ground
          vec3 cSampleGround = pRot * 2.0 + vec3(u_seed) + u_time * 0.05;
          float cloudValGround = fbm(cSampleGround);
          float stormFactor = smoothstep(0.5, 1.0, currentCloud) * smoothstep(0.3, 1.0, currentMoist);
          
          if (stormFactor > 0.0) {
              float rainArea = smoothstep(0.7, 1.0, cloudValGround);
              albedo = mix(albedo, albedo * 0.5, rainArea * stormFactor);
              roughness = mix(roughness, 0.2, rainArea * stormFactor);
          }
          
          float diff = max(dot(tn, lightDir), 0.0);
          float amb = 0.05;
          
          if (u_showEcosystem > 0.5) {
              if (h >= u_waterLevel) {
                  // Herds on plains
                  if (currentTemp > 0.0 && currentMoist > -0.2 && currentMoist < 0.4) {
                      vec3 herdPos = pSample * 150.0 + vec3(u_time * 0.2, 0.0, u_time * 0.2);
                      float herds = smoothstep(0.7, 0.8, fbm(herdPos));
                      albedo = mix(albedo, vec3(0.2, 0.15, 0.1), herds * 0.6);
                  }
                  // Birds over forests
                  if (currentMoist > 0.3) {
                      vec3 birdPos = pSample * 250.0 + vec3(u_time * 1.5, u_time * 1.0, 0.0);
                      float birds = smoothstep(0.8, 0.9, fbm(birdPos));
                      albedo = mix(albedo, vec3(0.1), birds * 0.5);
                  }
              } else {
                  // Marine life
                  if (h > u_waterLevel - 0.2 && currentTemp > 0.0) {
                      vec3 fishPos = pSample * 120.0 + vec3(u_time * 0.8, 0.0, u_time * 0.6);
                      float fish = smoothstep(0.75, 0.85, fbm(fishPos));
                      albedo = mix(albedo, vec3(0.1, 0.3, 0.4), fish * 0.4);
                  }
              }
          }
          
          float spec = 0.0;
          if (roughness < 0.5) {
            vec3 ref = reflect(rd, tn);
            float specPower = mix(64.0, 8.0, roughness * 2.0);
            spec = pow(max(dot(ref, lightDir), 0.0), specPower) * (1.0 - roughness);
          }
          
          // Bioluminescence on dark side
          vec3 bioColor = vec3(0.0);
          if (u_showEcosystem > 0.5 && diff < 0.1) {
              float darkFactor = smoothstep(0.1, 0.0, diff);
              if (h >= u_waterLevel && currentTemp > 0.0 && currentMoist > 0.2) {
                  float bio = smoothstep(0.6, 0.8, fbm(pSample * 80.0));
                  bioColor = vec3(0.1, 0.8, 0.4) * bio * darkFactor;
              } else if (h < u_waterLevel && currentTemp > 0.2) {
                  float shoreDist = u_waterLevel - h;
                  if (shoreDist < 0.05) {
                      float plankton = smoothstep(0.6, 0.9, fbm(pSample * 100.0 + u_time * 0.2));
                      bioColor = vec3(0.0, 0.6, 1.0) * plankton * darkFactor * smoothstep(0.05, 0.0, shoreDist);
                  }
              }
          }
          
          if (u_chaosActive > 0.5) {
              float minDist = 100.0;
              for (int i = 0; i < 12; i++) {
                  float d = distance(pRot, u_chaosPoints[i]);
                  minDist = min(minDist, d);
              }
              if (minDist < 0.15) {
                  float chaosIntensity = smoothstep(0.15, 0.0, minDist);
                  float chaosNoise = fbm(pSample * 20.0 + u_time * 2.0);
                  vec3 chaosColor = mix(vec3(0.9, 0.1, 0.8), vec3(0.4, 0.0, 1.0), chaosNoise);
                  albedo = mix(albedo, chaosColor, chaosIntensity * 0.85);
                  bioColor += chaosColor * chaosIntensity * 2.0;
              }
          }
          
          col = albedo * (diff + amb) + spec + bioColor;
          
          vec2 tc = sphIntersect(ro, rd, vec3(0.0), 1.02);
          if (tc.x > 0.0) {
            vec3 pc = ro + rd * tc.x;
            vec3 pcRot = pc;
            pcRot.xz *= rot(u_time * u_speed * 0.7);
            
            vec3 cSample = pcRot * 2.0 + vec3(u_seed) + u_time * 0.05;
            float cBase = fbm(cSample);
            float cDetail = fbm(cSample * 5.0);
            float c = mix(cBase, cDetail, 0.3);
            
            float cloudAlpha = smoothstep(1.0 - currentCloud, 1.0, c);
            float cloudDiff = max(dot(normalize(pc), lightDir), 0.0);
            vec3 cloudCol = vec3(1.0) * (cloudDiff + 0.2);
            
            if (stormFactor > 0.0) {
                float isStormCloud = smoothstep(0.7, 1.0, c);
                cloudCol = mix(cloudCol, vec3(0.25, 0.3, 0.35) * (cloudDiff + 0.1), stormFactor * isStormCloud);
                
                float tFlash = floor(u_time * 12.0);
                vec3 flashCell = floor(pcRot * 10.0 + vec3(tFlash));
                float flashHash = hash(flashCell);
                if (flashHash > 0.98) {
                    cloudCol += vec3(0.8, 0.9, 1.0) * ((flashHash - 0.98) * 50.0) * stormFactor * isStormCloud;
                }
            }
            
            col = mix(col, cloudCol, cloudAlpha * 0.9);
            
            float shadow = smoothstep(1.0 - currentCloud, 1.0, cloudValGround);
            col *= (1.0 - shadow * 0.5);
          }
          
          float atmo = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
          float fogDensity = u_atmosphere * (1.0 + currentMoist * 0.5);
          vec3 atmoColor = mix(vec3(0.3, 0.6, 1.0), vec3(0.8, 0.4, 0.2), smoothstep(0.5, 1.0, currentTemp));
          atmoColor = mix(atmoColor, vec3(0.5, 0.55, 0.6), stormFactor * 0.5);
          col += atmoColor * atmo * fogDensity * diff;
        } else {
          vec2 ta = sphIntersect(ro, rd, vec3(0.0), 1.2);
          if (ta.x > 0.0 || ta.y > 0.0) {
            float dist = length(cross(ro, rd));
            float glow = smoothstep(1.2, 1.0, dist);
            vec3 atmoColor = mix(vec3(0.1, 0.3, 0.6), vec3(0.5, 0.2, 0.1), smoothstep(0.5, 1.0, currentTemp));
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
      dynamicWeather: gl.getUniformLocation(program, 'u_dynamicWeather'),
      showEcosystem: gl.getUniformLocation(program, 'u_showEcosystem'),
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
      gl.uniform1f(uniforms.dynamicWeather, getVal('_shaderDynamicWeather', 0.0));
      gl.uniform1f(uniforms.showEcosystem, getVal('_shaderShowEcosystem', 1.0));
      
      const isChaos = getVal('_shaderChaosActive', 0.0) > 0.5;
      gl.uniform1f(uniforms.chaosActive, isChaos ? 1.0 : 0.0);
      if (isChaos) {
        const chaosFlat = new Float32Array(36);
        const sim = (window as any)._simulation;
        if (sim && sim.chaosNodes) {
          for (let i = 0; i < 12; i++) {
            if (sim.chaosNodes[i]) {
              chaosFlat[i*3] = sim.chaosNodes[i].p[0];
              chaosFlat[i*3+1] = sim.chaosNodes[i].p[1];
              chaosFlat[i*3+2] = sim.chaosNodes[i].p[2];
            }
          }
        }
        gl.uniform3fv(uniforms.chaosPoints, chaosFlat);
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      
      // --- Overlay Simulation & Drawing ---
      const overlay = overlayRef.current;
      if (overlay) {
        if (overlay.width !== overlay.clientWidth || overlay.height !== overlay.clientHeight) {
          overlay.width = overlay.clientWidth;
          overlay.height = overlay.clientHeight;
        }
        const ctx = overlay.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          
          const sim = (window as any)._simulation;
          if (sim) {
            const timeNow = (Date.now() - startTimeRef.current) * 0.001;
            const dt = 0.016;
            
            const speed = getVal('_shaderSpeed', 0.2);
            const zoom = getVal('_shaderZoom', 2.0);
            const yaw = getVal('_shaderYaw', 0);
            const pitch = getVal('_shaderPitch', 0);
            const isMap = getVal('_shaderProjection', 0.0) > 0.5;
            
            const seed = getVal('_shaderSeed', 0.0);
            const terrainScale = getVal('_shaderTerrainScale', 1.5);
            const elevation = getVal('_shaderElevation', 1.0);
            const waterLevel = getVal('_shaderWaterLevel', 0.45);
            
            let currentTemp = getVal('_shaderTemperature', 0.0);
            let currentMoist = getVal('_shaderMoisture', 0.0);
            if (getVal('_shaderDynamicWeather', 0.0) > 0.5) {
              currentTemp += Math.sin(timeNow * 0.05) * 0.6;
              currentMoist += Math.cos(timeNow * 0.07) * 0.6;
              currentTemp = Math.max(-1.0, Math.min(1.0, currentTemp));
              currentMoist = Math.max(-1.0, Math.min(1.0, currentMoist));
            }
            
            if (!getVal('_shaderPaused', false)) {
              // --- Chaos Simulation ---
              const isChaos = getVal('_shaderChaosActive', 0.0) > 0.5;
              if (isChaos && sim.chaosNodes) {
                for (let node of sim.chaosNodes) {
                  // Meander
                  let meander = (Math.random() - 0.5) * 0.5;
                  let cosM = Math.cos(meander);
                  let sinM = Math.sin(meander);
                  let crossPV = [
                    node.p[1]*node.v[2] - node.p[2]*node.v[1],
                    node.p[2]*node.v[0] - node.p[0]*node.v[2],
                    node.p[0]*node.v[1] - node.p[1]*node.v[0]
                  ];
                  node.v = [
                    node.v[0]*cosM + crossPV[0]*sinM,
                    node.v[1]*cosM + crossPV[1]*sinM,
                    node.v[2]*cosM + crossPV[2]*sinM
                  ];
                  let vLen = Math.sqrt(node.v[0]*node.v[0] + node.v[1]*node.v[1] + node.v[2]*node.v[2]);
                  node.v = [node.v[0]/vLen, node.v[1]/vLen, node.v[2]/vLen];

                  // Move
                  let moveSpeed = dt * 0.1;
                  let cosS = Math.cos(moveSpeed);
                  let sinS = Math.sin(moveSpeed);
                  let pNew = [
                    node.p[0]*cosS + node.v[0]*sinS,
                    node.p[1]*cosS + node.v[1]*sinS,
                    node.p[2]*cosS + node.v[2]*sinS
                  ];
                  let vNew = [
                    -node.p[0]*sinS + node.v[0]*cosS,
                    -node.p[1]*sinS + node.v[1]*cosS,
                    -node.p[2]*sinS + node.v[2]*cosS
                  ];
                  node.p = pNew;
                  node.v = vNew;
                }
              }

              for (let i = sim.entities.length - 1; i >= 0; i--) {
                let e = sim.entities[i];
                let sp = sim.species.find((s: any) => s.id === e.speciesId);
                if (!sp) { sim.entities.splice(i, 1); continue; }
                
                let px = Math.cos(e.lat) * Math.sin(e.lon);
                let py = Math.sin(e.lat);
                let pz = Math.cos(e.lat) * Math.cos(e.lon);
                
                // Chaos Warping
                if (isChaos && sim.chaosNodes) {
                  let warped = false;
                  for (let node of sim.chaosNodes) {
                    let dx = px - node.p[0], dy = py - node.p[1], dz = pz - node.p[2];
                    if (dx*dx + dy*dy + dz*dz < 0.02) {
                      warped = true;
                      break;
                    }
                  }
                  if (warped) {
                    sim.entities.splice(i, 1);
                    sim.mutants.push({
                      id: Math.random().toString(),
                      lat: e.lat, lon: e.lon,
                      health: 5.0
                    });
                    continue;
                  }
                }
                
                let pSampleX = px + seed;
                let pSampleY = py + seed * 1.3;
                let pSampleZ = pz - seed * 0.8;
                
                let hVal = fbm(pSampleX * terrainScale, pSampleY * terrainScale, pSampleZ * terrainScale) * elevation;
                let l = Math.max(0.0, Math.min(1.0, (hVal - waterLevel) / (1.0 - waterLevel)));
                let latTemp = 1.0 - Math.abs(py);
                let localTemp = currentTemp + latTemp * 0.5 - l * 0.8;
                let localMoist = currentMoist + (1.0 - Math.abs(py)) * 0.3 + l * 0.2;
                
                let isLand = hVal >= waterLevel;
                let wrongHabitat = (sp.habitat === 'land' && !isLand) || (sp.habitat === 'ocean' && isLand);
                
                let tempDiff = Math.abs(localTemp - sp.prefTemp);
                let moistDiff = Math.abs(localMoist - sp.prefMoist);
                let happiness = 1.0 - (tempDiff + moistDiff) * 0.5;
                if (wrongHabitat) happiness -= 1.0;
                
                if (happiness > 0.5) {
                  e.health = Math.min(1.0, e.health + dt * 0.1);
                  e.energy += dt * (happiness - 0.5) * 0.5;
                } else {
                  e.health -= dt * (0.5 - happiness) * 0.5;
                }
                
                if (e.health <= 0) {
                  sim.entities.splice(i, 1);
                  continue;
                }
                
                if (sp.type === 'animal') {
                  e.lat += (Math.random() - 0.5) * dt * 0.2;
                  e.lon += (Math.random() - 0.5) * dt * 0.2;
                  e.lat = Math.max(-Math.PI/2, Math.min(Math.PI/2, e.lat));
                }
                
                if (e.energy > 1.0 && sim.entities.length < 1000) {
                  e.energy = 0.5;
                  sim.entities.push({
                    id: Math.random().toString(),
                    speciesId: sp.id,
                    lat: e.lat + (Math.random() - 0.5) * 0.1,
                    lon: e.lon + (Math.random() - 0.5) * 0.1,
                    health: 1.0,
                    energy: 0.5
                  });
                }
              }
              
              // --- Civ Simulation ---
              for (let i = sim.settlements.length - 1; i >= 0; i--) {
                let s = sim.settlements[i];
                let civ = sim.civs.find((c: any) => c.id === s.civId);
                if (!civ) { sim.settlements.splice(i, 1); continue; }
                
                let px = Math.cos(s.lat) * Math.sin(s.lon);
                let py = Math.sin(s.lat);
                let pz = Math.cos(s.lat) * Math.cos(s.lon);
                
                // Chaos Warping
                if (isChaos && sim.chaosNodes) {
                  for (let node of sim.chaosNodes) {
                    let dx = px - node.p[0], dy = py - node.p[1], dz = pz - node.p[2];
                    if (dx*dx + dy*dy + dz*dz < 0.04) {
                      s.defense -= dt * 5;
                      s.population -= dt * 2;
                      if (Math.random() < 0.02) {
                        sim.mutants.push({
                          id: Math.random().toString(),
                          lat: s.lat + (Math.random()-0.5)*0.1,
                          lon: s.lon + (Math.random()-0.5)*0.1,
                          health: 10.0
                        });
                      }
                    }
                  }
                  if (s.population <= 0) {
                    sim.settlements.splice(i, 1);
                    continue;
                  }
                }
                
                // Gather resources
                s.resources += dt * 5 * s.level;
                
                // Grow population
                if (s.resources > s.population * 2) {
                  s.population += dt * 2;
                  s.resources -= dt * 1;
                }
                
                // Level up settlement
                if (s.population > s.level * 50 && s.resources > s.level * 100) {
                  s.level++;
                  s.defense += 10;
                  civ.techLevel = Math.max(civ.techLevel, Math.floor(s.level / 2) + 1);
                }
                
                // Spawn units (traders/warriors/settlers)
                if (s.population > 20 && Math.random() < 0.01 * dt) {
                  let type = 'settler';
                  if (Math.random() < civ.aggression) type = 'warrior';
                  else if (Math.random() < civ.greed) type = 'trader';
                  
                  s.population -= 5;
                  sim.units.push({
                    id: Math.random().toString(),
                    civId: civ.id,
                    homeId: s.id,
                    type: type,
                    lat: s.lat,
                    lon: s.lon,
                    targetLat: s.lat + (Math.random() - 0.5) * 0.5,
                    targetLon: s.lon + (Math.random() - 0.5) * 0.5,
                    health: 10 * civ.techLevel,
                    payload: type === 'trader' ? 20 : 0
                  });
                }
              }
              
              for (let i = sim.units.length - 1; i >= 0; i--) {
                let u = sim.units[i];
                let civ = sim.civs.find((c: any) => c.id === u.civId);
                if (!civ) { sim.units.splice(i, 1); continue; }
                
                let px = Math.cos(u.lat) * Math.sin(u.lon);
                let py = Math.sin(u.lat);
                let pz = Math.cos(u.lat) * Math.cos(u.lon);
                
                // Chaos Warping
                if (isChaos && sim.chaosNodes) {
                  let warped = false;
                  for (let node of sim.chaosNodes) {
                    let dx = px - node.p[0], dy = py - node.p[1], dz = pz - node.p[2];
                    if (dx*dx + dy*dy + dz*dz < 0.02) {
                      warped = true;
                      break;
                    }
                  }
                  if (warped) {
                    sim.units.splice(i, 1);
                    sim.mutants.push({
                      id: Math.random().toString(),
                      lat: u.lat, lon: u.lon,
                      health: 10.0
                    });
                    continue;
                  }
                }
                
                // Move towards target
                let dLat = u.targetLat - u.lat;
                let dLon = u.targetLon - u.lon;
                let dist = Math.sqrt(dLat*dLat + dLon*dLon);
                
                let moveSpeed = dt * 0.1 * (civ.techLevel > 2 ? 2 : 1); // Wagons/Ships are faster
                
                if (dist > 0.01) {
                  u.lat += (dLat / dist) * moveSpeed;
                  u.lon += (dLon / dist) * moveSpeed;
                } else {
                  // Reached target
                  if (u.type === 'settler') {
                    // Build new settlement
                    sim.settlements.push({
                      id: Math.random().toString(),
                      civId: civ.id,
                      lat: u.lat,
                      lon: u.lon,
                      population: 5,
                      resources: 10,
                      defense: 5,
                      level: 1
                    });
                    sim.units.splice(i, 1);
                    continue;
                  } else if (u.type === 'trader') {
                    // Find nearest friendly settlement to trade
                    let nearest = sim.settlements.find((s: any) => s.civId === civ.id && s.id !== u.homeId);
                    if (nearest) {
                      nearest.resources += u.payload;
                      civ.wealth += u.payload;
                    }
                    sim.units.splice(i, 1);
                    continue;
                  } else if (u.type === 'warrior') {
                    // Find nearest enemy settlement
                    let enemy = sim.settlements.find((s: any) => s.civId !== civ.id);
                    if (enemy) {
                      let edLat = enemy.lat - u.lat;
                      let edLon = enemy.lon - u.lon;
                      if (Math.sqrt(edLat*edLat + edLon*edLon) < 0.1) {
                        // Attack
                        enemy.defense -= 5 * civ.techLevel;
                        if (enemy.defense <= 0) {
                          // Destroyed or captured
                          enemy.civId = civ.id;
                          enemy.defense = 10;
                          civ.wealth += enemy.resources;
                        }
                        sim.units.splice(i, 1);
                        continue;
                      } else {
                        u.targetLat = enemy.lat;
                        u.targetLon = enemy.lon;
                      }
                    } else {
                      // Patrol
                      u.targetLat = u.lat + (Math.random() - 0.5) * 0.5;
                      u.targetLon = u.lon + (Math.random() - 0.5) * 0.5;
                    }
                  }
                }
              }
              
              // --- Mutant Simulation ---
              if (isChaos && sim.mutants) {
                for (let i = sim.mutants.length - 1; i >= 0; i--) {
                  let m = sim.mutants[i];
                  m.health -= dt * 0.05;
                  if (m.health <= 0) { sim.mutants.splice(i, 1); continue; }
                  
                  let nearestS = null;
                  let minDist = Infinity;
                  for (let s of sim.settlements) {
                    let dLat = s.lat - m.lat;
                    let dLon = s.lon - m.lon;
                    let dist = dLat*dLat + dLon*dLon;
                    if (dist < minDist) { minDist = dist; nearestS = s; }
                  }
                  if (nearestS && minDist < 0.5) {
                    let dLat = nearestS.lat - m.lat;
                    let dLon = nearestS.lon - m.lon;
                    let dist = Math.sqrt(minDist);
                    if (dist < 0.05) {
                      nearestS.defense -= dt * 10;
                      nearestS.population -= dt * 5;
                      m.health += dt * 1;
                      if (nearestS.defense <= 0 && nearestS.population <= 0) {
                        sim.settlements = sim.settlements.filter((s:any) => s.id !== nearestS.id);
                      }
                    } else {
                      m.lat += (dLat/dist) * dt * 0.2;
                      m.lon += (dLon/dist) * dt * 0.2;
                    }
                  } else {
                    m.lat += (Math.random() - 0.5) * dt * 0.5;
                    m.lon += (Math.random() - 0.5) * dt * 0.5;
                  }
                  m.lat = Math.max(-Math.PI/2, Math.min(Math.PI/2, m.lat));
                }
              }
              
              // --- Mutant Simulation ---
              if (isChaos && sim.mutants) {
                for (let i = sim.mutants.length - 1; i >= 0; i--) {
                  let m = sim.mutants[i];
                  m.health -= dt * 0.05;
                  if (m.health <= 0) { sim.mutants.splice(i, 1); continue; }
                  
                  let nearestS = null;
                  let minDist = Infinity;
                  for (let s of sim.settlements) {
                    let dLat = s.lat - m.lat;
                    let dLon = s.lon - m.lon;
                    let dist = dLat*dLat + dLon*dLon;
                    if (dist < minDist) { minDist = dist; nearestS = s; }
                  }
                  if (nearestS && minDist < 0.5) {
                    let dLat = nearestS.lat - m.lat;
                    let dLon = nearestS.lon - m.lon;
                    let dist = Math.sqrt(minDist);
                    if (dist < 0.05) {
                      nearestS.defense -= dt * 10;
                      nearestS.population -= dt * 5;
                      m.health += dt * 1;
                      if (nearestS.defense <= 0 && nearestS.population <= 0) {
                        sim.settlements = sim.settlements.filter((s:any) => s.id !== nearestS.id);
                      }
                    } else {
                      m.lat += (dLat/dist) * dt * 0.2;
                      m.lon += (dLon/dist) * dt * 0.2;
                    }
                  } else {
                    m.lat += (Math.random() - 0.5) * dt * 0.5;
                    m.lon += (Math.random() - 0.5) * dt * 0.5;
                  }
                  m.lat = Math.max(-Math.PI/2, Math.min(Math.PI/2, m.lat));
                }
              }
            }
            
            // --- Draw Entities ---
            for (let e of sim.entities) {
              let sp = sim.species.find((s: any) => s.id === e.speciesId);
              if (!sp) continue;
              
              let px = Math.cos(e.lat) * Math.sin(e.lon);
              let py = Math.sin(e.lat);
              let pz = Math.cos(e.lat) * Math.cos(e.lon);
              
              let pos = null;
              if (!isMap) {
                let angle = -timeNow * speed * 0.5;
                let sA = Math.sin(angle), cA = Math.cos(angle);
                let worldX = px * cA - pz * sA;
                let worldZ = px * sA + pz * cA;
                let worldY = py;
                
                let ro_x = 0, ro_y = 0, ro_z = zoom;
                let sP_pos = Math.sin(pitch), cP_pos = Math.cos(pitch);
                let ro_y1 = ro_y * cP_pos - ro_z * sP_pos;
                let ro_z1 = ro_y * sP_pos + ro_z * cP_pos;
                ro_y = ro_y1; ro_z = ro_z1;
                
                let sY_pos = Math.sin(yaw), cY_pos = Math.cos(yaw);
                let ro_x2 = ro_x * cY_pos - ro_z * sY_pos;
                let ro_z2 = ro_x * sY_pos + ro_z * cY_pos;
                ro_x = ro_x2; ro_z = ro_z2;
                
                let vx = worldX - ro_x;
                let vy = worldY - ro_y;
                let vz = worldZ - ro_z;
                
                let vx1 = vx * cY_pos - vz * -sY_pos;
                let vz1 = vx * -sY_pos + vz * cY_pos;
                vx = vx1; vz = vz1;
                
                let vy2 = vy * cP_pos - vz * -sP_pos;
                let vz2 = vy * -sP_pos + vz * cP_pos;
                vy = vy2; vz = vz2;
                
                if (vz < 0) {
                  let uvx = vx / -vz;
                  let uvy = vy / -vz;
                  let screenX = uvx * overlay.height + 0.5 * overlay.width;
                  let screenY = uvy * overlay.height + 0.5 * overlay.height;
                  
                  let nx = worldX, ny = worldY, nz = worldZ;
                  let dx = worldX - ro_x, dy = worldY - ro_y, dz = worldZ - ro_z;
                  let dot = nx * dx + ny * dy + nz * dz;
                  
                  if (dot <= 0) {
                    pos = { x: screenX, y: overlay.height - screenY };
                  }
                }
              } else {
                let mapUVy = (e.lat - pitch) / Math.PI + 0.5;
                let lon_unwrapped = e.lon + yaw + timeNow * speed * 0.5;
                lon_unwrapped = ((lon_unwrapped + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
                let mapUVx = lon_unwrapped / (2 * Math.PI) + 0.5;
                
                let screenUVx = (mapUVx - 0.5) * (zoom * 0.5) + 0.5;
                let screenUVy = (mapUVy - 0.5) * (zoom * 0.5) + 0.5;
                
                if (screenUVx >= 0 && screenUVx <= 1 && screenUVy >= 0 && screenUVy <= 1) {
                  pos = { x: screenUVx * overlay.width, y: overlay.height - (screenUVy * overlay.height) };
                }
              }
              
              if (pos) {
                ctx.fillStyle = sp.color;
                ctx.globalAlpha = e.health;
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, sp.type === 'animal' ? 3 : 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
              }
            }
            
            // --- Draw Civs ---
            const getScreenPos = (lat: number, lon: number) => {
              let px = Math.cos(lat) * Math.sin(lon);
              let py = Math.sin(lat);
              let pz = Math.cos(lat) * Math.cos(lon);
              
              if (!isMap) {
                let angle = -timeNow * speed * 0.5;
                let sA = Math.sin(angle), cA = Math.cos(angle);
                let worldX = px * cA - pz * sA;
                let worldZ = px * sA + pz * cA;
                let worldY = py;
                
                let ro_x = 0, ro_y = 0, ro_z = zoom;
                let sP_pos = Math.sin(pitch), cP_pos = Math.cos(pitch);
                let ro_y1 = ro_y * cP_pos - ro_z * sP_pos;
                let ro_z1 = ro_y * sP_pos + ro_z * cP_pos;
                ro_y = ro_y1; ro_z = ro_z1;
                
                let sY_pos = Math.sin(yaw), cY_pos = Math.cos(yaw);
                let ro_x2 = ro_x * cY_pos - ro_z * sY_pos;
                let ro_z2 = ro_x * sY_pos + ro_z * cY_pos;
                ro_x = ro_x2; ro_z = ro_z2;
                
                let vx = worldX - ro_x;
                let vy = worldY - ro_y;
                let vz = worldZ - ro_z;
                
                let vx1 = vx * cY_pos - vz * -sY_pos;
                let vz1 = vx * -sY_pos + vz * cY_pos;
                vx = vx1; vz = vz1;
                
                let vy2 = vy * cP_pos - vz * -sP_pos;
                let vz2 = vy * -sP_pos + vz * cP_pos;
                vy = vy2; vz = vz2;
                
                if (vz < 0) {
                  let uvx = vx / -vz;
                  let uvy = vy / -vz;
                  let screenX = uvx * overlay.height + 0.5 * overlay.width;
                  let screenY = uvy * overlay.height + 0.5 * overlay.height;
                  
                  let nx = worldX, ny = worldY, nz = worldZ;
                  let dx = worldX - ro_x, dy = worldY - ro_y, dz = worldZ - ro_z;
                  let dot = nx * dx + ny * dy + nz * dz;
                  
                  if (dot <= 0) {
                    return { x: screenX, y: overlay.height - screenY };
                  }
                }
              } else {
                let mapUVy = (lat - pitch) / Math.PI + 0.5;
                let lon_unwrapped = lon + yaw + timeNow * speed * 0.5;
                lon_unwrapped = ((lon_unwrapped + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
                let mapUVx = lon_unwrapped / (2 * Math.PI) + 0.5;
                
                let screenUVx = (mapUVx - 0.5) * (zoom * 0.5) + 0.5;
                let screenUVy = (mapUVy - 0.5) * (zoom * 0.5) + 0.5;
                
                if (screenUVx >= 0 && screenUVx <= 1 && screenUVy >= 0 && screenUVy <= 1) {
                  return { x: screenUVx * overlay.width, y: overlay.height - (screenUVy * overlay.height) };
                }
              }
              return null;
            };

            for (let s of sim.settlements) {
              let civ = sim.civs.find((c: any) => c.id === s.civId);
              if (!civ) continue;
              let pos = getScreenPos(s.lat, s.lon);
              if (pos) {
                ctx.fillStyle = civ.color;
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                
                // Draw city based on level
                let size = 3 + s.level * 1.5;
                ctx.beginPath();
                if (civ.techLevel >= 3) {
                  // Advanced city (star)
                  for (let i = 0; i < 5; i++) {
                    ctx.lineTo(pos.x + Math.cos(i * Math.PI * 0.4) * size, pos.y + Math.sin(i * Math.PI * 0.4) * size);
                  }
                } else if (civ.techLevel === 2) {
                  // Town (square)
                  ctx.rect(pos.x - size/2, pos.y - size/2, size, size);
                } else {
                  // Village (triangle)
                  ctx.moveTo(pos.x, pos.y - size);
                  ctx.lineTo(pos.x + size, pos.y + size);
                  ctx.lineTo(pos.x - size, pos.y + size);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                
                // Draw defense walls if high defense
                if (s.defense > 20) {
                  ctx.strokeStyle = civ.color;
                  ctx.beginPath();
                  ctx.arc(pos.x, pos.y, size + 2, 0, Math.PI * 2);
                  ctx.stroke();
                }
              }
            }
            
            for (let u of sim.units) {
              let civ = sim.civs.find((c: any) => c.id === u.civId);
              if (!civ) continue;
              let pos = getScreenPos(u.lat, u.lon);
              if (pos) {
                ctx.fillStyle = civ.color;
                ctx.beginPath();
                if (u.type === 'warrior') {
                  ctx.moveTo(pos.x, pos.y - 3); ctx.lineTo(pos.x + 2, pos.y + 2); ctx.lineTo(pos.x - 2, pos.y + 2);
                } else if (u.type === 'trader') {
                  ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
                } else {
                  ctx.rect(pos.x - 1.5, pos.y - 1.5, 3, 3);
                }
                ctx.fill();
              }
            }
            
            // --- Draw Mutants & Chaos Nodes ---
            if (isChaos && sim.mutants) {
              for (let m of sim.mutants) {
                let pos = getScreenPos(m.lat, m.lon);
                if (pos) {
                  ctx.fillStyle = '#ff00ff';
                  ctx.shadowColor = '#ff00ff';
                  ctx.shadowBlur = 8;
                  ctx.beginPath();
                  ctx.arc(pos.x, pos.y, 3 + Math.random(), 0, Math.PI * 2);
                  ctx.fill();
                  ctx.shadowBlur = 0;
                }
              }
              
              if (sim.chaosNodes) {
                for (let node of sim.chaosNodes) {
                  let lat = Math.asin(node.p[1]);
                  let lon = Math.atan2(node.p[0], node.p[2]);
                  let pos = getScreenPos(lat, lon);
                  if (pos) {
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = '#ff00ff';
                    ctx.shadowBlur = 15;
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                  }
                }
              }
            }
          }
        }
      }

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
    if (s.dynamicWeather !== undefined) setDynamicWeather(s.dynamicWeather);
    if (s.showEcosystem !== undefined) setShowEcosystem(s.showEcosystem);
    
    setIsCollapsed(true);
  };

  const presets = [
    {
      id: 'earth-like',
      name: 'Earth-like',
      settings: { seed: Math.random() * 100, terrainScale: 1.5, elevation: 1.0, waterLevel: 0.45, temperature: 0.0, moisture: 0.0, cloudCover: 0.5, atmosphere: 1.0, speed: 0.2, zoom: 2.0, yaw: 0, pitch: 0.2, isPaused: false, projection: 'globe', dynamicWeather: false, showEcosystem: true }
    },
    {
      id: 'ocean',
      name: 'Ocean World',
      settings: { seed: Math.random() * 100, terrainScale: 1.0, elevation: 0.5, waterLevel: 0.85, temperature: 0.2, moisture: 0.5, cloudCover: 0.7, atmosphere: 1.5, speed: 0.1, zoom: 1.8, yaw: 1.5, pitch: -0.1, isPaused: false, projection: 'globe', dynamicWeather: false, showEcosystem: true }
    },
    {
      id: 'desert',
      name: 'Scorched Desert',
      settings: { seed: Math.random() * 100, terrainScale: 2.5, elevation: 1.2, waterLevel: 0.05, temperature: 0.8, moisture: -0.8, cloudCover: 0.1, atmosphere: 0.5, speed: 0.3, zoom: 2.2, yaw: 3.14, pitch: 0.5, isPaused: false, projection: 'globe', dynamicWeather: false, showEcosystem: false }
    },
    {
      id: 'ice',
      name: 'Frozen Wasteland',
      settings: { seed: Math.random() * 100, terrainScale: 3.0, elevation: 1.5, waterLevel: 0.6, temperature: -0.9, moisture: 0.2, cloudCover: 0.8, atmosphere: 1.2, speed: 0.05, zoom: 1.9, yaw: -1.0, pitch: 0.8, isPaused: false, projection: 'globe', dynamicWeather: false, showEcosystem: false }
    },
    {
      id: 'jungle',
      name: 'Primordial Jungle',
      settings: { seed: Math.random() * 100, terrainScale: 1.2, elevation: 0.8, waterLevel: 0.3, temperature: 0.6, moisture: 0.9, cloudCover: 0.6, atmosphere: 1.8, speed: 0.15, zoom: 2.1, yaw: 0, pitch: 0, isPaused: false, projection: 'globe', dynamicWeather: false, showEcosystem: true }
    },
    {
      id: 'storms',
      name: 'Chaotic Storms',
      settings: { seed: Math.random() * 100, terrainScale: 1.5, elevation: 1.0, waterLevel: 0.5, temperature: 0.2, moisture: 0.8, cloudCover: 0.8, atmosphere: 1.5, speed: 0.3, zoom: 2.0, yaw: 0, pitch: 0.2, isPaused: false, projection: 'globe', dynamicWeather: true, showEcosystem: true }
    },
    {
      id: 'map-view',
      name: 'Cartographer (Map View)',
      settings: { seed: Math.random() * 100, terrainScale: 1.5, elevation: 1.0, waterLevel: 0.45, temperature: 0.0, moisture: 0.0, cloudCover: 0.5, atmosphere: 1.0, speed: 0.2, zoom: 1.0, yaw: 0, pitch: 0, isPaused: false, projection: 'map', dynamicWeather: false, showEcosystem: true }
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

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioStarted) return;
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = rect.bottom - e.clientY;
    
    const u_resolution = [rect.width, rect.height];
    let mapUVx = x / u_resolution[0];
    let mapUVy = y / u_resolution[1];
    
    let time = (Date.now() - startTimeRef.current) * 0.001;
    
    let px = 0, py = 0, pz = 0, lat = 0, lon = 0;
    
    if (projection === 'map') {
      mapUVx = (mapUVx - 0.5) / (zoom * 0.5) + 0.5;
      mapUVy = (mapUVy - 0.5) / (zoom * 0.5) + 0.5;
      
      lon = (mapUVx - 0.5) * 2 * Math.PI - yaw - time * speed * 0.5;
      lat = (mapUVy - 0.5) * Math.PI + pitch;
      
      if (lat > Math.PI/2 || lat < -Math.PI/2) {
        setSelectedRegion(null);
        return;
      }
      
      px = Math.cos(lat) * Math.sin(lon);
      py = Math.sin(lat);
      pz = Math.cos(lat) * Math.cos(lon);
    } else {
      let uvx = (x - 0.5 * u_resolution[0]) / u_resolution[1];
      let uvy = (y - 0.5 * u_resolution[1]) / u_resolution[1];
      
      let ro = [0.0, 0.0, zoom];
      let rd = normalize([uvx, uvy, -1.0]);
      
      let sP = Math.sin(pitch), cP = Math.cos(pitch);
      let ro_y = ro[1]*cP - ro[2]*sP;
      let ro_z = ro[1]*sP + ro[2]*cP;
      ro[1] = ro_y; ro[2] = ro_z;
      
      let rd_y = rd[1]*cP - rd[2]*sP;
      let rd_z = rd[1]*sP + rd[2]*cP;
      rd[1] = rd_y; rd[2] = rd_z;
      
      let sY = Math.sin(yaw), cY = Math.cos(yaw);
      let ro_x = ro[0]*cY - ro[2]*sY;
      ro_z = ro[0]*sY + ro[2]*cY;
      ro[0] = ro_x; ro[2] = ro_z;
      
      let rd_x = rd[0]*cY - rd[2]*sY;
      rd_z = rd[0]*sY + rd[2]*cY;
      rd[0] = rd_x; rd[2] = rd_z;
      
      let t = sphIntersect(ro, rd, [0,0,0], 1.0);
      if (t > 0.0) {
        let p = [ro[0] + rd[0]*t, ro[1] + rd[1]*t, ro[2] + rd[2]*t];
        let angle = time * speed * 0.5;
        let sA = Math.sin(angle), cA = Math.cos(angle);
        px = p[0]*cA - p[2]*sA;
        pz = p[0]*sA + p[2]*cA;
        py = p[1];
        
        lat = Math.asin(py);
        lon = Math.atan2(px, pz);
      } else {
        setSelectedRegion(null);
        return;
      }
    }
    
    let pSampleX = px + seed;
    let pSampleY = py + seed * 1.3;
    let pSampleZ = pz - seed * 0.8;
    
    let hVal = fbm(pSampleX * terrainScale, pSampleY * terrainScale, pSampleZ * terrainScale) * elevation;
    
    let currentTemp = temperature;
    let currentMoist = moisture;
    if (dynamicWeather) {
      currentTemp += Math.sin(time * 0.05) * 0.6;
      currentMoist += Math.cos(time * 0.07) * 0.6;
      currentTemp = Math.max(-1.0, Math.min(1.0, currentTemp));
      currentMoist = Math.max(-1.0, Math.min(1.0, currentMoist));
    }
    
    let l = Math.max(0.0, Math.min(1.0, (hVal - waterLevel) / (1.0 - waterLevel)));
    let latTemp = 1.0 - Math.abs(py);
    let temp = currentTemp + latTemp * 0.5 - l * 0.8;
    let moist = currentMoist + (1.0 - Math.abs(py)) * 0.3 + l * 0.2;
    
    let biome = getBiome(hVal, temp, moist, waterLevel);
    
    setSelectedRegion({
      lat: (lat * 180 / Math.PI).toFixed(2),
      lon: (lon * 180 / Math.PI).toFixed(2),
      elevation: hVal < waterLevel ? 'Sea Level' : (l * 8000).toFixed(0) + 'm',
      temperature: (temp * 30 + 15).toFixed(1) + '°C',
      moisture: (moist * 50 + 50).toFixed(0) + '%',
      biome: biome.name,
      description: biome.description,
      history: generateHistory(biome.name, seed, px, py, pz)
    });
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
    (window as any)._shaderDynamicWeather = dynamicWeather ? 1.0 : 0.0;
    (window as any)._shaderShowEcosystem = showEcosystem ? 1.0 : 0.0;
    (window as any)._shaderChaosActive = chaosActive ? 1.0 : 0.0;
  }, [seed, terrainScale, elevation, waterLevel, temperature, moisture, cloudCover, atmosphere, speed, zoom, yaw, pitch, isPaused, projection, dynamicWeather, showEcosystem, chaosActive]);

  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      <canvas ref={canvasRef} onClick={handleCanvasClick} className="w-full h-full block cursor-crosshair" />
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      
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
                  className="w-full h-full md:w-[340px] md:h-auto bg-black/60 backdrop-blur-xl md:border border-white/10 md:rounded-2xl overflow-hidden flex flex-col pointer-events-auto"
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
                      { id: 'life', label: 'Life' },
                      { id: 'civ', label: 'Civs' },
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
                        <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
                          <div>
                            <span className="block text-[10px] font-mono uppercase text-green-400 mb-1">Ecosystem Layer</span>
                            <span className="block text-[8px] font-mono text-white/50 max-w-[180px]">Simulates flora density, moving fauna, and bioluminescence based on climate.</span>
                          </div>
                          <button 
                            onClick={() => setShowEcosystem(!showEcosystem)}
                            className={`px-3 py-1.5 rounded-full font-mono text-[9px] uppercase transition-colors ${showEcosystem ? 'bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}
                          >
                            {showEcosystem ? 'Active' : 'Off'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                          <div>
                            <span className="block text-[10px] font-mono uppercase text-purple-400 mb-1">Magical Chaos Energy</span>
                            <span className="block text-[8px] font-mono text-white/50 max-w-[180px]">Unleash 12 meandering leylines of corruption that warp life and spawn mutants.</span>
                          </div>
                          <button 
                            onClick={unleashChaos}
                            className={`px-3 py-1.5 rounded-full font-mono text-[9px] uppercase transition-colors ${chaosActive ? 'bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}
                          >
                            {chaosActive ? 'Active' : 'Unleash'}
                          </button>
                        </div>

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
                        <div className="flex items-center justify-between p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                          <div>
                            <span className="block text-[10px] font-mono uppercase text-blue-400 mb-1">Dynamic Weather</span>
                            <span className="block text-[8px] font-mono text-white/50 max-w-[180px]">Simulates global climate shifts, moving storms, and lightning.</span>
                          </div>
                          <button 
                            onClick={() => setDynamicWeather(!dynamicWeather)}
                            className={`px-3 py-1.5 rounded-full font-mono text-[9px] uppercase transition-colors ${dynamicWeather ? 'bg-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-white/10 text-white/40 hover:bg-white/20'}`}
                          >
                            {dynamicWeather ? 'Active' : 'Off'}
                          </button>
                        </div>
                        
                        <div className={`space-y-5 transition-opacity duration-500 ${dynamicWeather ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
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
                      </div>
                    )}

                    {activeTab === 'life' && (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-mono uppercase text-white/40 border-b border-white/10 pb-2">Create Species</h3>
                          
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Name</label>
                              <input 
                                type="text" value={newSpecies.name} onChange={e => setNewSpecies({...newSpecies, name: e.target.value})}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                              />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Type</label>
                                <select 
                                  value={newSpecies.type} onChange={e => setNewSpecies({...newSpecies, type: e.target.value as any})}
                                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-white/30 appearance-none"
                                >
                                  <option value="animal">Animal</option>
                                  <option value="plant">Plant</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Habitat</label>
                                <select 
                                  value={newSpecies.habitat} onChange={e => setNewSpecies({...newSpecies, habitat: e.target.value as any})}
                                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-white/30 appearance-none"
                                >
                                  <option value="land">Land</option>
                                  <option value="ocean">Ocean</option>
                                </select>
                              </div>
                            </div>
                            
                            <div>
                              <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Color</label>
                              <input 
                                type="color" value={newSpecies.color} onChange={e => setNewSpecies({...newSpecies, color: e.target.value})}
                                className="w-full h-8 bg-transparent rounded-lg cursor-pointer"
                              />
                            </div>
                            
                            <div className="space-y-2">
                              <div className="flex justify-between text-[9px] font-mono uppercase">
                                <span className="text-white/40">Pref Temp</span>
                                <span className="text-white/80">{newSpecies.prefTemp.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="-1" max="1" step="0.01" value={newSpecies.prefTemp}
                                onChange={(e) => setNewSpecies({...newSpecies, prefTemp: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                              />
                            </div>
                            
                            <div className="space-y-2">
                              <div className="flex justify-between text-[9px] font-mono uppercase">
                                <span className="text-white/40">Pref Moist</span>
                                <span className="text-white/80">{newSpecies.prefMoist.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="-1" max="1" step="0.01" value={newSpecies.prefMoist}
                                onChange={(e) => setNewSpecies({...newSpecies, prefMoist: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                              />
                            </div>
                            
                            <button 
                              onClick={spawnSpecies}
                              className="w-full py-2 bg-white/10 hover:bg-white/20 text-white font-mono text-[10px] uppercase tracking-widest rounded-lg transition-colors"
                            >
                              Spawn Species
                            </button>
                          </div>
                        </div>
                        
                        {speciesList.length > 0 && (
                          <div className="space-y-3">
                            <h3 className="text-[10px] font-mono uppercase text-white/40 border-b border-white/10 pb-2">Active Species</h3>
                            <div className="space-y-2">
                              {speciesList.map(sp => (
                                <div key={sp.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sp.color }} />
                                    <div>
                                      <span className="block text-xs font-mono text-white/90">{sp.name}</span>
                                      <span className="block text-[8px] font-mono text-white/40 uppercase">{sp.type} • {sp.habitat}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'civ' && (
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-mono uppercase text-white/40 border-b border-white/10 pb-2">Create Civilization</h3>
                          
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Name</label>
                              <input 
                                type="text" value={newCiv.name} onChange={e => setNewCiv({...newCiv, name: e.target.value})}
                                className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                              />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Color</label>
                                <input 
                                  type="color" value={newCiv.color} onChange={e => setNewCiv({...newCiv, color: e.target.value})}
                                  className="w-full h-8 bg-transparent rounded-lg cursor-pointer"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] font-mono text-white/40 uppercase mb-1">Fav Resource</label>
                                <select 
                                  value={newCiv.favResource} onChange={e => setNewCiv({...newCiv, favResource: e.target.value})}
                                  className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:border-white/30 appearance-none"
                                >
                                  <option value="wood">Wood</option>
                                  <option value="stone">Stone</option>
                                  <option value="gold">Gold</option>
                                  <option value="food">Food</option>
                                </select>
                              </div>
                            </div>
                            
                            <div className="space-y-2">
                              <div className="flex justify-between text-[9px] font-mono uppercase">
                                <span className="text-white/40">Aggression</span>
                                <span className="text-white/80">{newCiv.aggression.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="1" step="0.01" value={newCiv.aggression}
                                onChange={(e) => setNewCiv({...newCiv, aggression: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                              />
                            </div>
                            
                            <div className="space-y-2">
                              <div className="flex justify-between text-[9px] font-mono uppercase">
                                <span className="text-white/40">Greed (Trade Focus)</span>
                                <span className="text-white/80">{newCiv.greed.toFixed(2)}</span>
                              </div>
                              <input 
                                type="range" min="0" max="1" step="0.01" value={newCiv.greed}
                                onChange={(e) => setNewCiv({...newCiv, greed: parseFloat(e.target.value)})}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none accent-white/60"
                              />
                            </div>
                            
                            <button 
                              onClick={spawnCiv}
                              className="w-full py-2 bg-white/10 hover:bg-white/20 text-white font-mono text-[10px] uppercase tracking-widest rounded-lg transition-colors"
                            >
                              Spawn Civilization
                            </button>
                          </div>
                        </div>
                        
                        {civList.length > 0 && (
                          <div className="space-y-3">
                            <h3 className="text-[10px] font-mono uppercase text-white/40 border-b border-white/10 pb-2">Active Civilizations</h3>
                            <div className="space-y-2">
                              {civList.map(civ => (
                                <div key={civ.id} className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-white/5">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: civ.color }} />
                                    <div>
                                      <span className="block text-xs font-mono text-white/90">{civ.name}</span>
                                      <span className="block text-[8px] font-mono text-white/40 uppercase">Tech Lvl {civ.techLevel} • Wealth: {Math.floor(civ.wealth)}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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

      <AnimatePresence>
        {selectedRegion && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="absolute bottom-6 right-6 w-80 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl z-40 pointer-events-auto"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-white font-mono text-sm uppercase tracking-widest text-blue-400">{selectedRegion.biome}</h3>
              <button onClick={() => setSelectedRegion(null)} className="text-white/40 hover:text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <p className="text-white/60 text-xs font-mono mb-4 leading-relaxed">{selectedRegion.description}</p>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white/5 rounded-lg p-2">
                <span className="block text-[9px] font-mono text-white/40 uppercase mb-1">Coordinates</span>
                <span className="block text-xs font-mono text-white/80">{selectedRegion.lat}°, {selectedRegion.lon}°</span>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <span className="block text-[9px] font-mono text-white/40 uppercase mb-1">Elevation</span>
                <span className="block text-xs font-mono text-white/80">{selectedRegion.elevation}</span>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <span className="block text-[9px] font-mono text-white/40 uppercase mb-1">Temperature</span>
                <span className="block text-xs font-mono text-white/80">{selectedRegion.temperature}</span>
              </div>
              <div className="bg-white/5 rounded-lg p-2">
                <span className="block text-[9px] font-mono text-white/40 uppercase mb-1">Moisture</span>
                <span className="block text-xs font-mono text-white/80">{selectedRegion.moisture}</span>
              </div>
            </div>
            
            <div className="border-t border-white/10 pt-3">
              <span className="block text-[9px] font-mono text-blue-400/70 uppercase mb-1">Historical Record</span>
              <p className="text-white/70 text-xs font-mono italic">"{selectedRegion.history}"</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
