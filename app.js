import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "./vendor/transformers/transformers.min.js";

const intro = document.querySelector("#intro");
const quiz = document.querySelector("#quiz");
const result = document.querySelector("#result");
const introTitle = document.querySelector("#intro-title");
const introDescription = document.querySelector("#intro-description");
const introActions = document.querySelector("#intro-actions");
const catalogLinks = document.querySelector("#catalog-links");
const cameraNote = document.querySelector("#camera-note");
const prepareButton = document.querySelector("#prepare-button");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const progress = document.querySelector("#progress");
const questionText = document.querySelector("#question-text");
const timer = document.querySelector("#timer");
const timerValue = document.querySelector("#timer-value");
const answers = document.querySelector("#answers");
const feedback = document.querySelector("#feedback");
const video = document.querySelector("#camera-video");
const analysisCanvas = document.querySelector("#analysis-canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const resultCard = document.querySelector("#result-card");
const resultScore = document.querySelector("#result-score");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const certificateQr = document.querySelector("#certificate-qr");
const certificateQrContext = certificateQr.getContext("2d");
const certificateQrNote = document.querySelector("#certificate-qr-note");
const certificateLink = document.querySelector("#certificate-link");
const confettiCanvas = document.querySelector("#confetti-canvas");
const confettiContext = confettiCanvas.getContext("2d");

const state = {
  config: null,
  selectedQuestions: [],
  displayedOptions: [],
  currentIndex: 0,
  score: 0,
  selectedAnswerIndex: null,
  stream: null,
  poseModel: null,
  poseProcessor: null,
  poseBusy: false,
  poseReady: false,
  trackedPerson: null,
  timerId: null,
  poseIntervalId: null,
  poseLoopActive: false,
  modelReleaseTimerId: null,
  missedDetections: 0,
  feedbackId: null,
  confettiRafId: null,
  remaining: 0,
  timeLimit: 0,
  acceptingAnswers: false,
  manualFallback: false,
  setupReady: false,
  setupInProgress: false,
  catalogId: null,
};

const MODEL_ID = "Xenova/RTMO-t";
const CATALOG_MANIFEST_PATH = "catalogs/catalogs.json";
const LOCAL_MODEL_PATH = new URL("./models/", window.location.href).href;
const LOCAL_WASM_PATH = new URL("./vendor/transformers/", window.location.href).href;
const ANALYSIS_WIDTH = 256;
const ANALYSIS_HEIGHT = 144;
const BOX_THRESHOLD = 0.01;
const MAX_MISSED_DETECTIONS = 8;
const POSE_INTERVAL_MS = 300;
const TRACK_SMOOTHING = 0.55;
const MODEL_IDLE_RELEASE_MS = 45000;

init();

async function init() {
  try {
    const manifest = await loadCatalogManifest();
    const catalogId = getRequestedCatalogId();
    if (!catalogId) {
      showCatalogParameterMessage(manifest);
      return;
    }

    const catalog = findCatalog(manifest, catalogId);
    if (!catalog) {
      showCatalogParameterMessage(manifest, catalogId);
      return;
    }

    const response = await fetch(`catalogs/${catalog.file}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Fragenkatalog "${catalogId}" konnte nicht geladen werden (${response.status})`);
    }

    state.config = await response.json();
    state.catalogId = catalog.id;
    introTitle.textContent = state.config.title || "Quiz";
    introDescription.textContent = state.config.description || "";
    catalogLinks.classList.add("hidden");
    introActions.classList.remove("hidden");
    prepareButton.disabled = false;
    cameraNote.textContent = "Kamera und Pose-Modell vor dem Start vorbereiten.";
  } catch (error) {
    introTitle.textContent = "Quiz konnte nicht geladen werden";
    introDescription.textContent = error.message;
    prepareButton.disabled = true;
    startButton.disabled = true;
  }
}

async function loadCatalogManifest() {
  const response = await fetch(CATALOG_MANIFEST_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Kein gültiger Fragenkatalog gesetzt. Bitte URL-Parameter ?catalog=<name> verwenden.");
  }
  return response.json();
}

function getRequestedCatalogId() {
  return new URLSearchParams(window.location.search).get("catalog")?.trim() || "";
}

function findCatalog(manifest, requestedCatalogId) {
  const normalized = normalizeCatalogId(requestedCatalogId);
  return (manifest.catalogs || []).find((catalog) => {
    return normalizeCatalogId(catalog.id) === normalized || normalizeCatalogId(catalog.file) === normalized;
  });
}

function normalizeCatalogId(value) {
  return String(value || "").replace(/\.json$/i, "").toLowerCase();
}

function showCatalogParameterMessage(manifest, invalidCatalogId = "") {
  const catalogs = manifest?.catalogs || [];
  introTitle.textContent = invalidCatalogId
    ? "Fragenkatalog nicht gefunden"
    : "Fragenkatalog auswählen";
  introDescription.textContent = catalogs.length
    ? "Bitte einen Fragenkatalog auswählen."
    : "Bitte einen gültigen URL-Parameter ?catalog=<name> setzen.";
  cameraNote.textContent = invalidCatalogId ? `Unbekannter Katalog: ${invalidCatalogId}` : "";
  introActions.classList.add("hidden");
  renderCatalogLinks(catalogs);
  prepareButton.disabled = true;
  startButton.disabled = true;
}

function renderCatalogLinks(catalogs) {
  catalogLinks.innerHTML = "";
  if (!catalogs.length) {
    catalogLinks.classList.add("hidden");
    return;
  }

  for (const catalog of catalogs) {
    const link = document.createElement("a");
    const url = new URL(window.location.href);
    url.searchParams.set("catalog", catalog.id);
    link.href = url.href;
    link.textContent = catalog.title || catalog.id;
    catalogLinks.append(link);
  }

  catalogLinks.classList.remove("hidden");
}

prepareButton.addEventListener("click", prepareExperience);
startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", showIntro);
window.addEventListener("pagehide", releaseRealtimeResources);
document.addEventListener("visibilitychange", handleVisibilityChange);
answers.addEventListener("click", (event) => {
  const answer = event.target.closest(".answer");
  if (!answer || !state.acceptingAnswers) {
    return;
  }

  state.selectedAnswerIndex = Number(answer.dataset.index);
  updateSelectedAnswerClasses();
});

window.addEventListener("keydown", (event) => {
  if (!state.acceptingAnswers) {
    return;
  }

  const index = Number(event.key) - 1;
  const answerCount = answers.children.length;
  if (Number.isInteger(index) && index >= 0 && index < answerCount) {
    state.selectedAnswerIndex = index;
    updateSelectedAnswerClasses();
  }
});

async function prepareExperience() {
  if (state.setupInProgress || state.setupReady) {
    return;
  }

  state.setupInProgress = true;
  state.manualFallback = false;
  cancelModelRelease();
  prepareButton.disabled = true;
  startButton.disabled = true;

  try {
    cameraNote.textContent = "Kamerafreigabe bestätigen ...";
    await ensureCamera();
    cameraNote.textContent = "Pose-Modell wird geladen ...";
    try {
      await ensurePoseModel();
      state.manualFallback = false;
      cameraNote.textContent = "Bereit. Die nächste Schaltfläche startet direkt die erste Frage.";
    } catch (poseError) {
      state.manualFallback = true;
      cameraNote.textContent = "Kamera bereit. Pose-Modell nicht verfügbar, Antworten können angeklickt werden.";
      console.info(poseError);
    }
    state.setupReady = true;
    prepareButton.textContent = "Bereit";
    startButton.disabled = false;
  } catch (error) {
    state.manualFallback = true;
    state.setupReady = false;
    cameraNote.textContent = "Kamera nicht verfügbar. Bitte Browser-Berechtigung prüfen und erneut versuchen.";
    console.info(error);
    prepareButton.disabled = false;
    prepareButton.textContent = "Kamera vorbereiten";
  } finally {
    state.setupInProgress = false;
  }
}

async function startGame() {
  if (!state.setupReady) {
    await prepareExperience();
  }

  if (!state.setupReady) {
    return;
  }

  resetTimers();
  stopConfetti();
  cancelModelRelease();
  state.score = 0;
  state.currentIndex = 0;
  state.selectedAnswerIndex = null;
  state.trackedPerson = null;
  state.missedDetections = 0;
  state.acceptingAnswers = false;
  state.selectedQuestions = chooseQuestions(
    state.config.questions || [],
    state.config.numberOfQuestions || state.config.questions?.length || 0,
  );

  if (!state.selectedQuestions.length) {
    cameraNote.textContent = "Keine Fragen im ausgewählten Katalog gefunden.";
    return;
  }

  intro.classList.add("hidden");
  result.classList.add("hidden");
  quiz.classList.remove("hidden");
  feedback.classList.add("hidden");

  showQuestion();
  if (!state.manualFallback) {
    startPoseLoop();
  }
}

function showIntro() {
  resetTimers();
  stopPoseLoop();
  stopConfetti();
  scheduleModelRelease();
  state.acceptingAnswers = false;
  state.selectedAnswerIndex = null;
  state.trackedPerson = null;
  state.missedDetections = 0;
  quiz.classList.add("hidden");
  result.classList.add("hidden");
  intro.classList.remove("hidden");
  feedback.classList.add("hidden");

  if (state.setupReady) {
    prepareButton.disabled = true;
    prepareButton.textContent = "Bereit";
    startButton.disabled = false;
    cameraNote.textContent = state.manualFallback
      ? "Kamera bereit. Pose-Modell nicht verfügbar, Antworten können angeklickt werden."
      : "Bereit. Die nächste Schaltfläche startet direkt die erste Frage.";
  }
}

function chooseQuestions(questions, count) {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

async function ensureCamera() {
  if (state.stream) {
    video.classList.add("active");
    return;
  }

  feedback.textContent = "Kamera wird gestartet ...";
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 426, max: 640 },
      height: { ideal: 240, max: 360 },
      frameRate: { ideal: 15, max: 24 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = state.stream;
  video.classList.add("active");
  await new Promise((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
    } else {
      video.onloadedmetadata = () => resolve();
    }
  });
  await video.play();
}

async function ensurePoseModel() {
  if (state.poseReady) {
    return;
  }

  env.localModelPath = LOCAL_MODEL_PATH;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = LOCAL_WASM_PATH;
  }
  feedback.textContent = "Pose-Modell wird geladen ...";
  feedback.classList.remove("hidden");

  state.poseModel = await loadPoseModel();
  state.poseProcessor = await AutoProcessor.from_pretrained(MODEL_ID);
  state.poseReady = true;
  feedback.classList.add("hidden");
}

async function loadPoseModel() {
  const devices = navigator.gpu ? ["wasm", "webgpu"] : ["wasm"];
  const attempts = devices.flatMap((device) => [
    { device, dtype: "q8" },
    { device },
  ]);

  let lastError = null;
  for (const options of attempts) {
    try {
      return await AutoModel.from_pretrained(MODEL_ID, options);
    } catch (error) {
      lastError = error;
      console.info("Pose model loading attempt failed.", options, error);
    }
  }

  throw lastError || new Error("Pose model could not be loaded.");
}

function showCameraFallback(error) {
  feedback.textContent = "Kamera oder Pose-Modell nicht verfügbar: Antwort anklicken";
  feedback.classList.remove("hidden");
  console.info(error);
}

function showQuestion() {
  resetTimers();
  state.acceptingAnswers = true;
  state.selectedAnswerIndex = null;
  if (state.manualFallback) {
    feedback.textContent = "Kamera oder Pose-Modell nicht verfügbar: Antwort anklicken";
    feedback.classList.remove("hidden");
  } else {
    feedback.classList.add("hidden");
  }

  const question = state.selectedQuestions[state.currentIndex];
  progress.textContent = `Frage ${state.currentIndex + 1} von ${state.selectedQuestions.length}`;
  questionText.textContent = question.question;
  renderAnswers(question.options);

  state.timeLimit = Number(state.config.timeLimit || 10);
  state.remaining = state.timeLimit;
  updateTimer();
  state.timerId = window.setInterval(() => {
    state.remaining -= 1;
    updateTimer();
    if (state.remaining <= 0) {
      evaluateAnswer();
    }
  }, 1000);
}

function renderAnswers(options) {
  state.displayedOptions = shuffleOptions(options);
  answers.innerHTML = "";
  answers.style.gridTemplateColumns = `repeat(${state.displayedOptions.length}, minmax(0, 1fr))`;

  for (const [index, option] of state.displayedOptions.entries()) {
    const answer = document.createElement("article");
    answer.className = "answer";
    answer.dataset.index = String(index);
    answer.style.setProperty("--answer-color", getAnswerColor(option, index));

    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = option.value;
    answer.append(label);

    answers.append(answer);
  }
}

function shuffleOptions(options) {
  const shuffled = [...options];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function getAnswerColor(option, index) {
  return state.config?.answerColors?.[index] || option.color || "#555555";
}

function updateTimer() {
  const remaining = Math.max(0, state.remaining);
  const progressRatio = state.timeLimit ? remaining / state.timeLimit : 0;
  timerValue.textContent = `${remaining}s`;
  timer.style.setProperty("--timer-progress", String(progressRatio));
}

function evaluateAnswer() {
  if (!state.acceptingAnswers) {
    return;
  }

  state.acceptingAnswers = false;
  resetTimers();

  const correctIndex = state.displayedOptions.findIndex((option) => option.correct);
  const pickedIndex = state.selectedAnswerIndex;
  const isCorrect = pickedIndex === correctIndex;

  if (isCorrect) {
    state.score += 1;
  }

  for (const answer of answers.children) {
    const index = Number(answer.dataset.index);
    answer.classList.toggle("correct", index === correctIndex);
    answer.classList.toggle("wrong", pickedIndex !== null && index === pickedIndex && !isCorrect);
    answer.classList.toggle("selected", index === pickedIndex);
  }

  feedback.textContent = isCorrect ? "Richtig +1" : "Leider falsch";
  feedback.classList.remove("hidden");

  state.feedbackId = window.setTimeout(() => {
    state.currentIndex += 1;
    if (state.currentIndex >= state.selectedQuestions.length) {
      showResult();
    } else {
      showQuestion();
    }
  }, 2100);
}

function showResult() {
  resetTimers();
  stopPoseLoop();
  scheduleModelRelease();
  state.acceptingAnswers = false;
  quiz.classList.add("hidden");
  result.classList.remove("hidden");

  const maximumScore = state.selectedQuestions.length;
  const scoring = findScoringMessage(state.score);
  const resultColor = scoring?.color || "#111111";
  const certificateUrl = buildCertificateUrl(state.score);

  resultCard.style.borderColor = resultColor;
  resultCard.style.setProperty("--result-color", resultColor);
  resultScore.textContent = `${state.score} von ${maximumScore} Punkten`;
  resultTitle.textContent = scoring?.title || "Ergebnis";
  resultDescription.textContent = scoring?.description || "";
  certificateLink.href = certificateUrl;
  renderCertificateQr(certificateUrl, "QR-Code scannen und Urkunde auf dem eigenen Gerät erstellen.");
  startConfetti();
}

function findScoringMessage(score) {
  return (state.config.scoring || []).find((entry) => {
    return score >= Number(entry.min) && score <= Number(entry.max);
  });
}

function startPoseLoop() {
  stopPoseLoop();
  state.poseLoopActive = true;
  runPoseLoopTick();
}

function stopPoseLoop() {
  if (state.poseIntervalId) {
    clearTimeout(state.poseIntervalId);
    state.poseIntervalId = null;
  }
  state.poseLoopActive = false;
}

async function runPoseLoopTick() {
  if (!state.poseLoopActive) {
    return;
  }

  if (state.acceptingAnswers && state.poseReady && !state.poseBusy) {
    await runPoseEstimation();
  }

  if (state.poseLoopActive) {
    state.poseIntervalId = window.setTimeout(runPoseLoopTick, POSE_INTERVAL_MS);
  }
}

function updateSelectedAnswerFromPose() {
  const optionCount = state.displayedOptions.length;
  if (!optionCount) {
    return;
  }

  if (!state.trackedPerson) {
    state.selectedAnswerIndex = null;
    updateSelectedAnswerClasses();
    return;
  }

  const selectedIndex = Math.min(optionCount - 1, Math.floor(state.trackedPerson.xRatio * optionCount));
  state.selectedAnswerIndex = selectedIndex;
  updateSelectedAnswerClasses();
}

async function runPoseEstimation() {
  if (!video.videoWidth || !video.videoHeight || !state.poseReady) {
    return;
  }

  state.poseBusy = true;
  let processed = null;
  let output = null;
  try {
    drawAnalysisFrame();
    const image = RawImage.fromCanvas(analysisCanvas);
    processed = await state.poseProcessor(image);
    const { pixel_values, original_sizes, reshaped_input_sizes } = processed;
    output = await state.poseModel({ input: pixel_values });
    const { dets } = output;
    const detections = parsePoseDetections(
      dets.tolist()[0],
      original_sizes[0],
      reshaped_input_sizes[0],
    );
    updateTrackedPerson(detections);
  } catch (error) {
    console.error(error);
  } finally {
    disposeModelArtifacts(output);
    disposeModelArtifacts(processed);
    state.poseBusy = false;
  }
}

function parsePoseDetections(predictedBoxes, originalSize, reshapedSize) {
  const [height, width] = originalSize;
  const [resizedHeight, resizedWidth] = reshapedSize;
  const xScale = width / resizedWidth;
  const yScale = height / resizedHeight;
  const detections = [];

  for (let index = 0; index < predictedBoxes.length; index += 1) {
    const [xmin, ymin, xmax, ymax, boxScore] = predictedBoxes[index];
    if (boxScore < BOX_THRESHOLD) {
      continue;
    }

    const scaledBox = {
      x1: clamp(xmin * xScale, 0, width),
      y1: clamp(ymin * yScale, 0, height),
      x2: clamp(xmax * xScale, 0, width),
      y2: clamp(ymax * yScale, 0, height),
      score: boxScore,
    };
    const boxWidth = Math.max(1, scaledBox.x2 - scaledBox.x1);
    const boxHeight = Math.max(1, scaledBox.y2 - scaledBox.y1);
    const centerX = scaledBox.x1 + boxWidth / 2;
    const centerY = scaledBox.y1 + boxHeight / 2;
    const area = boxWidth * boxHeight;
    detections.push({
      box: scaledBox,
      xRatio: clamp(centerX / width, 0, 1),
      yRatio: clamp(centerY / height, 0, 1),
      area,
      score: boxScore,
      closeness: area * boxScore,
    });
  }

  return detections.sort((a, b) => b.closeness - a.closeness);
}

function updateTrackedPerson(detections) {
  if (!detections.length) {
    state.missedDetections += 1;
    if (state.missedDetections >= MAX_MISSED_DETECTIONS) {
      state.trackedPerson = null;
    }
    updateSelectedAnswerFromPose();
    return;
  }

  state.missedDetections = 0;
  const closest = detections[0];
  if (!state.trackedPerson) {
    state.trackedPerson = closest;
    updateSelectedAnswerFromPose();
    return;
  }

  state.trackedPerson = {
    ...closest,
    xRatio: lerp(state.trackedPerson.xRatio, closest.xRatio, TRACK_SMOOTHING),
    yRatio: lerp(state.trackedPerson.yRatio, closest.yRatio, TRACK_SMOOTHING),
    area: lerp(state.trackedPerson.area, closest.area, TRACK_SMOOTHING),
    box: {
      x1: lerp(state.trackedPerson.box.x1, closest.box.x1, TRACK_SMOOTHING),
      y1: lerp(state.trackedPerson.box.y1, closest.box.y1, TRACK_SMOOTHING),
      x2: lerp(state.trackedPerson.box.x2, closest.box.x2, TRACK_SMOOTHING),
      y2: lerp(state.trackedPerson.box.y2, closest.box.y2, TRACK_SMOOTHING),
      score: closest.box.score,
    },
  };
  updateSelectedAnswerFromPose();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function updateSelectedAnswerClasses() {
  for (const answer of answers.children) {
    answer.classList.toggle("selected", Number(answer.dataset.index) === state.selectedAnswerIndex);
  }
}

function drawAnalysisFrame() {
  if (analysisCanvas.width !== ANALYSIS_WIDTH) {
    analysisCanvas.width = ANALYSIS_WIDTH;
    analysisCanvas.height = ANALYSIS_HEIGHT;
  }

  analysisContext.save();
  analysisContext.translate(ANALYSIS_WIDTH, 0);
  analysisContext.scale(-1, 1);
  drawVideoCover(analysisContext, video, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  analysisContext.restore();
}

function drawVideoCover(context, source, width, height) {
  const sourceWidth = source.videoWidth;
  const sourceHeight = source.videoHeight;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(source, x, y, drawWidth, drawHeight);
}

function buildCertificateUrl(score) {
  const url = new URL("certificate.html", window.location.href);
  if (state.catalogId) {
    url.searchParams.set("catalog", state.catalogId);
  }
  url.searchParams.set("score", String(score));
  return url.href;
}

function renderCertificateQr(payload, note) {
  const qr = createQr(payload);
  if (!qr) {
    clearCertificateQr("Die Urkunde ist zu groß für einen einzelnen QR-Code.");
    return;
  }

  const modules = qr.getModuleCount();
  const size = 336;
  const quiet = 4;
  const scale = Math.floor(size / (modules + quiet * 2));
  const actualSize = (modules + quiet * 2) * scale;

  certificateQr.width = actualSize;
  certificateQr.height = actualSize;
  certificateQrContext.fillStyle = "#ffffff";
  certificateQrContext.fillRect(0, 0, actualSize, actualSize);
  certificateQrContext.fillStyle = "#333646";

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (qr.isDark(row, col)) {
        certificateQrContext.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }
  }

  certificateQrNote.textContent = note;
}

function clearCertificateQr(note) {
  certificateQr.width = 336;
  certificateQr.height = 336;
  certificateQrContext.fillStyle = "#ffffff";
  certificateQrContext.fillRect(0, 0, certificateQr.width, certificateQr.height);
  certificateQrNote.textContent = note;
}

function createQr(payload) {
  if (!payload || !window.qrcode) {
    return null;
  }

  try {
    const qr = window.qrcode(0, "L");
    qr.addData(payload);
    qr.make();
    return qr;
  } catch {
    return null;
  }
}

function startConfetti() {
  stopConfetti();

  const colors = ["#ffdd00", "#333646", "#4da72e", "#e97131", "#c00000", "#ffffff"];
  const rect = result.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  const gravity = 0.16 * pixelRatio;
  const startedAt = performance.now();
  const spawnDuration = 1800;
  const particles = Array.from({ length: 170 }, () => ({
    x: Math.random() * width,
    y: -height * (0.08 + Math.random() * 0.75),
    size: (5 + Math.random() * 9) * pixelRatio,
    color: colors[Math.floor(Math.random() * colors.length)],
    velocityX: (-3 + Math.random() * 6) * pixelRatio,
    velocityY: (2 + Math.random() * 5) * pixelRatio,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: -0.18 + Math.random() * 0.36,
    sway: Math.random() * Math.PI * 2,
  }));

  confettiCanvas.width = width;
  confettiCanvas.height = height;
  confettiCanvas.classList.add("active");

  const draw = (now) => {
    const elapsed = now - startedAt;
    let visibleParticles = 0;
    confettiContext.clearRect(0, 0, width, height);

    for (const particle of particles) {
      particle.sway += 0.05;
      particle.x += particle.velocityX + Math.sin(particle.sway) * 1.2 * pixelRatio;
      particle.y += particle.velocityY;
      particle.velocityY += gravity;
      particle.rotation += particle.rotationSpeed;

      if (particle.y > height + 40 * pixelRatio && elapsed < spawnDuration) {
        particle.y = -40 * pixelRatio;
        particle.x = Math.random() * width;
        particle.velocityY = (2 + Math.random() * 4) * pixelRatio;
      }

      if (particle.y <= height + 40 * pixelRatio) {
        visibleParticles += 1;
      }

      confettiContext.save();
      confettiContext.translate(particle.x, particle.y);
      confettiContext.rotate(particle.rotation);
      confettiContext.fillStyle = particle.color;
      confettiContext.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.62);
      confettiContext.restore();
    }

    if (visibleParticles > 0) {
      state.confettiRafId = requestAnimationFrame(draw);
    } else {
      stopConfetti();
    }
  };

  state.confettiRafId = requestAnimationFrame(draw);
}

function stopConfetti() {
  if (state.confettiRafId) {
    cancelAnimationFrame(state.confettiRafId);
    state.confettiRafId = null;
  }

  if (confettiCanvas) {
    confettiContext.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiCanvas.classList.remove("active");
  }
}

function scheduleModelRelease() {
  cancelModelRelease();
  state.modelReleaseTimerId = window.setTimeout(() => {
    releaseRealtimeResources();
  }, MODEL_IDLE_RELEASE_MS);
}

function cancelModelRelease() {
  if (state.modelReleaseTimerId) {
    clearTimeout(state.modelReleaseTimerId);
    state.modelReleaseTimerId = null;
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    pauseRealtimeForHiddenTab();
  } else {
    resumeRealtimeForVisibleTab();
  }
}

function pauseRealtimeForHiddenTab() {
  stopPoseLoop();
  stopCamera();
  releaseAnalysisCanvas();

  if (quiz.classList.contains("hidden")) {
    releaseRealtimeResources();
  }
}

async function resumeRealtimeForVisibleTab() {
  if (quiz.classList.contains("hidden") || state.manualFallback || !state.poseReady || state.stream) {
    return;
  }

  try {
    await ensureCamera();
    if (state.acceptingAnswers) {
      feedback.classList.add("hidden");
      startPoseLoop();
    }
  } catch (error) {
    showCameraFallback(error);
  }
}

function releaseRealtimeResources() {
  cancelModelRelease();
  stopPoseLoop();
  stopCamera();
  releasePoseModel();
  releaseAnalysisCanvas();
  state.setupReady = false;
  state.setupInProgress = false;
  state.poseBusy = false;
  state.trackedPerson = null;
  state.missedDetections = 0;

  if (!quiz.classList.contains("hidden")) {
    state.manualFallback = true;
    feedback.textContent = "Kamera pausiert: Antwort anklicken";
    feedback.classList.remove("hidden");
    return;
  }

  prepareButton.disabled = false;
  prepareButton.textContent = "Kamera vorbereiten";
  startButton.disabled = true;
  if (state.config) {
    cameraNote.textContent = "Kamera und Pose-Modell vor dem Start vorbereiten.";
  }
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }

  video.pause();
  video.removeAttribute("src");
  video.srcObject = null;
  video.load();
  video.classList.remove("active");
}

function releasePoseModel() {
  disposeModelArtifact(state.poseModel);
  disposeModelArtifact(state.poseProcessor);
  state.poseModel = null;
  state.poseProcessor = null;
  state.poseReady = false;
}

function releaseAnalysisCanvas() {
  if (analysisCanvas.width || analysisCanvas.height) {
    analysisContext.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
    analysisCanvas.width = 0;
    analysisCanvas.height = 0;
  }
}

function disposeModelArtifacts(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return;
  }

  seen.add(value);
  disposeModelArtifact(value);

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return;
  }

  let children = [];
  try {
    children = Object.values(value);
  } catch {
    return;
  }

  for (const child of children) {
    disposeModelArtifacts(child, seen);
  }
}

function disposeModelArtifact(value) {
  if (value && typeof value.dispose === "function") {
    try {
      value.dispose();
    } catch {
      // Best-effort cleanup for tensors and runtime sessions owned by Transformers.js.
    }
  }
}

function resetTimers() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  if (state.feedbackId) {
    clearTimeout(state.feedbackId);
    state.feedbackId = null;
  }
}
