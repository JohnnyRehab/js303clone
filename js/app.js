const state = {
  waveform: "sawtooth",
  accentEnabled: true,
  holdEnabled: false,
  activePcOctave: 3,
  latchedNote: null,
  demo: {
    bpm: 126,
    name: "Factory Floor",
    steps: []
  },
  params: {
    cutoff: 900,
    resonance: 7.5,
    envMod: 1800,
    decay: 0.72,
    accent: 0.45,
    glide: 0.09,
    drive: 0.38,
    tuning: 0
  }
};

const DEFAULT_DEMO = {
  name: "Factory Floor",
  bpm: 126,
  waveform: "sawtooth",
  params: {
    cutoff: 1180,
    resonance: 9.2,
    envMod: 2120,
    decay: 0.48,
    accent: 0.58,
    glide: 0.11,
    drive: 0.46,
    tuning: 0
  },
  steps: [
    { note: 36, gate: true, accent: true, slide: false },
    { note: 36, gate: true, accent: false, slide: false },
    { note: 43, gate: true, accent: false, slide: true },
    { note: 46, gate: true, accent: true, slide: false },
    { note: null, gate: false, accent: false, slide: false },
    { note: 34, gate: true, accent: false, slide: false },
    { note: 36, gate: true, accent: false, slide: true },
    { note: 43, gate: true, accent: true, slide: false },
    { note: 48, gate: true, accent: true, slide: false },
    { note: 46, gate: true, accent: false, slide: true },
    { note: 43, gate: true, accent: false, slide: false },
    { note: 36, gate: true, accent: true, slide: false },
    { note: null, gate: false, accent: false, slide: false },
    { note: 34, gate: true, accent: false, slide: false },
    { note: 31, gate: true, accent: false, slide: true },
    { note: 36, gate: true, accent: true, slide: false }
  ]
};

const noteLabels = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keyboardElement = document.getElementById("keyboard");
const audioStatus = document.getElementById("audio-status");
const octaveStatus = document.getElementById("octave-status");
const activateAudioButton = document.getElementById("activate-audio");
const holdToggle = document.getElementById("hold-toggle");
const accentToggle = document.getElementById("accent-toggle");
const panicButton = document.getElementById("panic-button");
const loadDemoButton = document.getElementById("load-demo");
const playDemoButton = document.getElementById("play-demo");
const stopDemoButton = document.getElementById("stop-demo");
const exportDemoButton = document.getElementById("export-demo");
const importDemoButton = document.getElementById("import-demo");
const demoStepsElement = document.getElementById("demo-steps");
const demoDataElement = document.getElementById("demo-data");
const demoStatusElement = document.getElementById("demo-status");
const oscilloscopeCanvas = document.getElementById("oscilloscope");
const oscilloscopeContext = oscilloscopeCanvas.getContext("2d");
const waveformButtons = [...document.querySelectorAll(".wave-button")];
const knobs = [...document.querySelectorAll(".knob")];
const outputs = new Map(
  [...document.querySelectorAll("[data-output-for]")].map((node) => [node.dataset.outputFor, node])
);

const pcKeyLayout = [
  { key: "a", semitone: 0, label: "A" },
  { key: "w", semitone: 1, label: "W" },
  { key: "s", semitone: 2, label: "S" },
  { key: "e", semitone: 3, label: "E" },
  { key: "d", semitone: 4, label: "D" },
  { key: "f", semitone: 5, label: "F" },
  { key: "t", semitone: 6, label: "T" },
  { key: "g", semitone: 7, label: "G" },
  { key: "y", semitone: 8, label: "Y" },
  { key: "h", semitone: 9, label: "H" },
  { key: "u", semitone: 10, label: "U" },
  { key: "j", semitone: 11, label: "J" }
];

const heldPcKeys = new Map();
const heldPointerNotes = new Set();
const activeNoteElements = new Map();

let synthEngine = null;
let scopeAnimationFrame = 0;
let demoTimer = 0;
let demoReleaseTimer = 0;
let demoStepIndex = -1;
let demoPlaying = false;

class AcidSynth {
  constructor() {
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.output = this.context.createGain();
    this.master = this.context.createGain();
    this.preDrive = this.context.createGain();
    this.filter = this.context.createBiquadFilter();
    this.postFilter = this.context.createBiquadFilter();
    this.drive = this.context.createWaveShaper();
    this.vca = this.context.createGain();
    this.oscillator = this.context.createOscillator();
    this.analyser = this.context.createAnalyser();

    this.oscillator.type = state.waveform;
    this.oscillator.frequency.value = 220;
    this.filter.type = "lowpass";
    this.filter.Q.value = state.params.resonance;
    this.postFilter.type = "highpass";
    this.postFilter.frequency.value = 25;
    this.preDrive.gain.value = 1.2;
    this.vca.gain.value = 0;
    this.master.gain.value = 0.58;
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    this.oscillator.connect(this.preDrive);
    this.preDrive.connect(this.filter);
    this.filter.connect(this.drive);
    this.drive.connect(this.postFilter);
    this.postFilter.connect(this.vca);
    this.vca.connect(this.master);
    this.master.connect(this.output);
    this.output.connect(this.analyser);
    this.output.connect(this.context.destination);

    this.lastNote = null;
    this.oscillator.start();

    this.applySettings();
  }

  static makeDriveCurve(amount) {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const drive = 1 + amount * 18;

    for (let index = 0; index < samples; index += 1) {
      const x = (index / (samples - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * drive);
    }

    return curve;
  }

  applySettings() {
    this.oscillator.type = state.waveform;
    this.filter.frequency.setTargetAtTime(Math.max(70, state.params.cutoff), this.context.currentTime, 0.03);
    this.filter.Q.setTargetAtTime(state.params.resonance, this.context.currentTime, 0.02);
    this.drive.curve = AcidSynth.makeDriveCurve(state.params.drive);
    this.drive.oversample = "4x";
  }

  ensureRunning() {
    if (this.context.state !== "running") {
      return this.context.resume().then(() => {
        audioStatus.textContent = "Audio awake";
      });
    }

    audioStatus.textContent = "Audio awake";
    return Promise.resolve();
  }

  playNote(midiNote, options = {}) {
    const { accented = false } = options;
    const now = this.context.currentTime;
    const tunedMidi = midiNote + state.params.tuning;
    const targetFrequency = 440 * Math.pow(2, (tunedMidi - 69) / 12);
    const glideTime = this.lastNote === null ? 0.005 : Math.max(0.005, state.params.glide);
    const baseCutoff = state.params.cutoff;
    const envelopePeak = Math.min(12000, baseCutoff + state.params.envMod * (accented ? 1.4 : 1));
    const decayTime = Math.max(0.05, state.params.decay);
    const attackGain = accented && state.accentEnabled ? 0.44 + state.params.accent * 0.3 : 0.32;
    const sustainGain = accented && state.accentEnabled ? 0.16 + state.params.accent * 0.08 : 0.11;

    this.oscillator.frequency.cancelScheduledValues(now);
    this.filter.frequency.cancelScheduledValues(now);
    this.vca.gain.cancelScheduledValues(now);

    this.oscillator.frequency.setTargetAtTime(targetFrequency, now, glideTime / 3);
    this.filter.frequency.setValueAtTime(Math.max(80, baseCutoff * 0.8), now);
    this.filter.frequency.linearRampToValueAtTime(envelopePeak, now + 0.01);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(70, baseCutoff), now + decayTime);

    this.vca.gain.setValueAtTime(Math.max(0.0001, this.vca.gain.value), now);
    this.vca.gain.linearRampToValueAtTime(attackGain, now + 0.005);
    this.vca.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainGain), now + decayTime);

    this.lastNote = midiNote;
  }

  releaseNote() {
    const now = this.context.currentTime;
    this.vca.gain.cancelScheduledValues(now);
    this.vca.gain.setValueAtTime(Math.max(0.0001, this.vca.gain.value), now);
    this.vca.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  }

  panic() {
    this.lastNote = null;
    const now = this.context.currentTime;
    this.vca.gain.cancelScheduledValues(now);
    this.vca.gain.setValueAtTime(0.0001, now);
  }
}

function drawOscilloscopeIdle() {
  const { width, height } = oscilloscopeCanvas;

  oscilloscopeContext.clearRect(0, 0, width, height);
  oscilloscopeContext.fillStyle = "#0d1212";
  oscilloscopeContext.fillRect(0, 0, width, height);

  oscilloscopeContext.strokeStyle = "rgba(255, 208, 110, 0.08)";
  oscilloscopeContext.lineWidth = 1;

  for (let x = 0; x < width; x += 48) {
    oscilloscopeContext.beginPath();
    oscilloscopeContext.moveTo(x + 0.5, 0);
    oscilloscopeContext.lineTo(x + 0.5, height);
    oscilloscopeContext.stroke();
  }

  for (let y = 0; y < height; y += 36) {
    oscilloscopeContext.beginPath();
    oscilloscopeContext.moveTo(0, y + 0.5);
    oscilloscopeContext.lineTo(width, y + 0.5);
    oscilloscopeContext.stroke();
  }

  oscilloscopeContext.strokeStyle = "rgba(255, 215, 120, 0.2)";
  oscilloscopeContext.beginPath();
  oscilloscopeContext.moveTo(0, height / 2);
  oscilloscopeContext.lineTo(width, height / 2);
  oscilloscopeContext.stroke();

  oscilloscopeContext.fillStyle = "rgba(255, 235, 181, 0.55)";
  oscilloscopeContext.font = '16px "Avenir Next Condensed", "Futura", sans-serif';
  oscilloscopeContext.fillText("Activate audio to start the scope", 24, 30);
}

function cloneDemoData(data) {
  return {
    name: data.name,
    bpm: data.bpm,
    waveform: data.waveform,
    params: { ...data.params },
    steps: data.steps.map((step) => ({ ...step }))
  };
}

function startOscilloscope() {
  if (!synthEngine || scopeAnimationFrame) {
    return;
  }

  const buffer = new Uint8Array(synthEngine.analyser.fftSize);

  const render = () => {
    const { width, height } = oscilloscopeCanvas;
    synthEngine.analyser.getByteTimeDomainData(buffer);

    oscilloscopeContext.clearRect(0, 0, width, height);
    oscilloscopeContext.fillStyle = "#0d1212";
    oscilloscopeContext.fillRect(0, 0, width, height);

    oscilloscopeContext.strokeStyle = "rgba(255, 208, 110, 0.08)";
    oscilloscopeContext.lineWidth = 1;

    for (let x = 0; x < width; x += 48) {
      oscilloscopeContext.beginPath();
      oscilloscopeContext.moveTo(x + 0.5, 0);
      oscilloscopeContext.lineTo(x + 0.5, height);
      oscilloscopeContext.stroke();
    }

    for (let y = 0; y < height; y += 36) {
      oscilloscopeContext.beginPath();
      oscilloscopeContext.moveTo(0, y + 0.5);
      oscilloscopeContext.lineTo(width, y + 0.5);
      oscilloscopeContext.stroke();
    }

    oscilloscopeContext.strokeStyle = "rgba(255, 215, 120, 0.22)";
    oscilloscopeContext.beginPath();
    oscilloscopeContext.moveTo(0, height / 2);
    oscilloscopeContext.lineTo(width, height / 2);
    oscilloscopeContext.stroke();

    oscilloscopeContext.strokeStyle = "#ffd56a";
    oscilloscopeContext.lineWidth = 2.2;
    oscilloscopeContext.beginPath();

    for (let index = 0; index < buffer.length; index += 1) {
      const x = (index / (buffer.length - 1)) * width;
      const y = (buffer[index] / 255) * height;

      if (index === 0) {
        oscilloscopeContext.moveTo(x, y);
      } else {
        oscilloscopeContext.lineTo(x, y);
      }
    }

    oscilloscopeContext.stroke();
    scopeAnimationFrame = window.requestAnimationFrame(render);
  };

  scopeAnimationFrame = window.requestAnimationFrame(render);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setDemoStatus(message) {
  demoStatusElement.innerHTML = `<span class="status-pill">${message}</span>`;
}

function formatValue(param, value) {
  switch (param) {
    case "cutoff":
    case "envMod":
      return `${Math.round(value)} Hz`;
    case "decay":
      return `${value.toFixed(2)} s`;
    case "accent":
    case "drive":
      return `${Math.round(value * 100)}%`;
    case "glide":
      return `${Math.round(value * 1000)} ms`;
    case "tuning":
      return `${value.toFixed(1)} st`;
    default:
      return `${value.toFixed(1)}`;
  }
}

function updateKnobUI(knob) {
  const value = Number(knob.dataset.value);
  const min = Number(knob.dataset.min);
  const max = Number(knob.dataset.max);
  const ratio = (value - min) / (max - min);
  const rotation = -132 + ratio * 264;
  const output = outputs.get(knob.dataset.param);

  knob.style.setProperty("--rotation", `${rotation}deg`);

  if (output) {
    output.textContent = formatValue(knob.dataset.param, value);
  }
}

function setParam(param, value) {
  state.params[param] = value;
  const knob = knobs.find((candidate) => candidate.dataset.param === param);

  if (knob) {
    knob.dataset.value = String(value);
    updateKnobUI(knob);
  }

  if (synthEngine) {
    synthEngine.applySettings();
  }

  exportCurrentDemoData();
}

function applyPerformanceSettings() {
  Object.entries(state.params).forEach(([param, value]) => {
    const knob = knobs.find((candidate) => candidate.dataset.param === param);

    if (knob) {
      knob.dataset.value = String(value);
      updateKnobUI(knob);
    }
  });

  waveformButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.waveform === state.waveform);
  });

  if (synthEngine) {
    synthEngine.applySettings();
  }
}

function setupKnobs() {
  knobs.forEach((knob) => {
    updateKnobUI(knob);

    knob.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startValue = Number(knob.dataset.value);
      const min = Number(knob.dataset.min);
      const max = Number(knob.dataset.max);
      const step = Number(knob.dataset.step);
      const scale = (max - min) / 180;

      knob.setPointerCapture(event.pointerId);

      const onPointerMove = (moveEvent) => {
        const delta = startY - moveEvent.clientY;
        const rawValue = clamp(startValue + delta * scale, min, max);
        const snappedValue = Math.round(rawValue / step) * step;
        setParam(knob.dataset.param, Number(snappedValue.toFixed(4)));
      };

      const release = () => {
        knob.removeEventListener("pointermove", onPointerMove);
        knob.removeEventListener("pointerup", release);
        knob.removeEventListener("pointercancel", release);
      };

      knob.addEventListener("pointermove", onPointerMove);
      knob.addEventListener("pointerup", release);
      knob.addEventListener("pointercancel", release);
    });
  });
}

function midiToLabel(midiNote) {
  const note = noteLabels[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1;
  return `${note}${octave}`;
}

function buildKeyboard() {
  const whiteOffsets = [0, 2, 4, 5, 7, 9, 11];
  const blackOffsets = [1, 3, 6, 8, 10];
  const whiteIndexForOffset = new Map([
    [0, 0],
    [2, 1],
    [4, 2],
    [5, 3],
    [7, 4],
    [9, 5],
    [11, 6]
  ]);
  const blackLeftMap = new Map([
    [1, 40],
    [3, 100],
    [6, 220],
    [8, 280],
    [10, 340]
  ]);

  for (let octave = 2; octave <= 4; octave += 1) {
    const octaveOffset = (octave - 2) * 420;

    whiteOffsets.forEach((offset) => {
      const midiNote = (octave + 1) * 12 + offset;
      const key = document.createElement("button");
      key.className = "white-key";
      key.type = "button";
      key.dataset.note = String(midiNote);
      key.dataset.octave = String(octave);
      key.style.left = `${16 + octaveOffset + whiteIndexForOffset.get(offset) * 60}px`;
      key.innerHTML = `<span class="key-note">${midiToLabel(midiNote)}</span>`;
      keyboardElement.appendChild(key);
      activeNoteElements.set(midiNote, key);
    });

    blackOffsets.forEach((offset) => {
      const midiNote = (octave + 1) * 12 + offset;
      const key = document.createElement("button");
      key.className = "black-key";
      key.type = "button";
      key.dataset.note = String(midiNote);
      key.dataset.octave = String(octave);
      key.style.left = `${16 + octaveOffset + blackLeftMap.get(offset)}px`;
      key.innerHTML = `<span class="key-note">${midiToLabel(midiNote)}</span>`;
      keyboardElement.appendChild(key);
      activeNoteElements.set(midiNote, key);
    });
  }

  refreshPcLabels();

  keyboardElement.querySelectorAll("button").forEach((key) => {
    const note = Number(key.dataset.note);

    key.addEventListener("pointerdown", async (event) => {
      event.preventDefault();
      stopDemoPlayback(false);
      heldPointerNotes.add(note);
      await ensureSynth();
      activateNote(note, "pointer");
      key.setPointerCapture(event.pointerId);
    });

    const pointerRelease = () => {
      heldPointerNotes.delete(note);
      deactivateNote(note, "pointer");
    };

    key.addEventListener("pointerup", pointerRelease);
    key.addEventListener("pointercancel", pointerRelease);
    key.addEventListener("lostpointercapture", pointerRelease);
  });
}

function renderDemoSteps(activeIndex = -1) {
  demoStepsElement.innerHTML = "";

  state.demo.steps.forEach((step, index) => {
    const cell = document.createElement("div");
    const flags = [];

    cell.className = "demo-step";
    if (!step.gate || step.note === null) {
      cell.classList.add("is-rest");
    }
    if (index === activeIndex) {
      cell.classList.add("active");
    }
    if (step.accent) {
      flags.push("ACC");
    }
    if (step.slide) {
      flags.push("SLD");
    }
    if (!step.gate || step.note === null) {
      flags.push("RST");
    }

    cell.innerHTML = `
      <span class="demo-step-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="demo-step-note">${step.note === null ? "--" : midiToLabel(step.note)}</span>
      <span class="demo-step-flags">${flags.join(" ")}</span>
    `;
    demoStepsElement.appendChild(cell);
  });
}

function exportCurrentDemoData() {
  const exportPayload = {
    name: state.demo.name,
    bpm: state.demo.bpm,
    waveform: state.waveform,
    params: { ...state.params },
    steps: state.demo.steps.map((step) => ({ ...step }))
  };

  demoDataElement.value = JSON.stringify(exportPayload, null, 2);
}

function validateDemoData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Demo data must be a JSON object.");
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error("Demo data must include a non-empty steps array.");
  }

  return {
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Imported Demo",
    bpm: clamp(Number(data.bpm) || 126, 60, 180),
    waveform: data.waveform === "square" ? "square" : "sawtooth",
    params: {
      cutoff: clamp(Number(data.params?.cutoff) || 900, 180, 4200),
      resonance: clamp(Number(data.params?.resonance) || 7.5, 0.4, 16),
      envMod: clamp(Number(data.params?.envMod) || 1800, 80, 4200),
      decay: clamp(Number(data.params?.decay) || 0.72, 0.12, 1.8),
      accent: clamp(Number(data.params?.accent) || 0.45, 0, 1),
      glide: clamp(Number(data.params?.glide) || 0.09, 0, 0.35),
      drive: clamp(Number(data.params?.drive) || 0.38, 0, 1),
      tuning: clamp(Number(data.params?.tuning) || 0, -12, 12)
    },
    steps: data.steps.slice(0, 32).map((step) => ({
      note: step.note === null || step.note === undefined ? null : clamp(Math.round(Number(step.note) || 36), 24, 72),
      gate: Boolean(step.gate),
      accent: Boolean(step.accent),
      slide: Boolean(step.slide)
    }))
  };
}

function loadDemoData(data, reason = "Demo loaded") {
  state.demo = cloneDemoData(data);
  state.waveform = state.demo.waveform;
  state.params = { ...state.demo.params };
  applyPerformanceSettings();
  renderDemoSteps();
  exportCurrentDemoData();
  setDemoStatus(`${reason}: ${state.demo.name} at ${state.demo.bpm} BPM`);
}

function clearDemoTimers() {
  if (demoTimer) {
    window.clearTimeout(demoTimer);
    demoTimer = 0;
  }
  if (demoReleaseTimer) {
    window.clearTimeout(demoReleaseTimer);
    demoReleaseTimer = 0;
  }
}

function stopDemoPlayback(manual = true) {
  demoPlaying = false;
  demoStepIndex = -1;
  clearDemoTimers();
  renderDemoSteps();
  if (synthEngine) {
    synthEngine.releaseNote();
  }
  if (manual) {
    setDemoStatus(`Demo stopped: ${state.demo.name}`);
  }
}

function scheduleDemoStep() {
  if (!demoPlaying || !state.demo.steps.length) {
    return;
  }

  demoStepIndex = (demoStepIndex + 1) % state.demo.steps.length;
  const step = state.demo.steps[demoStepIndex];
  const stepDuration = 60 / state.demo.bpm / 4;

  renderDemoSteps(demoStepIndex);

  if (step.gate && step.note !== null) {
    activateVisual(step.note);
    synthEngine.playNote(step.note, { accented: step.accent });

    if (!step.slide) {
      demoReleaseTimer = window.setTimeout(() => {
        deactivateVisual(step.note);
        if (demoPlaying) {
          synthEngine.releaseNote();
        }
      }, stepDuration * 760);
    }
  } else if (synthEngine) {
    synthEngine.releaseNote();
  }

  demoTimer = window.setTimeout(() => {
    if (step.note !== null) {
      deactivateVisual(step.note);
    }
    scheduleDemoStep();
  }, stepDuration * 1000);
}

async function startDemoPlayback() {
  await ensureSynth();
  stopDemoPlayback(false);
  clearHeldNotes();
  demoPlaying = true;
  demoStepIndex = -1;
  setDemoStatus(`Playing demo: ${state.demo.name}`);
  scheduleDemoStep();
}

function refreshPcLabels() {
  keyboardElement.querySelectorAll(".key-label").forEach((label) => label.remove());
  keyboardElement.querySelectorAll(".key-octave-active").forEach((node) => node.classList.remove("key-octave-active"));

  const activeOctave = state.activePcOctave;

  pcKeyLayout.forEach((mapping) => {
    const midiNote = (activeOctave + 1) * 12 + mapping.semitone;
    const target = activeNoteElements.get(midiNote);

    if (target) {
      const label = document.createElement("span");
      label.className = "key-label";
      label.textContent = mapping.label;
      target.appendChild(label);
      target.classList.add("key-octave-active");
    }
  });

  octaveStatus.textContent = `PC octave: ${activeOctave}`;
}

function activateVisual(note) {
  const element = activeNoteElements.get(note);

  if (element) {
    element.classList.add("active");
  }
}

function deactivateVisual(note) {
  const element = activeNoteElements.get(note);

  if (element) {
    element.classList.remove("active");
  }
}

function getLatestHeldNote() {
  const pcNotes = [...heldPcKeys.values()];
  const pointerNotes = [...heldPointerNotes.values()];
  const allNotes = [...pcNotes, ...pointerNotes];
  return allNotes.length ? allNotes[allNotes.length - 1] : null;
}

function activateNote(note, source) {
  if (state.latchedNote !== null && state.latchedNote !== note) {
    deactivateVisual(state.latchedNote);
    state.latchedNote = null;
  }

  activateVisual(note);

  if (synthEngine) {
    synthEngine.playNote(note, { accented: state.accentEnabled });
  }

  if (source === "pointer") {
    return;
  }
}

function deactivateNote(note, source) {
  if (source === "pointer" && heldPointerNotes.has(note)) {
    return;
  }

  if (source === "pc" && heldPcKeysHasValue(note)) {
    return;
  }

  const fallbackNote = getLatestHeldNote();

  if (fallbackNote !== null && fallbackNote !== note) {
    deactivateVisual(note);
    activateVisual(fallbackNote);

    if (synthEngine) {
      synthEngine.playNote(fallbackNote, { accented: state.accentEnabled });
    }

    return;
  }

  if (state.holdEnabled) {
    state.latchedNote = note;
    return;
  }

  deactivateVisual(note);

  if (synthEngine) {
    synthEngine.releaseNote();
  }
}

function heldPcKeysHasValue(note) {
  for (const value of heldPcKeys.values()) {
    if (value === note) {
      return true;
    }
  }

  return false;
}

async function ensureSynth() {
  if (!synthEngine) {
    synthEngine = new AcidSynth();
  }

  await synthEngine.ensureRunning();
  startOscilloscope();
}

function clearHeldNotes() {
  heldPcKeys.clear();
  heldPointerNotes.clear();
  state.latchedNote = null;
  activeNoteElements.forEach((element) => element.classList.remove("active"));

  if (synthEngine) {
    synthEngine.panic();
  }
}

function setupButtons() {
  activateAudioButton.addEventListener("click", async () => {
    await ensureSynth();
  });

  holdToggle.addEventListener("click", () => {
    state.holdEnabled = !state.holdEnabled;
    holdToggle.classList.toggle("active", state.holdEnabled);
    holdToggle.setAttribute("aria-pressed", String(state.holdEnabled));

    if (!state.holdEnabled) {
      state.latchedNote = null;

      if (heldPcKeys.size === 0 && heldPointerNotes.size === 0 && synthEngine) {
        synthEngine.releaseNote();
        activeNoteElements.forEach((element) => element.classList.remove("active"));
      }
    }
  });

  accentToggle.addEventListener("click", () => {
    state.accentEnabled = !state.accentEnabled;
    accentToggle.classList.toggle("active", state.accentEnabled);
    accentToggle.setAttribute("aria-pressed", String(state.accentEnabled));
  });

  panicButton.addEventListener("click", clearHeldNotes);

  loadDemoButton.addEventListener("click", () => {
    stopDemoPlayback(false);
    loadDemoData(cloneDemoData(DEFAULT_DEMO), "Showcase loaded");
  });

  playDemoButton.addEventListener("click", async () => {
    await startDemoPlayback();
  });

  stopDemoButton.addEventListener("click", () => {
    stopDemoPlayback();
  });

  exportDemoButton.addEventListener("click", () => {
    exportCurrentDemoData();
    demoDataElement.focus();
    demoDataElement.select();
    setDemoStatus(`Exported demo JSON: ${state.demo.name}`);
  });

  importDemoButton.addEventListener("click", () => {
    try {
      stopDemoPlayback(false);
      const parsed = JSON.parse(demoDataElement.value);
      const validated = validateDemoData(parsed);
      loadDemoData(validated, "Imported demo");
    } catch (error) {
      setDemoStatus(error.message);
    }
  });

  waveformButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      stopDemoPlayback(false);
      waveformButtons.forEach((candidate) => candidate.classList.remove("active"));
      button.classList.add("active");
      state.waveform = button.dataset.waveform;
      await ensureSynth();
      synthEngine.applySettings();
      exportCurrentDemoData();
    });
  });
}

function setupPcKeyboard() {
  document.addEventListener("keydown", async (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "z") {
      state.activePcOctave = clamp(state.activePcOctave - 1, 2, 4);
      refreshPcLabels();
      return;
    }

    if (key === "x") {
      state.activePcOctave = clamp(state.activePcOctave + 1, 2, 4);
      refreshPcLabels();
      return;
    }

    const mapping = pcKeyLayout.find((candidate) => candidate.key === key);

    if (!mapping) {
      return;
    }

    event.preventDefault();
    const note = (state.activePcOctave + 1) * 12 + mapping.semitone;

    stopDemoPlayback(false);
    heldPcKeys.set(key, note);
    await ensureSynth();
    activateNote(note, "pc");
  });

  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    const note = heldPcKeys.get(key);

    if (note === undefined) {
      return;
    }

    heldPcKeys.delete(key);
    deactivateNote(note, "pc");
  });

  window.addEventListener("blur", clearHeldNotes);
}

setupKnobs();
buildKeyboard();
setupButtons();
setupPcKeyboard();
drawOscilloscopeIdle();
loadDemoData(cloneDemoData(DEFAULT_DEMO));
