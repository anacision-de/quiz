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
const score = Math.max(0, Number(params.get("score") || 0));
const catalogId = params.get("catalog")?.trim() || "";
let maximumScore = 0;
let config = null;
let scoring = null;

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
  const resultColor = scoring?.color || "#333646";
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#fffdf2";
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#333646";
  context.fillRect(0, 0, width, 290);
  context.fillStyle = "#ffdd00";
  context.fillRect(0, 268, width, 22);

  context.textAlign = "center";
  context.fillStyle = "#ffdd00";
  context.font = "900 76px Lato, Arial, sans-serif";
  context.fillText("Urkunde", width / 2, 122);
  context.fillStyle = "#ffffff";
  context.font = "700 38px Lato, Arial, sans-serif";
  drawTextBlock(context, config?.title || "Quiz", width / 2, 190, 1120, 48, 2);

  context.fillStyle = "#333646";
  context.font = "400 40px Lato, Arial, sans-serif";
  context.fillText("Diese Urkunde wird verliehen an", width / 2, 430);

  context.fillStyle = "#333646";
  context.font = "900 104px Lato, Arial, sans-serif";
  drawTextBlock(context, name, width / 2, 560, 1120, 112, 2);

  context.fillStyle = resultColor;
  const resultBox = { x: 190, y: 780, width: 1020, height: 265 };
  roundedRect(context, resultBox.x, resultBox.y, resultBox.width, resultBox.height, 32);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "900 58px Lato, Arial, sans-serif";
  drawCenteredTextBlock(
    context,
    scoring?.title || "Ergebnis",
    width / 2,
    resultBox.y,
    resultBox.height,
    900,
    66,
    2,
  );

  context.fillStyle = "#333646";
  context.font = "900 58px Lato, Arial, sans-serif";
  context.fillText(`${score} von ${maximumScore} Punkten`, width / 2, 1160);

  context.fillStyle = "#676b7b";
  context.font = "400 40px Lato, Arial, sans-serif";
  drawTextBlock(context, scoring?.description || "", width / 2, 1280, 1060, 56, 5);

  context.strokeStyle = "#ffdd00";
  context.lineWidth = 18;
  context.beginPath();
  context.moveTo(220, 1610);
  context.lineTo(1180, 1610);
  context.stroke();

  context.fillStyle = "#333646";
  context.font = "700 32px Lato, Arial, sans-serif";
  context.fillText(`Ausgestellt am ${date}`, width / 2, 1690);
  context.font = "900 30px Lato, Arial, sans-serif";
  context.fillText("anacision", width / 2, 1765);

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

function roundedRect(drawContext, x, y, width, height, radius) {
  drawContext.beginPath();
  drawContext.moveTo(x + radius, y);
  drawContext.arcTo(x + width, y, x + width, y + height, radius);
  drawContext.arcTo(x + width, y + height, x, y + height, radius);
  drawContext.arcTo(x, y + height, x, y, radius);
  drawContext.arcTo(x, y, x + width, y, radius);
  drawContext.closePath();
}
