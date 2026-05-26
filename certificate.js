const kicker = document.querySelector("#certificate-kicker");
const summary = document.querySelector("#certificate-summary");
const form = document.querySelector("#certificate-form");
const nameInput = document.querySelector("#player-name");
const downloadLink = document.querySelector("#download-link");
const image = document.querySelector("#certificate-image");
const canvas = document.querySelector("#certificate-canvas");
const context = canvas.getContext("2d");

const params = new URLSearchParams(window.location.search);
const CATALOG_MANIFEST_PATH = "catalogs/catalogs.json";
const CERTIFICATE_BACKGROUND_PATH = "assets/certificate-background.svg";
const score = Math.max(0, Number(params.get("score") || 0));
const catalogId = params.get("catalog")?.trim() || "";
let maximumScore = 0;
let config = null;
let scoring = null;
let backgroundImagePromise = null;

initCertificate();

async function initCertificate() {
  try {
    const manifest = await loadCatalogManifest();
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

    config = await response.json();
    maximumScore = calculateMaximumScore(config);
    scoring = findScoringMessage(score, config.scoring || []);
    renderText();
    await renderCertificate("Ihr Name");
  } catch (error) {
    kicker.textContent = "Urkunde";
    summary.textContent = error.message;
  }
}

async function loadCatalogManifest() {
  const response = await fetch(CATALOG_MANIFEST_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Kein gültiger Fragenkatalog gesetzt. Bitte URL-Parameter ?catalog=<name> verwenden.");
  }
  return response.json();
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
  const options = (manifest?.catalogs || [])
    .map((catalog) => `?catalog=${catalog.id}`)
    .join(", ");
  kicker.textContent = invalidCatalogId ? "Fragenkatalog nicht gefunden" : "Fragenkatalog auswählen";
  summary.textContent = options
    ? `Bitte einen gültigen URL-Parameter setzen. Verfügbare Optionen: ${options}`
    : "Bitte einen gültigen URL-Parameter ?catalog=<name> setzen.";
  form.classList.add("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  await renderCertificate(name);
  downloadLink.classList.remove("hidden");
});

function renderText() {
  kicker.textContent = config.title || "Quiz";
  summary.textContent = `${score} von ${maximumScore} Punkten: ${scoring?.title || "Ergebnis"}`;
}

async function renderCertificate(name) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const width = 1400;
  const height = 1900;
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());
  const resultBox = { x: 244, y: 830, width: 972, height: 279 };
  const resultColor = scoring?.color || "#0b642c";

  canvas.width = width;
  canvas.height = height;
  await drawCertificateBackground(context, width, height);

  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.shadowColor = "rgba(255, 194, 0, 0.38)";
  context.shadowBlur = 16;
  const titleGradient = context.createLinearGradient(410, 190, 990, 190);
  titleGradient.addColorStop(0, "#ffb000");
  titleGradient.addColorStop(0.5, "#ffe24a");
  titleGradient.addColorStop(1, "#ffb000");
  context.fillStyle = titleGradient;
  context.font = "900 138px Lato, sans-serif";
  context.fillText("URKUNDE", width / 2, 355);

  context.shadowColor = "rgba(0, 0, 0, 0.48)";
  context.shadowBlur = 6;
  context.fillStyle = "#ffffff";
  context.font = "400 41px Lato, sans-serif";
  drawTextBlock(context, config?.title || "Quiz", width / 2, 418, 1100, 50, 2);

  context.shadowBlur = 0;
  context.fillStyle = "#ffffff";
  context.font = "400 39px Lato, sans-serif";
  context.fillText("Diese Urkunde wird verliehen an", width / 2, 575);

  context.shadowColor = "rgba(0, 0, 0, 0.62)";
  context.shadowBlur = 10;
  context.fillStyle = "#ffffff";
  context.font = `900 ${fitFontSize(context, name, 122, 860, "900")}px Lato, sans-serif`;
  drawTextBlock(context, name, width / 2, 715, 1060, 118, 2);

  drawResultPanel(context, resultBox, resultColor);

  context.shadowBlur = 0;
  context.fillStyle = "#ffffff";
  context.font = `900 ${fitFontSize(context, scoring?.title || "Ergebnis", 68, 760, "900")}px Lato, sans-serif`;
  drawCenteredTextBlock(
    context,
    scoring?.title || "Ergebnis",
    width / 2,
    resultBox.y,
    resultBox.height,
    820,
    76,
    2,
  );

  drawStars(context, width / 2, 1180, Math.round(score), maximumScore);

  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 6;
  context.fillStyle = "#ffffff";
  context.font = "900 66px Lato, sans-serif";
  context.fillText(`${score} von ${maximumScore} Punkten`, width / 2, 1276);

  context.fillStyle = "#ffffff";
  context.font = "400 39px Lato, sans-serif";
  drawTextBlock(context, scoring?.description || "", width / 2, 1342, 860, 51, 4);

  context.shadowBlur = 0;
  drawDateIcon(context, 565, 1590);

  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "400 34px Lato, sans-serif";
  context.fillText("Ausgestellt am", 675, 1574);
  context.fillStyle = "#ffdd00";
  context.font = "900 36px Lato, sans-serif";
  context.fillText(date, 675, 1628);

  context.textAlign = "center";
  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(0, 0, 0, 0.45)";
  context.shadowBlur = 5;
  context.font = "400 31px Lato, sans-serif";
  context.fillText("anacision.de", width / 2, 1747);
  context.shadowBlur = 0;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  image.src = dataUrl;
  downloadLink.href = dataUrl;
}

function calculateMaximumScore(quizConfig) {
  const questions = quizConfig.questions || [];
  return Math.min(Number(quizConfig.numberOfQuestions || questions.length), questions.length);
}

function findScoringMessage(resultScore, scoringEntries) {
  return scoringEntries.find((entry) => {
    return resultScore >= Number(entry.min) && resultScore <= Number(entry.max);
  });
}

async function drawCertificateBackground(drawContext, width, height) {
  drawContext.fillStyle = "#02101f";
  drawContext.fillRect(0, 0, width, height);

  try {
    const background = await loadCertificateBackground();
    drawContext.drawImage(background, 0, 0, width, height);
  } catch {
    drawContext.fillStyle = "#031c31";
    drawContext.fillRect(0, 0, width, height);
    drawContext.strokeStyle = "#ffdd00";
    drawContext.lineWidth = 4;
    drawContext.strokeRect(32, 32, width - 64, height - 64);
  }
}

function loadCertificateBackground() {
  if (!backgroundImagePromise) {
    backgroundImagePromise = new Promise((resolve, reject) => {
      const background = new Image();
      background.onload = () => resolve(background);
      background.onerror = reject;
      background.src = CERTIFICATE_BACKGROUND_PATH;
    });
  }
  return backgroundImagePromise;
}

function drawResultPanel(drawContext, box, color) {
  drawContext.save();
  const gradient = drawContext.createLinearGradient(box.x, box.y, box.x + box.width, box.y);
  gradient.addColorStop(0, mixColor(color, "#001521", 0.48));
  gradient.addColorStop(0.5, color);
  gradient.addColorStop(1, mixColor(color, "#001521", 0.52));

  drawContext.globalAlpha = 0.86;
  drawContext.fillStyle = gradient;
  angularPanelPath(drawContext, box.x, box.y, box.width, box.height);
  drawContext.fill();

  drawContext.globalAlpha = 0.22;
  drawContext.fillStyle = "#ffffff";
  drawContext.fillRect(box.x + 78, box.y + 26, box.width - 156, 3);
  drawContext.globalAlpha = 1;
  drawContext.restore();
}

function angularPanelPath(drawContext, x, y, width, height) {
  const notch = 46;
  drawContext.beginPath();
  drawContext.moveTo(x + notch, y);
  drawContext.lineTo(x + width * 0.29, y);
  drawContext.lineTo(x + width * 0.31, y + 18);
  drawContext.lineTo(x + width * 0.72, y + 18);
  drawContext.lineTo(x + width * 0.74, y);
  drawContext.lineTo(x + width - notch, y);
  drawContext.lineTo(x + width, y + notch);
  drawContext.lineTo(x + width, y + height - notch);
  drawContext.lineTo(x + width - notch, y + height);
  drawContext.lineTo(x + width * 0.74, y + height);
  drawContext.lineTo(x + width * 0.72, y + height - 18);
  drawContext.lineTo(x + width * 0.28, y + height - 18);
  drawContext.lineTo(x + width * 0.26, y + height);
  drawContext.lineTo(x + notch, y + height);
  drawContext.lineTo(x, y + height - notch);
  drawContext.lineTo(x, y + notch);
  drawContext.closePath();
}

function mixColor(color, target, targetWeight) {
  const sourceRgb = hexToRgb(color) || hexToRgb("#0b642c");
  const targetRgb = hexToRgb(target);
  const mixed = sourceRgb.map((channel, index) => {
    return Math.round(channel * (1 - targetWeight) + targetRgb[index] * targetWeight);
  });
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function hexToRgb(color) {
  const match = String(color || "").trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) {
    return null;
  }
  return match.slice(1).map((value) => parseInt(value, 16));
}

function drawTextBlock(drawContext, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const lines = wrapText(drawContext, text, maxWidth).slice(0, maxLines);
  for (const [index, value] of lines.entries()) {
    drawContext.fillText(value, x, y + index * lineHeight);
  }
}

function drawCenteredTextBlock(drawContext, text, x, boxY, boxHeight, maxWidth, lineHeight, maxLines = 3) {
  const lines = wrapText(drawContext, text, maxWidth).slice(0, maxLines);
  const metrics = drawContext.measureText("Mg");
  const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const blockHeight = textHeight + (lines.length - 1) * lineHeight;
  const firstBaseline = boxY + (boxHeight - blockHeight) / 2 + metrics.actualBoundingBoxAscent;

  for (const [index, value] of lines.entries()) {
    drawContext.fillText(value, x, firstBaseline + index * lineHeight);
  }
}

function wrapText(drawContext, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (drawContext.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

function fitFontSize(drawContext, text, initialSize, maxWidth, weight = "900", minSize = 44) {
  let size = initialSize;
  while (size > minSize) {
    drawContext.font = `${weight} ${size}px Lato, sans-serif`;
    const lines = wrapText(drawContext, text, maxWidth);
    const widestLine = Math.max(...lines.map((line) => drawContext.measureText(line).width), 0);
    if (widestLine <= maxWidth && lines.length <= 2) {
      return size;
    }
    size -= 2;
  }
  return minSize;
}

function drawStars(drawContext, centerX, centerY, earned, total) {
  const starCount = Math.max(1, Math.min(total || 5, 5));
  const gap = 70;
  const startX = centerX - ((starCount - 1) * gap) / 2;

  drawContext.save();
  drawContext.shadowColor = "rgba(255, 210, 0, 0.6)";
  drawContext.shadowBlur = 8;
  for (let index = 0; index < starCount; index += 1) {
    drawContext.fillStyle = index < earned ? "#ffc400" : "rgba(255, 255, 255, 0.24)";
    drawStar(drawContext, startX + index * gap, centerY, 24, 10, 5);
  }
  drawContext.restore();
}

function drawStar(drawContext, x, y, outerRadius, innerRadius, points) {
  drawContext.beginPath();
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const pointX = x + Math.cos(angle) * radius;
    const pointY = y + Math.sin(angle) * radius;
    if (index === 0) {
      drawContext.moveTo(pointX, pointY);
    } else {
      drawContext.lineTo(pointX, pointY);
    }
  }
  drawContext.closePath();
  drawContext.fill();
}

function drawDateIcon(drawContext, x, y) {
  drawContext.save();
  drawContext.strokeStyle = "#ffdd00";
  drawContext.lineWidth = 5;
  drawContext.shadowColor = "rgba(255, 221, 0, 0.45)";
  drawContext.shadowBlur = 8;
  drawContext.beginPath();
  drawContext.arc(x, y, 62, 0, Math.PI * 2);
  drawContext.stroke();

  drawContext.shadowBlur = 0;
  drawContext.strokeRect(x - 29, y - 22, 58, 50);
  drawContext.beginPath();
  drawContext.moveTo(x - 29, y - 8);
  drawContext.lineTo(x + 29, y - 8);
  drawContext.moveTo(x - 16, y - 34);
  drawContext.lineTo(x - 16, y - 14);
  drawContext.moveTo(x + 16, y - 34);
  drawContext.lineTo(x + 16, y - 14);
  drawContext.stroke();

  drawContext.fillStyle = "#ffdd00";
  for (const dotY of [4, 18]) {
    for (const dotX of [-16, 0, 16]) {
      drawContext.fillRect(x + dotX - 3, y + dotY - 3, 6, 6);
    }
  }
  drawContext.restore();
}

function roundedRect(drawContext, x, y, width, height, radius) {
  drawContext.beginPath();
  drawContext.moveTo(x + radius, y);
  drawContext.arcTo(x + width, y, x + width, y + height, radius);
  drawContext.arcTo(x + width, y + height, x, y + height, radius);
  drawContext.arcTo(x, y + height, x, y, radius);
  drawContext.arcTo(x, y, x + width, y, radius);
  drawContext.closePath();
}
