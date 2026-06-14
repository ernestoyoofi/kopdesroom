import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- 0. CONFIGURATION & STATE SYSTEM ---
// const GAME_FPS = 60; // test 60fps
const GAME_FPS = 30; // test 30fps
// const GAME_FPS = 23.3;
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
const canvas = document.querySelector('#game-canvas');

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
  walkSpeed: 2.28,
  runSpeed: 6.2,
  velocity: new THREE.Vector3(),
  acceleration: 10,
  friction: 6
};

cameraPivot.position.copy(player.position);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(size.width, size.height);
renderer.setPixelRatio(1);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.43;

const renderTarget = new THREE.WebGLRenderTarget(size.width, size.height);

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
let flashOnBuffer = null;
let flashOffBuffer = null;
const ambienceBuffers = [];
let totalAudioFiles = 10, audioDownloadedCount = 0; // Increased to 10
const audioProgressMap = new Map();
let isMuted = false;

// --- SCP & RANDOM EVENTS STATE ---
let scpSoloMesh = null;
let scpFallingMesh = null;
let jumpscareBuffer = null;
let hitMetalBuffer = null;

// let jumpscareTimer = 4; // Testing Jumpscare (Only For Debugging)
let jumpscareTimer = 60 + Math.random() * 60; // Start jumpscare after 1-2 mins
let jumpscarePhase = 'idle'; // 'idle', 'flicker', 'waiting', 'rushing'
let jumpscareInternalTimer = 0;
let jumpscareRushDir = new THREE.Vector3();

let metalFallTimer = 30 + Math.random() * 45;
let fallingObjectActive = false;
let currentFallingObject = null;
let fallingVelocity = 0;

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
    textContext.fillText("[Screen!] Resume", 256, 290);
    textContext.fillText(`[M] ${isMuted ? "Unmute" : "Mute"} Audio`, 256, 320);

    const blink = Math.sin(nowTime * 0.006) > 0;
    textContext.font = "bold 15px 'JetBrains Mono', monospace";
    textContext.fillStyle = blink ? "#ffffff" : "#444438";
    textContext.fillText("Click screen to resume", 256, 380);

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
let smoothYaw = 0, smoothPitch = 0;
let lastMovementX = 0, lastMovementY = 0;

document.addEventListener('mousemove', (event) => {
  if (!isLocked || gameState !== 'playing') return;
  yaw -= event.movementX * 0.002;
  pitch -= event.movementY * 0.002;
  pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
  
  lastMovementX += Math.abs(event.movementX) * 0.2;
  lastMovementY += Math.abs(event.movementY) * 0.2;
});

let flashlightOn = true;
canvas.addEventListener('mousedown', (e) => {
  if (gameState === 'playing' && isLocked && e.button === 0) {
    flashlightOn = !flashlightOn;
    flashlight.visible = flashlightOn;
    const flashAudio = new THREE.Audio(audioListener);
    flashAudio.setBuffer(flashlightOn ? flashOnBuffer : flashOffBuffer);
    flashAudio.setVolume(0.7);
    flashAudio.play();
  }
});

let zoomFov = 60, zoomTarget = 60;
canvas.addEventListener('wheel', (e) => {
  if (gameState !== 'playing') return;
  e.preventDefault();
  zoomTarget += e.deltaY * 0.05;
  zoomTarget = Math.max(12, Math.min(60, zoomTarget));
}, { passive: false });

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
      if (highNoiseDuration >= 270) { 
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

let totalModelsToDownload = 6, modelsDownloadedCount = 0; // Increased to 6

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
  const modelFiles = [
    { id: 1, url: '/models/room1.glb' },
    { id: 2, url: '/models/room2.glb' },
    { id: 3, url: '/models/room3.glb' },
    { id: 4, url: '/models/room4.glb' },
    { id: 'solo', url: '/models/scp-solo02.glb' },
    { id: 'falling', url: '/models/scp-opgmbg01.glb' }
  ];

  modelFiles.forEach((file) => {
    preLoadProgressMap.set(file.id, 0);
    loader.load(file.url,
      (gltf) => {
        if (typeof file.id === 'number') roomMasterCache[file.id] = gltf.scene;
        else if (file.id === 'solo') {
          scpSoloMesh = gltf.scene;
          scpSoloMesh.visible = false;
          scene.add(scpSoloMesh);
        } else if (file.id === 'falling') {
          scpFallingMesh = gltf.scene;
        }
        modelsDownloadedCount++; 
        preLoadProgressMap.set(file.id, 100); 
        checkOverallAssetsLoading();
      },
      (xhr) => { if (xhr.total > 0) { preLoadProgressMap.set(file.id, (xhr.loaded / xhr.total) * 100); checkOverallAssetsLoading(); } },
      (err) => console.error("Load gagal:", err)
    );
  });

  const audioFiles = [
    { name: 'noise', url: '/bg/bg-noise-backroom.mp3' },
    { name: 'song', url: '/bg/bg-song-daise.mp3' },
    { name: 'fsLeft', url: '/sfx/footstep-left.mp3' },
    { name: 'fsRight', url: '/sfx/footstep-right.mp3' },
    { name: 'flashOn', url: '/sfx/flashlight-on.mp3' },
    { name: 'flashOff', url: '/sfx/flashlight-off.mp3' },
    { name: 'amb1', url: '/ambiences/banyak-negara-yang-panik-indonesia-masih-ok.mp3' },
    { name: 'amb2', url: '/ambiences/desa-ga-pakai-dolar.mp3' },
    { name: 'jumpscare', url: '/sfx/jumpscare-wokaget.mp3' },
    { name: 'metal', url: '/sfx/hit-metal-falling.mp3' }
  ];
  audioFiles.forEach((file, idx) => {
    audioProgressMap.set(idx, 0);
    audioLoader.load(file.url,
      (buffer) => {
        if (idx === 0) bgAmbientNoise.setBuffer(buffer);
        else if (idx === 1) bgSongDaise.setBuffer(buffer);
        else if (file.name === 'fsLeft') footstepLeftBuffer = buffer;
        else if (file.name === 'fsRight') footstepRightBuffer = buffer;
        else if (file.name === 'flashOn') flashOnBuffer = buffer;
        else if (file.name === 'flashOff') flashOffBuffer = buffer;
        else if (file.name === 'amb1') ambienceBuffers[0] = buffer;
        else if (file.name === 'amb2') ambienceBuffers[1] = buffer;
        else if (file.name === 'jumpscare') jumpscareBuffer = buffer;
        else if (file.name === 'metal') hitMetalBuffer = buffer;
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

        float blurWeight = min(uBlurIntensity * 0.1, 0.35);
        finalColor = baseColor * (1.0 - blurWeight) + blurColor * blurWeight;

        // Bloom: extract bright areas and add glow
        float brightLum = dot(baseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float bloomIntensity = max(brightLum - 0.6, 0.0) * 1.5;
        finalColor.rgb += blurColor.rgb * bloomIntensity * 0.8;
        float aoFactor = 1.0;
        vec4 checkSides = texture2D(tDiffuse, uv + vec2(0.002, 0.002)) + texture2D(tDiffuse, uv - vec2(0.002, 0.002));
        if (length(finalColor.rgb - (checkSides.rgb / 2.0)) > 0.22) aoFactor = 0.94; 
        finalColor.rgb *= aoFactor;
      }

      // Thick film grain
      float grain = noise(uv * 4.0 + vec2(uTime * 0.6, 0.0));
      grain = (grain - 0.5) * 0.08;
      finalColor.rgb += grain;
      // Blurred noise layer
      float blurNoise = (noise(uv * 2.5 + vec2(uTime * 0.3, 0.0)) - 0.5) * 0.05;
      finalColor.rgb += blurNoise;
      // Dust/scratches
      float dust = noise(vec2(uv.y * 100.0 + uTime * 0.3, floor(uv.x * 50.0)));
      dust = step(0.995, dust) * 0.2;
      finalColor.rgb += dust;
      // Color flicker
      float flicker = 1.0 + (noise(vec2(uTime * 0.05, 0.0)) - 0.5) * 0.03;
      finalColor.rgb *= flicker;

      float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
      vignette = clamp(pow(16.0 * vignette, 0.35), 0.0, 1.0);
      finalColor.rgb *= vignette;
      gl_FragColor = finalColor;
    }
  `
});

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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
  player.velocity.set(0, 0, 0);
  cameraPivot.position.copy(player.position);
  camera.rotation.set(0, 0, 0);
  yaw = 0; pitch = 0; smoothYaw = 0; smoothPitch = 0;
  cameraPivot.rotation.set(0, 0, 0);
  shakeIntensity = 0;
  runTime = 0;
  leanHeldX = 0; leanHeldRoll = 0; leanDelayTimer = 0; leanReturnProgress = 1;
  ambienceTimer = 0; ambienceInterval = 30 + Math.random() * 60;

  flashlightOn = true;
  flashlight.visible = true;
  zoomFov = 60; zoomTarget = 60;
  camera.fov = 60;
  camera.updateProjectionMatrix();
  vhsShaderMaterial.uniforms.uScreenState.value = 0.0;
  gameState = 'voice-setup'; 
}

// --- 9. PHYSIC COLLISION ENGINE (Eased Movement) ---
function updatePhysics(deltaTime) {
  if (!isLocked || gameState !== 'playing') return;
  const maxSpeed = keys.shift ? player.runSpeed : player.walkSpeed;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraPivot.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraPivot.quaternion);
  forward.y = 0; forward.normalize();
  right.y = 0; right.normalize();

  let moveX = 0, moveZ = 0;
  if (keys.w) { moveX += forward.x; moveZ += forward.z; }
  if (keys.s) { moveX -= forward.x; moveZ -= forward.z; }
  if (keys.d) { moveX += right.x; moveZ += right.z; }
  if (keys.a) { moveX -= right.x; moveZ -= right.z; }

  const inputMag = Math.sqrt(moveX * moveX + moveZ * moveZ);
  const hasInput = inputMag > 0.001;

  if (hasInput) {
    moveX /= inputMag;
    moveZ /= inputMag;
    player.velocity.x += moveX * player.acceleration * deltaTime;
    player.velocity.z += moveZ * player.acceleration * deltaTime;
    const speed = Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2);
    if (speed > maxSpeed) {
      player.velocity.x *= maxSpeed / speed;
      player.velocity.z *= maxSpeed / speed;
    }
    lastMovementX += keys.shift ? 0.35 : 0.18;
  } else {
    const speed = Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2);
    if (speed > 0) {
      const frictionAmount = player.friction * deltaTime;
      if (frictionAmount >= speed) {
        player.velocity.x = 0;
        player.velocity.z = 0;
      } else {
        const ratio = (speed - frictionAmount) / speed;
        player.velocity.x *= ratio;
        player.velocity.z *= ratio;
      }
    }
  }

  const nextPosition = player.position.clone();
  nextPosition.x += player.velocity.x * deltaTime;
  nextPosition.z += player.velocity.z * deltaTime;

  let canMoveX = true, canMoveZ = true;
  const velMag = Math.sqrt(player.velocity.x ** 2 + player.velocity.z ** 2);
  if (velMag > 0.001 && wallCollisionObjects.length > 0) {
    const rayOrigin = new THREE.Vector3(player.position.x, player.position.y - 0.5, player.position.z);
    wallRaycaster.set(rayOrigin, new THREE.Vector3(player.velocity.x, 0, 0).normalize());
    const hitX = wallRaycaster.intersectObjects(wallCollisionObjects);
    if (hitX.length > 0 && hitX[0].distance < player.radius) canMoveX = false;

    wallRaycaster.set(rayOrigin, new THREE.Vector3(0, 0, player.velocity.z).normalize());
    const hitZ = wallRaycaster.intersectObjects(wallCollisionObjects);
    if (hitZ.length > 0 && hitZ[0].distance < player.radius) canMoveZ = false;
  }
  if (canMoveX) player.position.x = nextPosition.x; else player.velocity.x = 0;
  if (canMoveZ) player.position.z = nextPosition.z; else player.velocity.z = 0;
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
  const stepInterval = keys.shift ? 0.22 : 0.38;
  stepTimer += deltaTime;
  if (stepTimer >= stepInterval) { stepTimer = 0; playDynamicFootstepSFX(); }
}

// --- 11. HARD THUD CAMERA BODYCAM SHAKE + LEAN FUNCTION (Smooth Transitions) ---
let bobTime = 0, currentBobX = 0, currentBobY = 0, currentRoll = 0, currentPitch = 0, currentLeanX = 0, currentLeanRoll = 0;
let shakeIntensity = 0, runTime = 0;
let leanHeldX = 0, leanHeldRoll = 0, leanDelayTimer = 0, leanReturnProgress = 1, leanReturnFromX = 0, leanReturnFromRoll = 0;
let tremorTime = 0; 
let smoothStepInterval = 0.38;
let movementWeight = 0, runWeight = 0;
let collisionContactDist = 1.0; 
let currentLookRoll = 0; // Added for tilting when looking around
function updateCameraShake(deltaTime) {
  if (gameState !== 'playing') return;
  const isMoving = (keys.w || keys.a || keys.s || keys.d) && isLocked;
  const isRunning = keys.shift && isMoving;
  
  // Weights for blending animations smoothly
  movementWeight = THREE.MathUtils.lerp(movementWeight, isMoving ? 1.0 : 0.0, 0.08);
  runWeight = THREE.MathUtils.lerp(runWeight, isRunning ? 1.0 : 0.0, 0.06);

  // Transition the rhythm speed smoothly
  const targetStepInterval = isRunning ? 0.22 : 0.38;
  smoothStepInterval = THREE.MathUtils.lerp(smoothStepInterval, targetStepInterval, 0.1);

  // Accumulate time for different oscillators
  tremorTime += deltaTime;
  const tempo = (Math.PI / smoothStepInterval);
  bobTime += deltaTime * tempo * movementWeight; 

  const t = bobTime;
  const noiseTime = tremorTime * 1.5;

  // 1. Handheld Jitter/Tremor (High Frequency)
  const jitterX = (Math.sin(tremorTime * 15.1) * 0.4 + Math.sin(tremorTime * 27.3) * 0.3 + Math.sin(tremorTime * 41.7) * 0.2) * 0.002;
  const jitterY = (Math.sin(tremorTime * 17.2) * 0.4 + Math.sin(tremorTime * 23.1) * 0.3 + Math.sin(tremorTime * 37.1) * 0.2) * 0.002;
  
  // 2. Slow Organic Sway (Low Frequency) - Always active for bodycam feel
  const swayX = (Math.sin(noiseTime * 0.7) * 0.5 + Math.sin(noiseTime * 1.3) * 0.3) * 0.03;
  const swayY = (Math.cos(noiseTime * 0.6) * 0.5 + Math.sin(noiseTime * 1.1) * 0.3) * 0.03;
  const swayRoll = (Math.sin(noiseTime * 0.5) * 0.5 + Math.cos(noiseTime * 0.9) * 0.3) * 0.02;

  // 3. Movement Bobbing (Footsteps)
  // Dynamic amplitudes based on movement and run weights
  const bobAmpX = (0.04 + runWeight * 0.05) * movementWeight;
  const bobAmpY = (0.08 + runWeight * 0.12) * movementWeight;
  const bobAmpRoll = (0.02 + runWeight * 0.08) * movementWeight;
  const bobAmpPitch = (0.03 + runWeight * 0.04) * movementWeight;

  const moveBobX = Math.cos(t * 0.5) * bobAmpX;
  // Step impact: Use a steeper curve for the "down" part of the step
  const moveBobY = Math.pow(Math.abs(Math.sin(t)), 2.2) * bobAmpY;
  const moveBobRoll = Math.sin(t * 0.5) * bobAmpRoll;
  const moveBobPitch = Math.cos(t) * bobAmpPitch;

  // 4. Look-based Roll (Tilting when panning)
  // We use the difference between target yaw and smooth yaw from the last frame
  let yawVel = (yaw - smoothYaw);
  yawVel = Math.atan2(Math.sin(yawVel), Math.cos(yawVel));
  const maxRollRad = 14 * (Math.PI / 180); // Limit to 14 degrees
  const targetLookRoll = Math.max(-maxRollRad, Math.min(maxRollRad, -yawVel * 3.5)); 
  currentLookRoll = THREE.MathUtils.lerp(currentLookRoll, targetLookRoll, 0.1);

  // Combine all layers
  let targetBobX = swayX + moveBobX + jitterX;
  let targetBobY = swayY + moveBobY + jitterY;
  
  // Extra running shake intensity: Add sharp, chaotic jolts when running
  if (runWeight > 0.1) {
    const runJolt = Math.sin(t * 2.0) * Math.cos(t * 0.5);
    targetBobY += runJolt * 0.08 * runWeight;
    targetBobX += Math.cos(t * 2.5) * 0.05 * runWeight;
  }

  let targetRoll = swayRoll + moveBobRoll + currentLookRoll + (jitterX * 2.5);
  let targetPitch = moveBobPitch + (jitterY * 2.5);

  // Smooth the result to add "inertia" and "weight"
  currentBobX = THREE.MathUtils.lerp(currentBobX, targetBobX, 0.12);
  currentBobY = THREE.MathUtils.lerp(currentBobY, targetBobY, 0.12);
  currentRoll = THREE.MathUtils.lerp(currentRoll, targetRoll, 0.12);
  currentPitch = THREE.MathUtils.lerp(currentPitch, targetPitch, 0.12);

  // Update camera rotation (secondary layers)
  // Add a slight forward "kick" on each step impact, stronger when running
  const stepKick = Math.pow(Math.abs(Math.sin(t)), 8.0) * (0.02 + runWeight * 0.03) * movementWeight;
  camera.rotation.y = THREE.MathUtils.lerp(camera.rotation.y, (Math.sin(t * 0.5) * 0.015 * movementWeight) + (swayX * 0.5), 0.05);
  camera.rotation.x = THREE.MathUtils.lerp(camera.rotation.x, smoothPitch + currentPitch + stepKick, 0.25);

  // Lean logic (kept similar but smoothed)
  let targetLeanX = 0, targetLeanRoll = 0;
  if (isLocked) {
    if (keys.q) {
      leanHeldX = -1.1; leanHeldRoll = 0.52; leanDelayTimer = 0.2; leanReturnProgress = 1;
    } else if (keys.e) {
      leanHeldX = 1.1; leanHeldRoll = -0.52; leanDelayTimer = 0.2; leanReturnProgress = 1;
    }

    if (keys.q || keys.e) {
      targetLeanX = leanHeldX; targetLeanRoll = leanHeldRoll;
    } else if (leanHeldX !== 0 || leanHeldRoll !== 0) {
      if (leanDelayTimer > 0) {
        leanDelayTimer -= deltaTime;
        targetLeanX = leanHeldX; targetLeanRoll = leanHeldRoll;
      } else {
        leanReturnProgress = Math.max(0, leanReturnProgress - deltaTime * 3);
        const ease = 1 - Math.pow(1 - (1 - leanReturnProgress), 3);
        targetLeanX = THREE.MathUtils.lerp(0, leanHeldX, 1 - ease);
        targetLeanRoll = THREE.MathUtils.lerp(0, leanHeldRoll, 1 - ease);
        if (leanReturnProgress <= 0) { leanHeldX = 0; leanHeldRoll = 0; leanReturnProgress = 1; }
      }
    }
  }
  currentLeanX = THREE.MathUtils.lerp(currentLeanX, targetLeanX, 0.1);
  currentLeanRoll = THREE.MathUtils.lerp(currentLeanRoll, targetLeanRoll, 0.1);

  // --- SMOOTH CAMERA COLLISION SYSTEM ---
  let desiredLeanVector = new THREE.Vector3(currentBobX + currentLeanX, currentBobY - 0.05, 0).applyQuaternion(cameraPivot.quaternion);
  
  const rayOrigin = player.position.clone();
  const rayDir = desiredLeanVector.clone().normalize();
  const rayDist = desiredLeanVector.length();

  let targetCollisionFactor = 1.0;
  if (rayDist > 0.01 && wallCollisionObjects.length > 0) {
    wallRaycaster.set(rayOrigin, rayDir);
    const hits = wallRaycaster.intersectObjects(wallCollisionObjects);
    if (hits.length > 0 && hits[0].distance < rayDist + 0.25) {
      targetCollisionFactor = Math.max(0, (hits[0].distance - 0.25) / rayDist);
    }
  }
  // Smoothly adjust the collision factor to prevent snapping
  collisionContactDist = THREE.MathUtils.lerp(collisionContactDist, targetCollisionFactor, 0.15);
  desiredLeanVector.multiplyScalar(collisionContactDist);

  cameraPivot.position.copy(player.position).add(desiredLeanVector);
  camera.rotation.z = currentRoll + currentLeanRoll + (Math.random() - 0.5) * 0.001; 
}

// --- SCP MANAGER ENGINE ---
function updateSCPManager(deltaTime) {
  if (gameState !== 'playing') return;

  // 1. SCPSOLO JUMPSCARE LOGIC
  if (jumpscarePhase === 'idle') {
    jumpscareTimer -= deltaTime;
    if (jumpscareTimer <= 0) {
      // console.log("DEV: Jumpscare solo starting...");  // Debugging Console (Only For Debugging)
      jumpscarePhase = 'flicker';
      jumpscareInternalTimer = 0;
      
      // Auto-turn on flashlight if off
      if (!flashlightOn) {
        flashlightOn = true;
        flashlight.visible = true;
        const flashAudio = new THREE.Audio(audioListener);
        flashAudio.setBuffer(flashOnBuffer);
        flashAudio.setVolume(0.7);
        flashAudio.play();
      }
    }
  } else if (jumpscarePhase === 'flicker') {
    jumpscareInternalTimer += deltaTime;
    // Flicker twice (On-Off-On-Off) in 1.2s
    if (jumpscareInternalTimer < 0.3) flashlight.visible = true;
    else if (jumpscareInternalTimer < 0.6) flashlight.visible = false;
    else if (jumpscareInternalTimer < 0.9) flashlight.visible = true;
    else if (jumpscareInternalTimer < 1.2) flashlight.visible = false;
    else {
      flashlight.visible = true; // Stay on for countdown
      jumpscarePhase = 'waiting';
      jumpscareInternalTimer = 0;
    }
  } else if (jumpscarePhase === 'waiting') {
    jumpscareInternalTimer += deltaTime;
    if (jumpscareInternalTimer >= 3.0) {
      jumpscarePhase = 'rushing';
      jumpscareInternalTimer = 0;
      
      // Get exact camera forward direction for spawn and rush
      const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      cameraForward.y = 0; cameraForward.normalize();

      // Spawn SCP in front of camera view
      if (scpSoloMesh) {
        scpSoloMesh.position.copy(player.position).add(cameraForward.clone().multiplyScalar(8));
        scpSoloMesh.position.y = 0;
        scpSoloMesh.lookAt(player.position.x, 0, player.position.z);
        scpSoloMesh.visible = true;

        // Rush direction is the opposite of the spawn direction relative to player
        jumpscareRushDir.copy(cameraForward).negate().normalize();
      }

      // Play jumpscare audio
      if (jumpscareBuffer) {
        const jsAudio = new THREE.Audio(audioListener);
        jsAudio.setBuffer(jumpscareBuffer);
        jsAudio.setVolume(1.0);
        jsAudio.play();
      }
    }
  } else if (jumpscarePhase === 'rushing') {
    jumpscareInternalTimer += deltaTime;
    if (scpSoloMesh) {
      // Move in a perfectly straight line through the player
      scpSoloMesh.position.add(jumpscareRushDir.clone().multiplyScalar(deltaTime * 24)); 
    }
    // Disappear after passing through (approx 1 second to go 24 units)
    if (jumpscareInternalTimer >= 1.0) {
      if (scpSoloMesh) scpSoloMesh.visible = false;
      jumpscarePhase = 'idle';
      jumpscareTimer = 60 + Math.random() * 120; // Reset timer
    }
  }

  // 2. SCP FALLING OBJECT LOGIC
  if (!fallingObjectActive) {
    metalFallTimer -= deltaTime;
    if (metalFallTimer <= 0) {
      fallingObjectActive = true;
      metalFallTimer = 30 + Math.random() * 60;
      
      if (scpFallingMesh) {
        currentFallingObject = scpFallingMesh.clone();
        currentFallingObject.name = "falling_scp_instance"; // Set name for tracking
        const angle = Math.random() * Math.PI * 2;
        const dist = 3 + Math.random() * 5;
        currentFallingObject.position.set(
          player.position.x + Math.cos(angle) * dist,
          5.0, // Start high
          player.position.z + Math.sin(angle) * dist
        );
        scene.add(currentFallingObject);
        fallingVelocity = 0;
      }
    }
  } else if (currentFallingObject) {
    fallingVelocity += 9.8 * deltaTime; // Gravity
    currentFallingObject.position.y -= fallingVelocity * deltaTime;
    
    if (currentFallingObject.position.y <= 0.2) {
      currentFallingObject.position.y = 0.2;
      fallingObjectActive = false;
      
      // Play metal hit sound
      if (hitMetalBuffer) {
        const hitAudio = new THREE.Audio(audioListener);
        hitAudio.setBuffer(hitMetalBuffer);
        hitAudio.setVolume(0.8);
        hitAudio.play();
      }
      
      currentFallingObject = null;
    }
  }

  // 3. PERSISTENT FALLING OBJECT CLEANUP
  // Scan scene for falling objects and remove them if player is far away
  scene.children.forEach(child => {
    if (child.name === "falling_scp_instance") {
      const dist = player.position.distanceTo(child.position);
      if (dist > 35) { // Remove if player is more than 35 units away
        scene.remove(child);
      }
    }
  });
}

// --- AMBIENCE RANDOM PLAYBACK ---
let ambienceTimer = 0;
let ambienceInterval = 30 + Math.random() * 60;

function updateAmbienceSystem(deltaTime) {
  // console.log("Time Ambience:", ambienceInterval, "SCP:", jumpscarePhase, jumpscareTimer) // Debugging Console (Only For Debugging)
  if (gameState !== 'playing' || isMuted) return;
  ambienceTimer += deltaTime;
  if (ambienceTimer < ambienceInterval) return;
  ambienceTimer = 0;
  ambienceInterval = 30 + Math.random() * 60;

  if (ambienceBuffers.length === 0) return;
  const buf = ambienceBuffers[Math.floor(Math.random() * ambienceBuffers.length)];
  if (!buf) return;

  let px = player.position.x, pz = player.position.z;
  if (activeRooms.size > 0) {
    const pGX = Math.round(player.position.x / ROOM_SIZE);
    const pGZ = Math.round(player.position.z / ROOM_SIZE);
    const candidates = [];
    for (const key of activeRooms.keys()) {
      const [rx, rz] = key.split(',').map(Number);
      if (rx !== pGX || rz !== pGZ) candidates.push(key);
    }
    if (candidates.length > 0) {
      const key = candidates[Math.floor(Math.random() * candidates.length)];
      const [rx, rz] = key.split(',').map(Number);
      px = rx * ROOM_SIZE + (Math.random() - 0.5) * ROOM_SIZE * 0.7;
      pz = rz * ROOM_SIZE + (Math.random() - 0.5) * ROOM_SIZE * 0.7;
    } else {
      px += (Math.random() - 0.5) * 20;
      pz += (Math.random() - 0.5) * 20;
    }
  }

  const posAudio = new THREE.PositionalAudio(audioListener);
  posAudio.setBuffer(buf);
  posAudio.setRefDistance(12);
  posAudio.setRolloffFactor(0.8);
  posAudio.setVolume(2.4);
  posAudio.position.set(px, 1.5, pz);
  scene.add(posAudio);
  posAudio.play();
  posAudio.onEnded = () => scene.remove(posAudio);
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
      // Handcam rotation lag + tremor
      let yawDiff = yaw - smoothYaw;
      yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff));
      smoothYaw += yawDiff * 0.2;
      smoothPitch = THREE.MathUtils.lerp(smoothPitch, pitch, 0.2);
      cameraPivot.rotation.y = smoothYaw;
      // camera.rotation.x is now handled inside updateCameraShake for smoother blending
      // camera.rotation.y is also handled inside updateCameraShake for bodycam sway
      
      // Smooth zoom
      zoomFov = THREE.MathUtils.lerp(zoomFov, zoomTarget, 0.24);
      camera.fov = zoomFov;
      camera.updateProjectionMatrix();

      // --- DYNAMIC FLASHLIGHT ZOOM FIX ---
      const zoomRatio = (60 - zoomFov) / (60 - 12); // 0 at 60fov, 1 at 12fov
      flashlight.intensity = 8 + zoomRatio * 15; 
      flashlight.angle = (Math.PI / 3.8) * (1 - zoomRatio * 0.4);
      flashlight.distance = 35 + zoomRatio * 35;
      flashlight.penumbra = 0.6 + zoomRatio * 0.4;

      // Decay motion blur intensity
      lastMovementX *= 0.96;
      lastMovementY *= 0.96;
      updateFootstepAudioLogic(deltaTime);
      updateSCPManager(deltaTime);
      updateAmbienceSystem(deltaTime);
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