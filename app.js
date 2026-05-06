import {
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

const intro = document.querySelector("#intro");
const quiz = document.querySelector("#quiz");
const result = document.querySelector("#result");
const introTitle = document.querySelector("#intro-title");
const introDescription = document.querySelector("#intro-description");
const cameraNote = document.querySelector("#camera-note");
const prepareButton = document.querySelector("#prepare-button");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const recalibrateButton = document.querySelector("#recalibrate-button");
const progress = document.querySelector("#progress");
const questionText = document.querySelector("#question-text");
const timerValue = document.querySelector("#timer-value");
const answers = document.querySelector("#answers");
const feedback = document.querySelector("#feedback");
const video = document.querySelector("#camera-video");
const overlay = document.querySelector("#camera-overlay");
const overlayContext = overlay.getContext("2d", { willReadFrequently: false });
const analysisCanvas = document.querySelector("#analysis-canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const resultCard = document.querySelector("#result-card");
const resultScore = document.querySelector("#result-score");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultImage = document.querySelector("#result-image");

const state = {
  config: null,
  selectedQuestions: [],
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
  rafId: null,
  poseIntervalId: null,
  feedbackId: null,
  remaining: 0,
  acceptingAnswers: false,
  manualFallback: false,
  setupReady: false,
  setupInProgress: false,
};

const MODEL_ID = "Xenova/RTMO-t";
const ANALYSIS_WIDTH = 384;
const ANALYSIS_HEIGHT = 216;
const BOX_THRESHOLD = 0.28;
const POINT_THRESHOLD = 0.28;
const MIN_VISIBLE_KEYPOINTS = 5;
const POSE_INTERVAL_MS = 360;
const TRACK_SMOOTHING = 0.38;

init();

async function init() {
  try {
    const response = await fetch("questions.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`questions.json konnte nicht geladen werden (${response.status})`);
    }

    state.config = await response.json();
    introTitle.textContent = state.config.title || "Quiz";
    introDescription.textContent = state.config.description || "";
    prepareButton.disabled = false;
    cameraNote.textContent = "Kamera und Pose-Modell vor dem Start vorbereiten.";
  } catch (error) {
    introTitle.textContent = "Quiz konnte nicht geladen werden";
    introDescription.textContent = error.message;
    prepareButton.disabled = true;
    startButton.disabled = true;
  }
}

prepareButton.addEventListener("click", prepareExperience);
startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
recalibrateButton.addEventListener("click", async () => {
  state.trackedPerson = null;
});
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

window.addEventListener("resize", resizeOverlay);

async function prepareExperience() {
  if (state.setupInProgress || state.setupReady) {
    return;
  }

  state.setupInProgress = true;
  state.manualFallback = false;
  prepareButton.disabled = true;
  startButton.disabled = true;

  try {
    cameraNote.textContent = "Kamerafreigabe bestätigen ...";
    await ensureCamera();
    cameraNote.textContent = "Pose-Modell wird geladen ...";
    await ensurePoseModel();
    state.setupReady = true;
    cameraNote.textContent = "Bereit. Die nächste Schaltfläche startet direkt die erste Frage.";
    prepareButton.textContent = "Bereit";
    startButton.disabled = false;
  } catch (error) {
    state.manualFallback = true;
    state.setupReady = true;
    cameraNote.textContent = "Kamera oder Pose-Modell nicht verfügbar. Manuelle Antwortauswahl ist aktiv.";
    console.info(error);
    startButton.disabled = false;
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
  state.score = 0;
  state.currentIndex = 0;
  state.selectedAnswerIndex = null;
  state.acceptingAnswers = false;
  state.selectedQuestions = chooseQuestions(
    state.config.questions || [],
    state.config.numberOfQuestions || state.config.questions?.length || 0,
  );

  if (!state.selectedQuestions.length) {
    cameraNote.textContent = "Keine Fragen in questions.json gefunden.";
    return;
  }

  intro.classList.add("hidden");
  result.classList.add("hidden");
  quiz.classList.remove("hidden");
  feedback.classList.add("hidden");

  resizeOverlay();
  showQuestion();
  startRenderLoop();
  if (!state.manualFallback) {
    startPoseLoop();
  }
}

function chooseQuestions(questions, count) {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

async function ensureCamera() {
  if (state.stream) {
    return;
  }

  feedback.textContent = "Kamera wird gestartet ...";
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = state.stream;
  await video.play();
}

async function ensurePoseModel() {
  if (state.poseReady) {
    return;
  }

  env.allowLocalModels = false;
  feedback.textContent = "Pose-Modell wird geladen ...";
  feedback.classList.remove("hidden");

  state.poseModel = await AutoModel.from_pretrained(MODEL_ID, {
    dtype: "q8",
  });
  state.poseProcessor = await AutoProcessor.from_pretrained(MODEL_ID);
  state.poseReady = true;
  feedback.classList.add("hidden");
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

  state.remaining = Number(state.config.timeLimit || 10);
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
  answers.innerHTML = "";
  answers.style.gridTemplateColumns = `repeat(${options.length}, minmax(0, 1fr))`;

  for (const [index, option] of options.entries()) {
    const answer = document.createElement("article");
    answer.className = "answer";
    answer.dataset.index = String(index);
    answer.style.setProperty("--answer-color", option.color || "#555555");

    const label = document.createElement("div");
    label.className = "answer-label";
    label.textContent = option.value;
    answer.append(label);

    answers.append(answer);
  }
}

function updateTimer() {
  timerValue.textContent = `${Math.max(0, state.remaining)}s`;
}

function evaluateAnswer() {
  if (!state.acceptingAnswers) {
    return;
  }

  state.acceptingAnswers = false;
  resetTimers();

  const question = state.selectedQuestions[state.currentIndex];
  const correctIndex = question.options.findIndex((option) => option.correct);
  const pickedIndex = state.selectedAnswerIndex;
  const isCorrect = pickedIndex === correctIndex;

  if (isCorrect) {
    state.score += Number(question.points || 0);
  }

  for (const answer of answers.children) {
    const index = Number(answer.dataset.index);
    answer.classList.toggle("correct", index === correctIndex);
    answer.classList.toggle("wrong", pickedIndex !== null && index === pickedIndex && !isCorrect);
    answer.classList.toggle("selected", index === pickedIndex);
  }

  const points = Number(question.points || 0);
  feedback.textContent = isCorrect ? `Richtig +${points}` : "Leider falsch";
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
  state.acceptingAnswers = false;
  quiz.classList.add("hidden");
  result.classList.remove("hidden");

  const maximumScore = state.selectedQuestions.reduce(
    (total, question) => total + Number(question.points || 0),
    0,
  );
  const scoring = findScoringMessage(state.score);
  const resultColor = scoring?.color || "#111111";

  resultCard.style.borderColor = resultColor;
  resultCard.style.setProperty("--result-color", resultColor);
  resultScore.textContent = `${state.score} von ${maximumScore} Punkten`;
  resultTitle.textContent = scoring?.title || "Ergebnis";
  resultDescription.textContent = scoring?.description || "";
  resultImage.src = captureVideoFrame();
}

function findScoringMessage(score) {
  return (state.config.scoring || []).find((entry) => {
    return score >= Number(entry.min) && score <= Number(entry.max);
  });
}

function startRenderLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
  }

  const render = () => {
    drawCameraOverlay();
    updateSelectedAnswerFromPose();
    state.rafId = requestAnimationFrame(render);
  };

  render();
}

function startPoseLoop() {
  if (state.poseIntervalId) {
    clearInterval(state.poseIntervalId);
  }

  state.poseIntervalId = window.setInterval(() => {
    if (!state.acceptingAnswers || !state.poseReady || state.poseBusy) {
      return;
    }
    runPoseEstimation();
  }, POSE_INTERVAL_MS);

  runPoseEstimation();
}

function drawCameraOverlay() {
  if (!video.videoWidth || !video.videoHeight) {
    return;
  }

  const width = overlay.width;
  const height = overlay.height;
  overlayContext.clearRect(0, 0, width, height);
  overlayContext.save();
  overlayContext.globalAlpha = 0.32;
  overlayContext.translate(width, 0);
  overlayContext.scale(-1, 1);
  drawVideoCover(overlayContext, video, width, height);
  overlayContext.restore();

  if (state.selectedAnswerIndex !== null && state.acceptingAnswers) {
    const columnWidth = width / answers.children.length;
    const x = state.selectedAnswerIndex * columnWidth;
    overlayContext.save();
    overlayContext.globalAlpha = 0.18;
    overlayContext.fillStyle = "#ffffff";
    overlayContext.fillRect(x, 0, columnWidth, height);
    overlayContext.restore();
  }

  drawTrackedPose(width, height);
}

function updateSelectedAnswerFromPose() {
  const question = state.selectedQuestions[state.currentIndex];
  if (!question) {
    return;
  }

  if (!state.trackedPerson) {
    state.selectedAnswerIndex = null;
    updateSelectedAnswerClasses();
    return;
  }

  const optionCount = question.options.length;
  const selectedIndex = Math.min(optionCount - 1, Math.floor(state.trackedPerson.xRatio * optionCount));
  state.selectedAnswerIndex = selectedIndex;
  updateSelectedAnswerClasses();
}

async function runPoseEstimation() {
  if (!video.videoWidth || !video.videoHeight || !state.poseReady) {
    return;
  }

  state.poseBusy = true;
  try {
    drawAnalysisFrame();
    const image = RawImage.fromCanvas(analysisCanvas);
    const { pixel_values, original_sizes, reshaped_input_sizes } = await state.poseProcessor(image);
    const { dets, keypoints } = await state.poseModel({ input: pixel_values });
    const detections = parsePoseDetections(
      dets.tolist()[0],
      keypoints.tolist()[0],
      original_sizes[0],
      reshaped_input_sizes[0],
    );
    updateTrackedPerson(detections);
  } catch (error) {
    console.error(error);
  } finally {
    state.poseBusy = false;
  }
}

function parsePoseDetections(predictedBoxes, predictedPoints, originalSize, reshapedSize) {
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
    const keypoints = predictedPoints[index]
      .map(([x, y, score], pointIndex) => ({
        label: state.poseModel.config.id2label?.[pointIndex] || String(pointIndex),
        x: x * xScale,
        y: y * yScale,
        score,
      }))
      .filter((point) => point.score >= POINT_THRESHOLD);

    if (keypoints.length < MIN_VISIBLE_KEYPOINTS) {
      continue;
    }

    const keypointCenter = getKeypointCenter(keypoints);
    const boxWidth = Math.max(1, scaledBox.x2 - scaledBox.x1);
    const boxHeight = Math.max(1, scaledBox.y2 - scaledBox.y1);
    const area = boxWidth * boxHeight;
    detections.push({
      box: scaledBox,
      keypoints,
      xRatio: clamp(keypointCenter.x / width, 0, 1),
      yRatio: clamp(keypointCenter.y / height, 0, 1),
      area,
      score: boxScore,
      closeness: area * boxScore,
    });
  }

  return detections.sort((a, b) => b.closeness - a.closeness);
}

function updateTrackedPerson(detections) {
  if (!detections.length) {
    state.trackedPerson = null;
    return;
  }

  const closest = detections[0];
  if (!state.trackedPerson) {
    state.trackedPerson = closest;
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
}

function getKeypointCenter(keypoints) {
  const torsoNames = new Set(["left_shoulder", "right_shoulder", "left_hip", "right_hip"]);
  const torsoPoints = keypoints.filter((point) => torsoNames.has(point.label));
  const points = torsoPoints.length >= 2 ? torsoPoints : keypoints;
  const total = points.reduce(
    (sum, point) => {
      sum.x += point.x;
      sum.y += point.y;
      return sum;
    },
    { x: 0, y: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function drawTrackedPose(width, height) {
  if (!state.trackedPerson || !state.acceptingAnswers) {
    return;
  }

  const scaleX = width / ANALYSIS_WIDTH;
  const scaleY = height / ANALYSIS_HEIGHT;
  const { box, keypoints } = state.trackedPerson;

  overlayContext.save();
  overlayContext.globalAlpha = 0.86;
  overlayContext.strokeStyle = "#ffffff";
  overlayContext.lineWidth = 4;
  overlayContext.strokeRect(
    box.x1 * scaleX,
    box.y1 * scaleY,
    (box.x2 - box.x1) * scaleX,
    (box.y2 - box.y1) * scaleY,
  );
  overlayContext.fillStyle = "#ffffff";
  for (const point of keypoints) {
    overlayContext.beginPath();
    overlayContext.arc(point.x * scaleX, point.y * scaleY, 4, 0, Math.PI * 2);
    overlayContext.fill();
  }
  overlayContext.restore();
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

function captureVideoFrame() {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function resizeOverlay() {
  const rect = quiz.getBoundingClientRect();
  const answerRect = answers.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  overlay.width = Math.max(1, Math.round(rect.width * pixelRatio));
  overlay.height = Math.max(1, Math.round(answerRect.height * pixelRatio));
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${answerRect.height}px`;
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
