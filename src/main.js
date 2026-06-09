import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- 0. CONFIGURATION & STATE SYSTEM ---
const GAME_FPS = 23.3;
const ASPECT_RATIO = 4 / 3;

// Game States: 'loading', 'voice-setup', 'playing', 'paused', 'gameover'
let gameState = 'loading'; 

// Variabel waktu bertahan hidup player
let survivalTime = 0;
let finalSurvivalTime = 0;

// Variabel Microphone & Sensitivity Threshold (Batas Load)
let audioContextMic = null;
let micAnalyser = null;
let micDataArray = null;
let micStream = null;
let micThreshold = 45; 
let currentMicVolume = 0; 
let highNoiseDuration = 0; 

// --- 1. SETUP CANVAS & SCENE RATIO ---
const canvas = document.querySelector('#gameCanvas');

function getCanvasSize() {
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  let width = windowWidth;
  let height = windowWidth / ASPECT_RATIO;
  if (height > windowHeight) {
    height = windowHeight;
    width = height * ASPECT_RATIO;
  }
  return { width, height };
}
const size = getCanvasSize();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0d0d0a, 0.09);

const camera = new THREE.PerspectiveCamera(60, ASPECT_RATIO, 0.1, 1000);
const cameraPivot = new THREE.Group();
cameraPivot.add(camera);
scene.add(cameraPivot);

const player = {
  position: new THREE.Vector3(0, 1.6, 0),
  height: 1.6,
  radius: 0.6,
  walkSpeed: 3.8,
  runSpeed: 6.2,
  currentSpeed: 3.8
};
cameraPivot.position.copy(player.position);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(size.width, size.height);
renderer.setPixelRatio(1);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.43;

const renderTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.NearestFilter,
  format: THREE.RGBAFormat
});

// --- 2. LIGHTING SYSTEM ---
const ambientLight = new THREE.AmbientLight(0xffffff, 1.4); 
scene.add(ambientLight);

const flashlight = new THREE.SpotLight(0xffffff, 8, 35, Math.PI / 3.8, 0.6, 1);
flashlight.castShadow = true;
flashlight.shadow.mapSize.width = 256;  
flashlight.shadow.mapSize.height = 256;
flashlight.shadow.camera.near = 0.5;
flashlight.shadow.camera.far = 35;
flashlight.shadow.bias = -0.004; 
scene.add(flashlight);
scene.add(flashlight.target);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.5); 
dirLight.position.set(0, 5, 0);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 256;
dirLight.shadow.bias = -0.004;
scene.add(dirLight);

// --- 3. AUDIO HANDYCAM ENGINE ---
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

const bgAmbientNoise = new THREE.Audio(audioListener);
const bgSongDaise = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader();

let footstepLeftBuffer = null;
let footstepRightBuffer = null;
let totalAudioFiles = 4, audioDownloadedCount = 0;
const audioProgressMap = new Map();
let isMuted = false;

// --- 4. INTERNAL CANVAS HUD ENGINE (SISTEM GAMBAR OVERLAY MULTI-STATE) ---
const textCanvas = document.createElement('canvas');
textCanvas.width = 512;
textCanvas.height = 512;
const textContext = textCanvas.getContext('2d');
const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.minFilter = THREE.LinearFilter;

let overallProgress = 0;

function drawInternalLoadingHUD(nowTime) {
  textContext.clearRect(0, 0, textCanvas.width, textCanvas.height);
  textContext.shadowColor = "rgba(0, 0, 0, 0.85)";
  textContext.shadowBlur = 4;
  textContext.shadowOffsetX = 2;
  textContext.shadowOffsetY = 2;
  textContext.font = "bold 24px 'JetBrains Mono', monospace";
  textContext.textAlign = "center";
  textContext.fillStyle = "#ffffff";

  if (gameState === 'loading') {
    // STATE: LOADING ASSETS
    textContext.font = "bold 28px 'JetBrains Mono', monospace";
    textContext.fillText("LOADING...", 256, 210);
    textContext.font = "16px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#88887c";
    textContext.fillText(`${overallProgress}%`, 256, 240);
    textContext.shadowColor = "transparent";
    textContext.strokeStyle = "#444438";
    textContext.lineWidth = 2;
    const barW = 240, barH = 8, barX = 256 - (barW / 2), barY = 260;
    textContext.strokeRect(barX, barY, barW, barH);
    textContext.fillStyle = "#ffffff";
    textContext.fillRect(barX, barY, (overallProgress / 100) * barW, barH);

  } else if (gameState === 'voice-setup') {
    // STATE: SETTING MIC PANEL
    textContext.fillText("MICROPHONE CONFIGURATION", 256, 110);
    
    textContext.font = "13px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#88887c";
    textContext.fillText("Adjust threshold limit to balance voice load", 256, 140);

    // Render Balok Audio Putus-putus
    textContext.shadowColor = "transparent"; 
    const totalSegments = 34;    
    const startBarX = 120;      
    const barY = 180;         
    const segmentWidth = 5;     
    const segmentHeight = 22;     
    const segmentSpacing = 3;     

    for (let i = 0; i < totalSegments; i++) {
      const segmentValue = (i / totalSegments) * 100;
      const currentSegmentX = startBarX + i * (segmentWidth + segmentSpacing);

      if (currentMicVolume >= segmentValue) {
        if (segmentValue > micThreshold) textContext.fillStyle = "#ff3333";
        else textContext.fillStyle = "#ffffff";
      } else {
        textContext.fillStyle = "#22221b";
      }
      textContext.fillRect(currentSegmentX, barY, segmentWidth, segmentHeight);
    }

    // Treshold Line Marker
    const totalBarWidth = totalSegments * (segmentWidth + segmentSpacing) - segmentSpacing;
    const markerX = startBarX + (micThreshold / 100) * totalBarWidth;
    textContext.strokeStyle = "#ffaa00"; 
    textContext.lineWidth = 2;
    textContext.beginPath(); textContext.moveTo(markerX, barY - 8); textContext.lineTo(markerX, barY + segmentHeight + 8); textContext.stroke();

    textContext.shadowColor = "rgba(0, 0, 0, 0.85)";
    textContext.font = "bold 15px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#ffffff";
    textContext.fillText(`LIMIT LOAD THRESHOLD: ${micThreshold}%`, 256, 245);

    textContext.font = "13px 'JetBrains Mono', monospace";
    if (currentMicVolume > micThreshold) {
      const simulatedMs = Math.floor(Math.random() * 200) + 200;
      textContext.fillStyle = "#ff3333";
      textContext.fillText(`CURRENT LOAD: ${simulatedMs}ms - CRITICAL OVERFLOW!`, 256, 275);
    } else {
      textContext.fillStyle = "#33ff33";
      textContext.fillText(`CURRENT LOAD: ${Math.max(12, Math.round(currentMicVolume * 0.4))}ms - NOMINAL`, 256, 275);
    }

    textContext.font = "12px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#a8a89c";
    textContext.fillText("Press [-] to Decrease | [+] to Increase", 256, 310);
    
    const blink = Math.sin(nowTime * 0.006) > 0;
    textContext.font = "bold 15px 'JetBrains Mono', monospace";
    textContext.fillStyle = blink ? "#ffffff" : "#444438";
    textContext.fillText("[ PRESS ENTER TO CONNECT CAMERA ]", 256, 370);

  } else if (gameState === 'paused') {
    // STATE: GAME AUTO-PAUSED HUD (DI TENGAH)
    textContext.font = "bold 36px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#ffaa00";
    textContext.fillText("PAUSED", 256, 180);

    textContext.font = "16px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#88887c";
    textContext.fillText(`SURVIVED TIME: ${Math.round(survivalTime)}s`, 256, 220);
    textContext.fillText("GAME IS TEMPORARILY PAUSED", 256, 245);

    textContext.font = "bold 22px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#ffffff";
    textContext.fillText("[ESC] Resume", 256, 290);
    textContext.fillText(`[M] ${isMuted ? "Unmute" : "Mute"} Audio`, 256, 320);

    const blink = Math.sin(nowTime * 0.006) > 0;
    textContext.font = "bold 15px 'JetBrains Mono', monospace";
    textContext.fillStyle = blink ? "#ffffff" : "#444438";
    textContext.fillText("Press ESC / click canvas to resume", 256, 380);

  } else if (gameState === 'gameover') {
    // STATE: DISCONNECTING TEKS JATUH
    textContext.font = "bold 36px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#ff3333";
    textContext.fillText("Disconnecting", 256, 180);

    textContext.font = "16px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#88887c";
    textContext.fillText("CRITICAL SIGNAL LOAD OVERFLOW (200ms-400ms)", 256, 220);
    
    textContext.font = "bold 20px 'JetBrains Mono', monospace";
    textContext.fillStyle = "#ffffff";
    textContext.fillText(`SURVIVED TIME: ${finalSurvivalTime}s`, 256, 270);

    const blink = Math.sin(nowTime * 0.006) > 0;
    textContext.font = "bold 15px 'JetBrains Mono', monospace";
    textContext.fillStyle = blink ? "#ffffff" : "#333333";
    textContext.fillText("Please hit ENTER to restart game", 256, 360);
  }

  textTexture.needsUpdate = true;
}

// --- 5. CONTROLS & POINTER LOCK EVENT ENGINE (AUTO-PAUSE FIX) ---
let isLocked = false;

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    isLocked = true;
    // Jika kursor berhasil me-lock kembali pas kondisi pause, kembalikan game berjalan lancar
    if (gameState === 'paused') {
      gameState = 'playing';
      // Kembalikan volume kaset atau tetap mute sesuai pilihan
      bgAmbientNoise.setVolume(isMuted ? 0 : 0.4);
      bgSongDaise.setVolume(isMuted ? 0 : 0.5);
    }
  } else {
    isLocked = false;
    lastMovementX = 0; lastMovementY = 0;
    
    // FIX UTAMA: Jika player menekan ESC atau memencet Windows saat bermain, game langsung PAUSE!
    if (gameState === 'playing') {
      gameState = 'paused';
      // Redupkan volume tape kaset agar hawa pause kerasa hening pengap
      bgAmbientNoise.setVolume(0.08);
      bgSongDaise.setVolume(0.08);
    }
  }
});

canvas.addEventListener('click', () => { 
  // Klik kanvas saat pause otomatis memicu penguncian ulang kursor dan resume game
  if (gameState === 'playing' || gameState === 'paused') {
    canvas.requestPointerLock(); 
  }
});

const currentFlashlightQuat = new THREE.Quaternion();
let yaw = 0, pitch = 0;
let lastMovementX = 0, lastMovementY = 0;

document.addEventListener('mousemove', (event) => {
  if (!isLocked || gameState !== 'playing') return;
  yaw -= event.movementX * 0.002;
  pitch -= event.movementY * 0.002;
  pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
  
  cameraPivot.rotation.y = yaw;
  camera.rotation.x = pitch;

  lastMovementX += Math.abs(event.movementX) * 0.2;
  lastMovementY += Math.abs(event.movementY) * 0.2;
});

const keys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false };

window.addEventListener('keydown', (e) => { 
  if (gameState === 'voice-setup') {
    if (e.key === '-' || e.key === '_') micThreshold = Math.max(10, micThreshold - 5);
    if (e.key === '+' || e.key === '=') micThreshold = Math.min(95, micThreshold + 5);
    if (e.key === 'Enter') {
      gameState = 'playing';
      startGlobalGameAudio(); // Auto-lock mouse dan jalankan game murni saat Enter ditekan!
    }
    return;
  }
  
  if (gameState === 'gameover' && e.key === 'Enter') {
    resetGameVariables();
    return;
  }

  if (e.key.toLowerCase() === 'm') {
    isMuted = !isMuted;
    const targetVolume = isMuted ? 0 : 0.5;
    bgAmbientNoise.setVolume(isMuted ? 0 : 0.4);
    bgSongDaise.setVolume(targetVolume);
  }

  const key = e.key.toLowerCase();
  if (key === 'shift') keys.shift = true;
  else if (key in keys) keys[key] = true; 
});

window.addEventListener('keyup', (e) => { 
  const key = e.key.toLowerCase();
  if (key === 'shift') keys.shift = false;
  else if (key in keys) keys[key] = false; 
});

// --- 6. MICROPHONE CAPTURE ENGINE ---
function initUserMicrophone() {
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then((stream) => {
      micStream = stream;
      audioContextMic = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContextMic.createMediaStreamSource(stream);
      micAnalyser = audioContextMic.createAnalyser();
      micAnalyser.fftSize = 256;
      micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
      source.connect(micAnalyser);
      gameState = 'voice-setup';
    })
    .catch((err) => {
      alert("ALERT! Game ini wajib mengaktifkan izin Microphone untuk bermain!");
      console.error("Izin mic ditolak:", err);
    });
}

function updateMicrophoneVolumeTrack(deltaTime) {
  if (!micAnalyser) return;
  micAnalyser.getByteFrequencyData(micDataArray);
  
  let totalValue = 0;
  for (let i = 0; i < micDataArray.length; i++) { totalValue += micDataArray[i]; }
  const average = totalValue / micDataArray.length;
  currentMicVolume = Math.min(Math.round((average / 128) * 100), 100);

  if (gameState === 'playing') {
    if (currentMicVolume > micThreshold) {
      highNoiseDuration += deltaTime * 1000; 
      if (highNoiseDuration >= 320) { 
        triggerCameraCrashDisconnect();
      }
    } else {
      highNoiseDuration = THREE.MathUtils.lerp(highNoiseDuration, 0, 0.1);
    }
  }
}

// --- 7. PROCEDURAL ROOM MATRIX GENERATION ---
const ROOM_SIZE = 20; 
const activeRooms = new Map(); 
const wallCollisionObjects = []; 
const floorObjects = [];     
const loader = new GLTFLoader();
const wallRaycaster = new THREE.Raycaster();

const roomMasterCache = { 1: null, 2: null, 3: null, 4: null };
const preLoadProgressMap = new Map();

let totalModelsToDownload = 4, modelsDownloadedCount = 0;

function checkOverallAssetsLoading() {
  let sumPercentage = 0;
  preLoadProgressMap.forEach((pct) => { sumPercentage += pct; });
  audioProgressMap.forEach((pct) => { sumPercentage += pct; });
  
  const totalItems = totalModelsToDownload + totalAudioFiles;
  overallProgress = Math.min(Math.round(sumPercentage / totalItems), 100);

  if (modelsDownloadedCount >= totalModelsToDownload && audioDownloadedCount >= totalAudioFiles && gameState === 'loading') {
    initUserMicrophone();
  }
}

function initGlobalPreLoader() {
  for (let id = 1; id <= 4; id++) {
    preLoadProgressMap.set(id, 0);
    const url = `/models/room${id}.glb`;
    loader.load(url,
      (gltf) => {
        roomMasterCache[id] = gltf.scene; 
        modelsDownloadedCount++; preLoadProgressMap.set(id, 100); checkOverallAssetsLoading();
      },
      (xhr) => { if (xhr.total > 0) { preLoadProgressMap.set(id, (xhr.loaded / xhr.total) * 100); checkOverallAssetsLoading(); } },
      (err) => console.error("Load gagal:", err)
    );
  }

  const audioFiles = [
    { name: 'noise', url: '/bg/bg-noise-backroom.mp3' },
    { name: 'song', url: '/bg/bg-song-daise.mp3' },
    { name: 'fsLeft', url: '/sfx/footstep-left.mp3' },
    { name: 'fsRight', url: '/sfx/footstep-right.mp3' }
  ];
  audioFiles.forEach((file, idx) => {
    audioProgressMap.set(idx, 0);
    audioLoader.load(file.url,
      (buffer) => {
        if (idx === 0) bgAmbientNoise.setBuffer(buffer);
        else if (idx === 1) bgSongDaise.setBuffer(buffer);
        else if (file.name === 'fsLeft') footstepLeftBuffer = buffer;
        else if (file.name === 'fsRight') footstepRightBuffer = buffer;
        audioDownloadedCount++; audioProgressMap.set(idx, 100); checkOverallAssetsLoading();
      },
      (xhr) => { if (xhr.total > 0) { audioProgressMap.set(idx, (xhr.loaded / xhr.total) * 100); checkOverallAssetsLoading(); } }
    );
  });
}

function startGlobalGameAudio() {
  // Beri jeda 200ms agar browser tidak menolak Pointer Lock
  setTimeout(() => {
    canvas.requestPointerLock();
  }, 200);

  survivalTime = 0;
  highNoiseDuration = 0;

  bgAmbientNoise.setLoop(true); 
  bgAmbientNoise.setVolume(0.4); 
  bgAmbientNoise.play();

  bgSongDaise.setLoop(true); 
  bgSongDaise.setVolume(0.5); 
  bgSongDaise.play();

  loadRoomInstance(0, 0);
  loadRoomInstance(1, 0); loadRoomInstance(-1, 0);
  loadRoomInstance(0, 1); loadRoomInstance(0, -1);
}
// function startGlobalGameAudio() {
//   canvas.requestPointerLock(); // REQUES UTAMA: Kunci mouse instan pas setup mic beres!
//   survivalTime = 0;
//   highNoiseDuration = 0;

//   bgAmbientNoise.setLoop(true); bgAmbientNoise.setVolume(0.4); bgAmbientNoise.play();
//   bgSongDaise.setLoop(true); bgSongDaise.setVolume(0.5); bgSongDaise.play();

//   loadRoomInstance(0, 0);
//   loadRoomInstance(1, 0); loadRoomInstance(-1, 0);
//   loadRoomInstance(0, 1); loadRoomInstance(0, -1);
// }

function loadRoomInstance(gridX, gridZ) {
  const key = `${gridX},${gridZ}`;
  if (activeRooms.has(key)) return; 

  const roomGroup = new THREE.Group();
  roomGroup.position.set(gridX * ROOM_SIZE, 0, gridZ * ROOM_SIZE);
  scene.add(roomGroup);
  activeRooms.set(key, { group: roomGroup, loaded: true });

  const dotProduct = Math.sin(gridX * 12.9898 + gridZ * 78.233) * 43758.5453123;
  const pseudoRandomFactor = dotProduct - Math.floor(dotProduct); 
  const randomId = Math.floor(pseudoRandomFactor * 4) + 1; 

  const masterScene = roomMasterCache[randomId];
  if (!masterScene) return;

  const instance = masterScene.clone(); 
  roomGroup.add(instance);

  instance.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true; child.receiveShadow = true;
      if (child.material) child.material.roughness = Math.max(child.material.roughness, 0.5);
      if (child.name.toLowerCase().includes('floor') || child.name.toLowerCase().includes('lantai')) {
        if (child.material) { child.material.roughness = 0.05; child.material.metalness = 0.1; }
        floorObjects.push(child); 
      } else {
        wallCollisionObjects.push(child); 
      }
    }
  });

  if (gridX === 0 && gridZ === 0) triggerConnectTransition();
}

function updateProceduralMap() {
  if (gameState !== 'playing') return;
  const pGridX = Math.round(player.position.x / ROOM_SIZE);
  const pGridZ = Math.round(player.position.z / ROOM_SIZE);

  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      if (Math.abs(x) + Math.abs(z) <= 1) loadRoomInstance(pGridX + x, pGridZ + z);
    }
  }

  activeRooms.forEach((roomData, key) => {
    const [rx, rz] = key.split(',').map(Number);
    const distance = Math.abs(rx - pGridX) + Math.abs(rz - pGridZ);
    if (distance >= 3) {
      scene.remove(roomData.group);
      roomData.group.traverse((child) => {
        if (child.isMesh) {
          const wIndex = wallCollisionObjects.indexOf(child); if (wIndex > -1) wallCollisionObjects.splice(wIndex, 1);
          const fIndex = floorObjects.indexOf(child); if (fIndex > -1) floorObjects.splice(fIndex, 1);
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        }
      });
      activeRooms.delete(key);
    } else if (distance === 2) { roomData.group.visible = false; } 
    else { roomData.group.visible = true; }
  });
}

initGlobalPreLoader();

// --- 8. CUSTOM VHS POST-PROCESSING SHADER ---
const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const vhsShaderMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    tHUD: { value: textTexture }, 
    uTime: { value: 0 },
    uBlurIntensity: { value: 0.0 },
    uScreenState: { value: 0.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tHUD;
    uniform float uTime;
    uniform float uBlurIntensity;
    uniform float uScreenState;
    varying vec2 vUv;

    float noise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    vec2 curveLense(vec2 uv) {
      vec2 dxt = uv - 0.5;
      float dist = dxt.x * dxt.x + dxt.y * dxt.y;
      uv = uv + dxt * dist * 0.06 + dxt * (dist * dist) * 0.08;
      return uv * 0.92 + 0.04;
    }

    void main() {
      vec2 uv = curveLense(vUv);
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
      }
      vec4 finalColor;

      // Jika state layar bernilai 0.0 (loading, setup, pause, gameover), cetak tulisan kanvas murni
      if (uScreenState < 0.5) {
        vec4 hudTex = texture2D(tHUD, uv);
        vec3 bgLoading = vec3(0.04, 0.04, 0.03);
        finalColor = vec4(mix(bgLoading, hudTex.rgb, hudTex.a), 1.0);
      } else {
        float split = 0.0005; 
        vec4 colR = texture2D(tDiffuse, vec2(uv.x - split, uv.y));
        vec4 colG = texture2D(tDiffuse, uv);
        vec4 colB = texture2D(tDiffuse, vec2(uv.x + split, uv.y));
        vec4 baseColor = vec4(colR.r, colG.g, colB.b, 1.0);

        vec4 blurColor = vec4(0.0);
        float blurSteps = (uBlurIntensity * 0.006) + 0.001;
        blurColor += texture2D(tDiffuse, uv + vec2(-blurSteps * 3.0, 0.0));
        blurColor += texture2D(tDiffuse, uv + vec2(-blurSteps * 1.5, 0.0));
        blurColor += texture2D(tDiffuse, uv + vec2(blurSteps * 1.5, 0.0));
        blurColor += texture2D(tDiffuse, uv + vec2(blurSteps * 3.0, 0.0));
        blurColor /= 4.0;

        finalColor = baseColor * 0.6 + blurColor * 0.6;
        float aoFactor = 1.0;
        vec4 checkSides = texture2D(tDiffuse, uv + vec2(0.002, 0.002)) + texture2D(tDiffuse, uv - vec2(0.002, 0.002));
        if (length(finalColor.rgb - (checkSides.rgb / 2.0)) > 0.22) aoFactor = 0.94; 
        finalColor.rgb *= aoFactor;
      }

      float staticNoise = noise(uv + vec2(uTime, sin(uTime)));
      if (staticNoise > 0.97) finalColor.rgb -= vec3(0.25 * noise(vec2(uv.y, uTime)));
      finalColor.rgb += vec3(staticNoise * 0.06);

      float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
      vignette = clamp(pow(16.0 * vignette, 0.35), 0.0, 1.0);
      finalColor.rgb *= vignette;
      gl_FragColor = finalColor;
    }
  `
});

const postPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), vhsShaderMaterial);
postScene.add(postPlane);

function triggerConnectTransition() {
  if (vhsShaderMaterial.uniforms.uScreenState.value === 1.0) return;
  setTimeout(() => {
    vhsShaderMaterial.uniforms.uScreenState.value = 1.0;
    lastMovementX = 4.0; lastMovementY = 4.0; 
  }, 400); 
}

function triggerCameraCrashDisconnect() {
  gameState = 'gameover';
  finalSurvivalTime = Math.round(survivalTime);
  
  bgAmbientNoise.stop();
  bgSongDaise.stop();
  document.exitPointerLock();

  camera.rotation.set(Math.PI / 2.3, 0, Math.PI / 4); 
  cameraPivot.position.y = player.position.y - 1.45; 

  setTimeout(() => {
    vhsShaderMaterial.uniforms.uScreenState.value = 0.0; 
  }, 350); 
}

function resetGameVariables() {
  activeRooms.forEach((room) => scene.remove(room.group));
  activeRooms.clear();
  wallCollisionObjects.length = 0;
  floorObjects.length = 0;

  player.position.set(0, 1.6, 0);
  cameraPivot.position.copy(player.position);
  camera.rotation.set(0, 0, 0);
  yaw = 0; pitch = 0;
  cameraPivot.rotation.set(0, 0, 0);

  vhsShaderMaterial.uniforms.uScreenState.value = 0.0;
  gameState = 'voice-setup'; 
}

// --- 9. PHYSIC COLLISION ENGINE ---
function updatePhysics(deltaTime) {
  if (!isLocked || gameState !== 'playing') return;
  player.currentSpeed = keys.shift ? player.runSpeed : player.walkSpeed;

  const moveVector = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraPivot.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraPivot.quaternion);
  forward.y = 0; forward.normalize();
  right.y = 0; right.normalize();

  if (keys.w) moveVector.add(forward); if (keys.s) moveVector.add(forward.clone().negate());
  if (keys.d) moveVector.add(right); if (keys.a) moveVector.add(right.clone().negate());
  moveVector.normalize();

  const nextPosition = player.position.clone();
  nextPosition.x += moveVector.x * player.currentSpeed * deltaTime;
  nextPosition.z += moveVector.z * player.currentSpeed * deltaTime;

  let canMoveX = true, canMoveZ = true;
  if (moveVector.lengthSq() > 0 && wallCollisionObjects.length > 0) {
    const rayOrigin = new THREE.Vector3(player.position.x, player.position.y - 0.5, player.position.z);
    wallRaycaster.set(rayOrigin, new THREE.Vector3(moveVector.x, 0, 0).normalize());
    const hitX = wallRaycaster.intersectObjects(wallCollisionObjects);
    if (hitX.length > 0 && hitX[0].distance < player.radius) canMoveX = false;

    wallRaycaster.set(rayOrigin, new THREE.Vector3(0, 0, moveVector.z).normalize());
    const hitZ = wallRaycaster.intersectObjects(wallCollisionObjects);
    if (hitZ.length > 0 && hitZ[0].distance < player.radius) canMoveZ = false;
    lastMovementX += keys.shift ? 0.35 : 0.18;
  }
  if (canMoveX) player.position.x = nextPosition.x;
  if (canMoveZ) player.position.z = nextPosition.z;
}

// --- 10. MULTI-CHANNEL FOOTSTEP AUDIO ENGINE ---
let stepTimer = 0, lastStepWasLeft = true;
function playDynamicFootstepSFX() {
  const bufferTarget = lastStepWasLeft ? footstepLeftBuffer : footstepRightBuffer;
  if (!bufferTarget) return;
  const temporaryStepAudio = new THREE.Audio(audioListener);
  temporaryStepAudio.setBuffer(bufferTarget);
  temporaryStepAudio.setVolume(keys.shift ? 0.65 : 0.45);
  temporaryStepAudio.play();
  lastStepWasLeft = !lastStepWasLeft;
}
function updateFootstepAudioLogic(deltaTime) {
  const isMoving = keys.w || keys.a || keys.s || keys.d;
  if (!isLocked || !isMoving || gameState !== 'playing') { stepTimer = 0; return; }
  const stepInterval = keys.shift ? 0.28 : 0.44;
  stepTimer += deltaTime;
  if (stepTimer >= stepInterval) { stepTimer = 0; playDynamicFootstepSFX(); }
}

// --- 11. HARD THUD CAMERA BODYCAM SHAKE + LEAN FUNCTION ---
let bobTime = 0, currentBobX = 0, currentBobY = 0, currentRoll = 0, currentPitch = 0, currentLeanX = 0, currentLeanRoll = 0;
function updateCameraShake(deltaTime) {
  if (gameState !== 'playing') return;
  const isMoving = keys.w || keys.a || keys.s || keys.d;
  let targetBobX = 0, targetBobY = 0, targetRoll = 0, targetPitch = 0;

  if (isLocked && isMoving) {
    const tempo = keys.shift ? 22 : 14; bobTime += deltaTime * tempo; 
    const rawSin = Math.sin(bobTime);
    targetBobY = Math.pow(Math.abs(rawSin), 3.0) * (keys.shift ? 0.28 : 0.18); 
    targetBobX = Math.cos(bobTime * 0.5) * (keys.shift ? 0.10 : 0.06);
    targetRoll = Math.cos(bobTime * 0.5) * (keys.shift ? 0.06 : 0.03);
    targetPitch = Math.sin(bobTime) * (keys.shift ? 0.03 : 0.015);
  } else if (isLocked) {
    bobTime += deltaTime * 0.9;
    targetBobY = Math.sin(bobTime) * 0.04; targetBobX = Math.cos(bobTime * 0.5) * 0.03; targetRoll = Math.sin(bobTime * 0.5) * 0.015;
  }

  currentBobX = THREE.MathUtils.lerp(currentBobX, targetBobX, 0.2);
  currentBobY = THREE.MathUtils.lerp(currentBobY, targetBobY, 0.2);
  currentRoll = THREE.MathUtils.lerp(currentRoll, targetRoll, 0.2);
  currentPitch = THREE.MathUtils.lerp(currentPitch, targetPitch, 0.2);

  let targetLeanX = 0, targetLeanRoll = 0;
  if (isLocked) {
    if (keys.q) { targetLeanX = -1.1; targetLeanRoll = 0.52; lastMovementX += 0.08; } 
    else if (keys.e) { targetLeanX = 1.1; targetLeanRoll = -0.52; lastMovementX += 0.08; }
  }
  currentLeanX = THREE.MathUtils.lerp(currentLeanX, targetLeanX, 0.14);
  currentLeanRoll = THREE.MathUtils.lerp(currentLeanRoll, targetLeanRoll, 0.14);

  const leanVector = new THREE.Vector3(currentBobX + currentLeanX, currentBobY - 0.05, 0).applyQuaternion(cameraPivot.quaternion); 
  cameraPivot.position.copy(player.position).add(leanVector);
  camera.rotation.z = currentRoll + currentLeanRoll;
  camera.rotation.y = Math.sin(bobTime * 0.5) * 0.005;
}

// --- 12. ANIMATION LOOP ENGINE (23.3 FPS) ---
const fpsInterval = 1000 / GAME_FPS;
let then = performance.now(), lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const elapsed = now - then;
  
  if (elapsed > fpsInterval) {
    then = now - (elapsed % fpsInterval);
    const deltaTime = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    
    // TETAP LAKUKAN MIKROFON TRACKING meski game di-pause (biar ga error)
    if (gameState !== 'loading') {
      updateMicrophoneVolumeTrack(deltaTime);
    }

    if (gameState === 'playing') {
      survivalTime += deltaTime;
      updatePhysics(deltaTime);
      updateCameraShake(deltaTime);
      updateFootstepAudioLogic(deltaTime);
      updateProceduralMap(); 
    } else {
      // HUD tetap digambar walaupun gamenya stuck/pause/setup
      drawInternalLoadingHUD(now);
    }

    // --- SINKRONISASI SENTER (Amankan variabel global) ---
    const worldCameraPos = new THREE.Vector3(), worldCameraQuat = new THREE.Quaternion();
    camera.getWorldPosition(worldCameraPos); 
    camera.getWorldQuaternion(worldCameraQuat);
    flashlight.position.copy(worldCameraPos);
    currentFlashlightQuat.slerp(worldCameraQuat, 0.12);
    const targetVector = new THREE.Vector3(0, 0, -1).applyQuaternion(currentFlashlightQuat);
    flashlight.target.position.copy(worldCameraPos).add(targetVector);

    // ... (sisanya tetap sama: update shader uniforms & render) ...
    vhsShaderMaterial.uniforms.uTime.value = (now * 0.001) % 10.0;
    vhsShaderMaterial.uniforms.uBlurIntensity.value = Math.min((lastMovementX + lastMovementY), 2.0);
    vhsShaderMaterial.uniforms.uScreenState.value = gameState === 'playing' ? 1.0 : 0.0;
    
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    vhsShaderMaterial.uniforms.tDiffuse.value = renderTarget.texture;
    renderer.render(postScene, postCamera);
  }
}

window.addEventListener('resize', () => {
  const newSize = getCanvasSize();
  renderer.setSize(newSize.width, newSize.height);
  renderTarget.setSize(newSize.width, newSize.height);
});

animate();