const elements = {
  videoInput: document.getElementById("videoInput"),
  videoDrop: document.getElementById("videoDrop"),
  videoName: document.getElementById("videoName"),
  uploadWarning: document.getElementById("uploadWarning"),
  videoState: document.getElementById("videoState"),
  videoPreview: document.getElementById("videoPreview"),
  captureCanvas: document.getElementById("captureCanvas"),
  captureBtn: document.getElementById("captureBtn"),
  frameStrip: document.getElementById("frameStrip"),
  transcriptInput: document.getElementById("transcriptInput"),
  visualInput: document.getElementById("visualInput"),
  recognitionState: document.getElementById("recognitionState"),
  transcriptState: document.getElementById("transcriptState"),
  visualState: document.getElementById("visualState"),
  understandingLoading: document.getElementById("understandingLoading"),
  transcribeBtn: document.getElementById("transcribeBtn"),
  visionBtn: document.getElementById("visionBtn"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  copyBtn: document.getElementById("copyBtn"),
  verdictBadge: document.getElementById("verdictBadge"),
  scoreValue: document.getElementById("scoreValue"),
  scoreBar: document.getElementById("scoreBar"),
  verdictText: document.getElementById("verdictText"),
  riskList: document.getElementById("riskList"),
  structureFormula: document.getElementById("structureFormula"),
  structureRows: document.getElementById("structureRows"),
  visualFormula: document.getElementById("visualFormula"),
  visualRows: document.getElementById("visualRows"),
  intentGrid: document.getElementById("intentGrid"),
  audienceGrid: document.getElementById("audienceGrid"),
  metricGrid: document.getElementById("metricGrid"),
  actionList: document.getElementById("actionList"),
  rewriteCards: document.getElementById("rewriteCards"),
  benchmarkList: document.getElementById("benchmarkList"),
  reportOutput: document.getElementById("reportOutput"),
};

const runtimeConfig = {
  cloudAnalyzeUrl: String(window.YUESHI_CLOUD_ANALYZE_URL || "").trim(),
};

const officialBenchmarkUrl = "https://lifexue.com/case/list/marketvideo?enter_method=tab";

const uploadRules = {
  maxBytes: 100 * 1024 * 1024,
  maxMb: 100,
  idealDuration: "15-60 秒",
};

const state = {
  frames: [],
  videoLoaded: false,
  videoFile: null,
  transcriptBusy: false,
  visionBusy: false,
  visualAuto: true,
  visualStructure: null,
  lastAnalysis: null,
};

function isLocalRuntime() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function shouldUseCloudAnalysis() {
  return !isLocalRuntime();
}

function getCloudAnalyzeUrl() {
  return runtimeConfig.cloudAnalyzeUrl;
}

function syncAppStateClasses() {
  document.body.classList.toggle("has-video", state.videoLoaded);
  document.body.classList.toggle("app-empty", !state.videoLoaded);
  document.body.classList.toggle("is-processing", state.transcriptBusy || state.visionBusy);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function setUploadWarning(message) {
  if (!elements.uploadWarning) return;
  elements.uploadWarning.hidden = !message;
  elements.uploadWarning.textContent = message || "";
}

function getUploadValidationMessage(file) {
  if (!file) return "";
  if (!file.type.startsWith("video/")) {
    return "请上传视频文件，支持 mp4、mov 等常见视频格式。";
  }
  if (file.size > uploadRules.maxBytes) {
    return `这个视频是 ${formatFileSize(file.size)}，建议控制在 ${uploadRules.maxMb}MB 内、${uploadRules.idealDuration} 内。系统优先分析关键画面，不会上传完整原片。`;
  }
  return "";
}

function setVideo(file) {
  if (!file) return;
  const validationMessage = getUploadValidationMessage(file);
  if (validationMessage) {
    setUploadWarning(validationMessage);
    elements.videoName.textContent = `当前文件过大：${formatFileSize(file.size)}`;
    elements.videoState.textContent = "需压缩";
    elements.videoState.className = "pill warning";
    elements.videoInput.value = "";
    return;
  }

  setUploadWarning("");
  state.videoLoaded = true;
  state.videoFile = file;
  state.frames = [];
  state.visualAuto = true;
  state.visualStructure = null;
  state.lastAnalysis = null;
  syncAppStateClasses();

  elements.videoName.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  elements.videoState.textContent = "本地拆解";
  elements.videoState.className = "pill good";
  elements.transcriptInput.value = "";
  elements.visualInput.value = "";
  renderEmpty();
  elements.transcriptState.textContent = "正在读取视频，不上传完整原片";
  elements.visualState.textContent = "正在本地抽取关键画面";
  setRecognitionBusy("正在本地拆解视频");

  elements.videoPreview.src = URL.createObjectURL(file);
  elements.videoPreview.load();
  elements.videoPreview.addEventListener("loadedmetadata", async () => {
    await captureFrames();
    if (shouldUseCloudAnalysis()) {
      analyzeVideoWithBailian(file);
    } else if (!elements.visualInput.value.trim()) {
      autoDescribeVisual();
    } else {
      renderFrames();
    }
  }, { once: true });

  if (!shouldUseCloudAnalysis()) {
    transcribeVideo(file);
  }
  renderFrames();
}

async function captureFrames() {
  const video = elements.videoPreview;
  if (!video.duration || !Number.isFinite(video.duration)) return;

  const frameCount = video.duration >= 50 ? 16 : video.duration >= 25 ? 12 : 8;
  const points = makeFramePoints(video.duration, frameCount);
  const frames = [];
  for (const point of points) {
    try {
      const image = await captureAt(point);
      frames.push({ time: point, image });
    } catch {
      break;
    }
  }
  state.frames = frames;
  renderFrames();
}

function makeFramePoints(duration, count) {
  if (duration <= 2) return [0];
  const safeStart = Math.min(0.8, duration * 0.1);
  const safeEnd = Math.max(safeStart, duration - Math.min(0.8, duration * 0.1));
  return Array.from({ length: count }, (_, index) => {
    if (count === 1) return safeStart;
    return safeStart + ((safeEnd - safeStart) * index) / (count - 1);
  });
}

function captureAt(time) {
  const video = elements.videoPreview;
  const canvas = elements.captureCanvas;
  const context = canvas.getContext("2d");

  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      const sourceWidth = video.videoWidth || 360;
      const sourceHeight = video.videoHeight || 640;
      const maxWidth = 420;
      const scale = Math.min(1, maxWidth / sourceWidth);
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    const onError = () => {
      cleanup();
      reject(new Error("capture failed"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = Math.min(Math.max(time, 0), Math.max(video.duration - 0.1, 0));
  });
}

function renderFrames() {
  if (!state.frames.length) {
    elements.frameStrip.className = "frame-strip empty";
    elements.frameStrip.textContent = "导入视频后自动抽取画面拆解";
    return;
  }

  const visual = getFrameVisualStructure();
  elements.frameStrip.className = "frame-strip";
  elements.frameStrip.innerHTML = state.frames.map((frame, index) => `
    <article class="frame-card">
      <img src="${frame.image}" alt="${formatTime(frame.time)} 画面" />
      <div class="frame-caption">
        <span class="frame-time">${formatTime(frame.time)}</span>
        <strong class="frame-material">${escapeHtml(frameMaterialFor(index, state.frames.length, visual))}</strong>
      </div>
    </article>
  `).join("");
}

function getFrameVisualStructure() {
  if (state.visualStructure && state.visualStructure.formula && state.visualStructure.formula.length) {
    return state.visualStructure;
  }
  if (elements.visualInput.value.trim()) {
    return parseVisualStructure(elements.visualInput.value.trim(), elements.transcriptInput.value);
  }
  return { formula: [], segments: [] };
}

function frameMaterialFor(index, total, visual) {
  const formula = visual && visual.formula ? visual.formula.filter(Boolean) : [];
  if (formula.length) {
    const mappedIndex = Math.min(formula.length - 1, Math.floor((index / Math.max(total, 1)) * formula.length));
    return shortMaterialName(formula[mappedIndex]);
  }

  if (total <= 1 || index === 0) return "首屏场景";
  if (index === total - 1) return "团购入口";
  return "服务过程";
}

function shortMaterialName(label) {
  const parts = String(label || "").split(/[—-]/).map((item) => item.trim()).filter(Boolean);
  return parts[1] || parts[0] || "画面素材";
}

async function analyzeVideoWithBailian(file = state.videoFile) {
  if (!file || state.transcriptBusy || state.visionBusy) return false;
  const endpoint = getCloudAnalyzeUrl();

  state.transcriptBusy = true;
  state.visionBusy = true;
  setRecognitionBusy("正在上传轻量证据包");
  elements.transcriptState.textContent = "正在读取画面字幕和已有文案";
  elements.visualState.textContent = "正在把关键画面交给百炼分析";

  try {
    if (!endpoint) {
      throw new Error("线上阿里云分析接口还没有配置。需要先部署一个后端中转接口。");
    }
    const data = await runCloudAnalysis(file, endpoint);

    applyBailianAnalysis(data);
    elements.transcriptState.textContent = `已识别普通话口播，模型：${data.model || "qwen3-omni-flash"}`;
    elements.visualState.textContent = "已按视频顺序生成拍摄素材和投前判断";
    return true;
  } catch (error) {
    elements.transcriptState.textContent = `云端分析失败：${error.message}`;
    elements.visualState.textContent = "请检查 OSS 上传、云函数任务或百炼模型返回";
    return false;
  } finally {
    state.transcriptBusy = false;
    state.visionBusy = false;
    updateRecognitionState();
  }
}

async function runCloudAnalysis(file, endpoint) {
  return await runCloudEvidenceAnalysis(file, endpoint);
}

async function runCloudEvidenceAnalysis(file, endpoint) {
  const evidenceEndpoint = endpoint.replace(/\/api\/analyze-video$/, "/api/analyze-evidence");
  const payload = buildEvidencePayload(file);
  applyCloudProgress({
    stage: "evidence",
    message: `已提取 ${payload.frames.length} 个关键画面，正在生成投前报告`,
  });

  const response = await fetch(evidenceEndpoint, {
    method: "POST",
    headers: {
      "Accept": "application/x-ndjson, application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 404 || response.status === 405) {
    throw new Error("云函数还没有更新极速证据包接口，请先上传最新云函数包");
  }

  const data = await readCloudAnalysisResponse(response);
  if (!response.ok) throw new Error(data.error || "百炼证据包分析失败");
  return data;
}

function buildEvidencePayload(file) {
  const video = elements.videoPreview;
  const frames = state.frames.slice(0, 18).map((frame, index) => ({
    index: index + 1,
    time: Number(frame.time || 0),
    image: frame.image,
  }));

  return {
    mode: "fast-evidence",
    fileName: file.name || "video",
    size: file.size,
    duration: Number(video.duration || 0),
    width: Number(video.videoWidth || 0),
    height: Number(video.videoHeight || 0),
    transcript: elements.transcriptInput.value.trim(),
    visualHint: elements.visualInput.value.trim(),
    frames,
  };
}

async function runCloudAnalysisJob(file, endpoint) {
  const upload = await createCloudUpload(file, endpoint);
  applyCloudProgress({ stage: "upload", message: "正在上传视频到临时存储" });
  await uploadFileToOss(file, upload);
  applyCloudProgress({ stage: "upload", message: "视频已上传，正在创建分析任务" });

  const analyzeEndpoint = endpoint.replace(/\/api\/analyze-video$/, "/api/analyze-uploaded-video");
  const response = await fetch(analyzeEndpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey: upload.objectKey,
      contentType: upload.contentType,
      fileName: file.name || "video",
      size: file.size,
    }),
  });

  if (response.status === 404 || response.status === 405) {
    const error = new Error("当前云端暂不支持任务模式");
    error.allowSyncFallback = true;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.jobId) throw new Error(data.error || "云端任务创建失败");

  applyCloudProgress({ stage: "upload", message: "视频已提交云端，正在排队分析" });
  return await pollCloudAnalysisJob(endpoint, data.jobId);
}

async function createCloudUpload(file, endpoint) {
  const uploadEndpoint = endpoint.replace(/\/api\/analyze-video$/, "/api/create-upload");
  const response = await fetch(uploadEndpoint, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name || "video",
      contentType: file.type || "video/mp4",
      size: file.size,
    }),
  });

  if (response.status === 404 || response.status === 405) {
    const error = new Error("当前云端暂不支持直传模式");
    error.allowSyncFallback = true;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.objectKey || (!data.uploadUrl && data.strategy !== "multipart")) {
    throw new Error(data.error || "云端上传地址创建失败");
  }
  data.endpoint = endpoint;
  return data;
}

async function uploadFileToOss(file, upload) {
  if (upload.strategy === "multipart") {
    await uploadFileToOssMultipart(file, upload);
    return;
  }

  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": upload.contentType || file.type || "video/mp4",
    },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`视频上传临时存储失败：${response.status} ${text.slice(0, 120)}`);
  }
}

async function uploadFileToOssMultipart(file, upload) {
  const partSize = Number(upload.partSize || 1024 * 1024);
  const partCount = Number(upload.partCount || Math.ceil(file.size / partSize));
  const uploadedParts = [];
  const concurrency = Math.min(3, partCount);
  let nextIndex = 0;
  let completedParts = 0;

  async function uploadWorker() {
    while (nextIndex < partCount) {
      const index = nextIndex;
      nextIndex += 1;

      const partNumber = index + 1;
      const start = index * partSize;
      const end = Math.min(file.size, start + partSize);
      const chunk = file.slice(start, end, "");
      const part = upload.parts && upload.parts[index] && upload.parts[index].partNumber === partNumber
        ? upload.parts[index]
        : await signUploadPart(upload, partNumber);

      applyCloudProgress({
        stage: "upload",
        message: `正在上传视频分片 ${partNumber}/${partCount}（已完成 ${completedParts}/${partCount}）`,
      });

      const eTag = await uploadPartWithRetry(part.uploadUrl, chunk, partNumber);
      uploadedParts.push({ partNumber, eTag });
      completedParts += 1;

      applyCloudProgress({
        stage: "upload",
        message: `视频上传中 ${completedParts}/${partCount}（${Math.round((completedParts / partCount) * 100)}%）`,
      });
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => uploadWorker()));
    uploadedParts.sort((a, b) => a.partNumber - b.partNumber);
    await completeMultipartUpload(upload, uploadedParts);
  } catch (error) {
    abortMultipartUpload(upload).catch(() => {});
    throw error;
  }
}

async function uploadPartWithRetry(uploadUrl, chunk, partNumber) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        body: chunk,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status} ${text.slice(0, 120)}`);
      }
      const eTag = response.headers.get("ETag") || response.headers.get("etag");
      if (!eTag) throw new Error("OSS 没有返回分片 ETag");
      return eTag;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        applyCloudProgress({
          stage: "upload",
          message: `第 ${partNumber} 个分片上传中断，正在重试 ${attempt}/2`,
        });
        await delay(1200 * attempt);
      }
    }
  }
  throw new Error(`第 ${partNumber} 个分片上传失败：${lastError ? lastError.message : "网络中断"}`);
}

async function signUploadPart(upload, partNumber) {
  const endpoint = upload.endpoint || getCloudAnalyzeUrl();
  const response = await fetch(endpoint.replace(/\/api\/analyze-video$/, "/api/sign-upload-part"), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey: upload.objectKey,
      uploadId: upload.uploadId,
      partNumber,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.uploadUrl) throw new Error(data.error || "分片上传地址创建失败");
  return data;
}

async function completeMultipartUpload(upload, parts) {
  const endpoint = upload.endpoint || getCloudAnalyzeUrl();
  const response = await fetch(endpoint.replace(/\/api\/analyze-video$/, "/api/complete-multipart-upload"), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey: upload.objectKey,
      uploadId: upload.uploadId,
      parts,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "视频分片合并失败");
}

async function abortMultipartUpload(upload) {
  if (!upload || upload.strategy !== "multipart" || !upload.uploadId) return;
  const endpoint = upload.endpoint || getCloudAnalyzeUrl();
  await fetch(endpoint.replace(/\/api\/analyze-video$/, "/api/abort-multipart-upload"), {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objectKey: upload.objectKey,
      uploadId: upload.uploadId,
    }),
  });
}

async function pollCloudAnalysisJob(endpoint, jobId) {
  const statusEndpoint = `${endpoint.replace(/\/api\/analyze-video$/, "/api/analyze-video-job")}?id=${encodeURIComponent(jobId)}`;
  const startedAt = Date.now();
  const maxWaitMs = 8 * 60 * 1000;

  while (Date.now() - startedAt < maxWaitMs) {
    await delay(3000);
    const response = await fetch(statusEndpoint, {
      headers: { "Accept": "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "云端任务查询失败");

    applyCloudProgress({
      stage: data.status === "done" ? "done" : "model",
      message: data.progress || "视频仍在分析中，请不要关闭页面",
    });

    if (data.status === "done" && data.result) return data.result;
    if (data.status === "error") throw new Error(data.error || "云端分析失败");
  }

  throw new Error("云端分析超时，请换更短的视频或稍后重试");
}

async function runCloudAnalysisSync(file, endpoint) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Accept": "application/x-ndjson, application/json",
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "video"),
    },
    body: file,
  });
  const data = await readCloudAnalysisResponse(response);
  if (!response.ok) throw new Error(data.error || "百炼分析失败");
  return data;
}

async function readCloudAnalysisResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/x-ndjson") || !response.body) {
    return response.json().catch(() => ({}));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalData = null;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = parseCloudEventLine(line);
        if (!event) continue;
        if (event.type === "error") throw new Error(event.error || "云端分析失败");
        if (event.type === "result") finalData = event.data || event;
        if (event.type === "status" || event.type === "heartbeat") applyCloudProgress(event);
      }
    }
    if (done) break;
  }

  const tail = parseCloudEventLine(buffer);
  if (tail) {
    if (tail.type === "error") throw new Error(tail.error || "云端分析失败");
    if (tail.type === "result") finalData = tail.data || tail;
    if (tail.type === "status" || tail.type === "heartbeat") applyCloudProgress(tail);
  }

  if (!finalData) throw new Error("云端分析没有返回结果");
  return finalData;
}

function parseCloudEventLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function applyCloudProgress(event) {
  const message = event.message || "视频仍在分析中，请不要关闭页面";
  setRecognitionBusy(message);
  if (event.stage === "evidence") {
    elements.transcriptState.textContent = "已完成本地拆解，正在识别字幕/口播线索";
    elements.visualState.textContent = "正在根据关键画面生成结构和建议";
  } else if (event.stage === "upload") {
    elements.transcriptState.textContent = "视频已进入云端临时处理";
    elements.visualState.textContent = "正在准备画面和声音理解";
  } else if (event.stage === "model") {
    elements.transcriptState.textContent = "百炼正在识别口播和字幕";
    elements.visualState.textContent = "百炼正在分析画面结构";
  } else {
    elements.transcriptState.textContent = message;
    elements.visualState.textContent = "大视频分析会稍慢，系统仍在处理";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyBailianAnalysis(data) {
  const analysis = data.analysis || {};
  const transcript = normalizeMandarinTranscript(data.transcript || analysis.transcript || "");
  const visualText = String(data.visualText || "")
    || (Array.isArray(analysis.visualObservation) ? analysis.visualObservation.join("\n") : "");

  elements.transcriptInput.value = transcript;
  elements.visualInput.value = visualText;
  state.visualAuto = true;
  state.visualStructure = parseVisualStructure(visualText, transcript);

  const result = buildResultFromBailianAnalysis(analysis, transcript, visualText);
  state.lastAnalysis = result;
  renderFrames();
  renderAnalysis(result);
}

function buildResultFromBailianAnalysis(analysis, transcript, visualText) {
  const visual = parseVisualStructure(visualText, transcript);
  const localStructure = inferScriptStructure(transcript, visual);
  const localIntent = inferMarketingIntent(transcript, visual, localStructure);
  const localAudience = inferAudience(`${transcript}\n${visualText}\n${localStructure.formula.join(" ")}`);
  const localMetrics = estimateMetrics(localStructure, localIntent, localAudience, transcript, visual);

  const structure = normalizeRemoteStructure(analysis.scriptStructure, localStructure);
  const intent = normalizeRemoteIntent(analysis.marketingIntent, localIntent);
  const audience = normalizeRemoteAudience(analysis.audience, localAudience);
  const metrics = normalizeRemoteMetrics(analysis.preflight, localMetrics);
  const verdict = normalizeRemoteVerdict(analysis.preflight, metrics);
  const risks = normalizeRemoteRisks(analysis.preflight, inferRisks(structure, intent, metrics, transcript, visual));
  const rewritePlan = normalizeRemoteRewrite(analysis.rewrite, buildRewriteSuggestion(structure, intent, [], metrics, risks, visual));

  return {
    transcript,
    visual,
    structure,
    intent,
    audience,
    metrics,
    verdict,
    risks,
    actions: [],
    rewritten: rewritePlan.text,
    rewritePlan,
    ready: true,
  };
}

function normalizeRemoteStructure(rows, fallback) {
  if (!Array.isArray(rows) || !rows.length) return fallback;
  const buckets = rows.map((row, index) => ({
    label: cleanFallback(row && row.label, `结构 ${index + 1}`),
    copy: cleanFallback(row && row.copy, "模型未返回对应证据"),
  }));
  return {
    ...fallback,
    formula: buckets.map((row) => row.label),
    buckets,
  };
}

function normalizeRemoteIntent(rows, fallback) {
  if (!Array.isArray(rows) || !rows.length) return fallback;
  const result = rows.map((row) => [
    cleanFallback(row && (row.title || row.label || row.name), "营销维度"),
    cleanFallback(row && (row.value || row.copy || row.reason), "待确认"),
  ]);
  return result.length ? result : fallback;
}

function normalizeRemoteAudience(rows, fallback) {
  if (!Array.isArray(rows) || !rows.length) return fallback;
  return rows.map((row, index) => ({
    name: cleanFallback(row && row.name, `吸引人群 ${index + 1}`),
    reason: cleanFallback(row && row.reason, "模型未返回原因"),
    score: Number(row && row.score) || 0,
  }));
}

function normalizeRemoteMetrics(preflight, fallback) {
  const score = clampScore(preflight && preflight.score, fallback.score);
  return {
    ...fallback,
    score,
    stage: cleanFallback(preflight && preflight.label, fallback.stage),
  };
}

function normalizeRemoteVerdict(preflight, metrics) {
  const label = cleanFallback(preflight && preflight.label, metrics.score >= 80 ? "建议投放" : metrics.score >= 60 ? "先改再测" : "不建议投放");
  const text = cleanFallback(preflight && preflight.text, "百炼已根据文案、画面、声音和结构生成投前判断。");
  return {
    label,
    text,
    className: metrics.score >= 80 ? "good" : metrics.score >= 60 ? "warning" : "danger",
  };
}

function normalizeRemoteRisks(preflight, fallback) {
  const rows = preflight && preflight.risks;
  if (!Array.isArray(rows) || !rows.length) return fallback;
  return rows.map((row) => [
    cleanFallback(row && row.title, "投前风险"),
    cleanFallback(row && row.detail, "模型未返回风险说明"),
  ]);
}

function normalizeRemoteRewrite(rewrite, fallback) {
  if (!rewrite || typeof rewrite !== "object") return fallback;
  const cards = Array.isArray(rewrite.issues) && rewrite.issues.length
    ? rewrite.issues.map((item, index) => ({
      label: cleanFallback(item && item.label, `问题 ${index + 1}`),
      title: cleanFallback(item && item.title, "需要优化"),
      body: cleanFallback(item && item.body, "模型未返回说明"),
    }))
    : fallback.cards;
  const copy = Array.isArray(rewrite.finalCopy) && rewrite.finalCopy.length
    ? rewrite.finalCopy.map((line) => String(line || "").trim()).filter(Boolean)
    : fallback.copy;
  const execution = Array.isArray(rewrite.executionStandard) && rewrite.executionStandard.length
    ? rewrite.executionStandard.map((item, index) => ({
      label: cleanFallback(item && item.label, `${index + 1}`),
      title: cleanFallback(item && item.title, `步骤 ${index + 1}`),
      body: cleanFallback(item && item.body, copy[index] || "按成品文案执行"),
    }))
    : copy.map((line, index) => ({
      label: `${index + 1}`,
      title: ["痛点钩子", "项目承接", "过程证明", "团购收口"][index] || `步骤 ${index + 1}`,
      body: line,
    }));
  return {
    cards,
    copy,
    execution,
    text: [
      "优化建议：",
      ...cards.map((card) => `${card.label}. ${card.title}：${card.body}`),
      "",
      "成品文案：",
      ...copy.map((line, index) => `${index + 1}. ${line}`),
      "",
      "执行标准：",
      ...execution.map((item) => `${item.label}. ${item.title}：${item.body}`),
    ].join("\n"),
  };
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

async function transcribeVideo(file = state.videoFile) {
  if (!file || state.transcriptBusy) return;
  state.transcriptBusy = true;
  setRecognitionBusy("正在识别普通话口播");
  elements.transcriptState.textContent = "正在使用本地 Whisper 识别普通话口播和字幕";

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || "video"),
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "识别失败");

    const text = normalizeMandarinTranscript(data.text || "");
    if (text) {
      elements.transcriptInput.value = text;
      elements.transcriptState.textContent = `已自动识别普通话文案，模型：${data.model || "local-whisper"}`;
    } else {
      elements.transcriptState.textContent = "没有识别到清晰口播，可人工补充字幕";
    }
  } catch (error) {
    elements.transcriptState.textContent = `自动识别失败：${error.message}`;
  } finally {
    state.transcriptBusy = false;
    if (!state.visionBusy && state.visualAuto) autoDescribeVisual();
    updateRecognitionState();
    analyzeVideo();
  }
}

function autoDescribeVisual() {
  if (state.visionBusy) return;
  state.visionBusy = true;
  setRecognitionBusy("正在识别拍摄素材");
  elements.visualState.textContent = "正在根据画面拆解和文案整理拍摄素材";

  const visual = inferVisualStructure(
    elements.transcriptInput.value,
    state.frames,
    elements.videoPreview.duration
  );
  state.visualStructure = visual;
  if (visual.text) {
    elements.visualInput.value = visual.text;
    state.visualAuto = true;
    elements.visualState.textContent = "已按视频顺序生成拍摄素材";
  } else {
    elements.visualInput.value = "";
    state.visualAuto = true;
    elements.visualState.textContent = "等待画面拆解，暂不生成拍摄素材";
  }
  renderFrames();

  state.visionBusy = false;
  updateRecognitionState();
  analyzeVideo();
}

function setRecognitionBusy(text) {
  elements.recognitionState.textContent = text;
  elements.recognitionState.className = "pill warning";
  elements.understandingLoading.hidden = false;
  syncAppStateClasses();
  renderPendingPanels();
}

function updateRecognitionState() {
  if (state.transcriptBusy || state.visionBusy) {
    elements.understandingLoading.hidden = false;
    syncAppStateClasses();
    return;
  }
  elements.understandingLoading.hidden = true;
  if (elements.transcriptInput.value.trim() || elements.visualInput.value.trim()) {
    elements.recognitionState.textContent = "已自动识别";
    elements.recognitionState.className = "pill good";
  } else {
    elements.recognitionState.textContent = "系统自动识别";
    elements.recognitionState.className = "pill neutral";
  }
  syncAppStateClasses();
}

function analyzeVideo() {
  if (!state.videoLoaded) {
    elements.videoInput.click();
    return;
  }

  const transcript = normalizeMandarinTranscript(elements.transcriptInput.value);
  const visualText = elements.visualInput.value.trim();
  const visual = parseVisualStructure(visualText, transcript);
  const structure = inferScriptStructure(transcript, visual);
  const intent = inferMarketingIntent(transcript, visual, structure);
  const audience = inferAudience(`${transcript}\n${visualText}\n${structure.formula.join(" ")}`);
  const metrics = estimateMetrics(structure, intent, audience, transcript, visual);
  const verdict = inferVerdict(metrics);
  const risks = inferRisks(structure, intent, metrics, transcript, visual);
  const ready = isLinkedUnderstandingReady(transcript, visual);
  const actions = ready ? inferOptimizationSuggestions(risks, structure, intent, metrics, visual) : [];
  const rewritePlan = ready ? buildRewriteSuggestion(structure, intent, actions, metrics, risks, visual) : emptyRewritePlan();
  const rewritten = ready ? rewritePlan.text : "";

  const result = {
    transcript,
    visual,
    structure,
    intent,
    audience,
    metrics,
    verdict,
    risks,
    actions,
    rewritten,
    rewritePlan,
    ready,
  };
  state.lastAnalysis = result;
  renderAnalysis(result);
}

function isLinkedUnderstandingReady(transcript, visual) {
  if (!transcript.trim()) return false;
  if (!visual || !visual.formula || !visual.formula.length) return false;
  if (visual.formula.some((item) => item.includes("待确认") || item.includes("待识别"))) return false;
  return true;
}

function inferVisualStructure(transcript, frames, duration) {
  const text = transcript || "";
  const segments = [];
  if (!frames.length) {
    return { formula: [], segments: [], text: "" };
  }

  if (/商场|广场|门头|门店|到店|附近|路线/.test(text)) {
    segments.push({
      label: "商圈外景—门头招牌",
      role: "建立真实到店场景",
      detail: "外景、门头、商圈环境",
    });
  }
  if (/真没想到|活动|优惠|[0-9]+(\.[0-9]+)?元|团购|只要/.test(text)) {
    segments.push({
      label: "价格字幕—团购权益",
      role: "给用户停留理由",
      detail: "价格大字、权益字幕、团购利益点",
    });
  }
  if (/检测|肤况|皮肤|清洁|黑头|白头|出油|卡粉|补水|防晒/.test(text)) {
    segments.push({
      label: "面部服务过程—清洁特写",
      role: "证明项目真实可感知",
      detail: "肤况检测、清洁细节、产品护理、前后状态",
    });
  }
  if (/肩颈|按摩|头疗|放松|酸|累/.test(text)) {
    segments.push({
      label: "肩颈服务过程—按摩手法",
      role: "承接疲劳和放松需求",
      detail: "肩颈按摩、顾客躺椅、技师手法、放松状态",
    });
  }
  if (/团购|下单|购买|预约|点/.test(text)) {
    segments.push({
      label: "团购页—购买入口",
      role: "完成转化动作",
      detail: "团购页、购买入口、项目权益、到店引导",
    });
  }
  if (!segments.length && frames.length) {
    segments.push({
      label: "画面素材—待确认",
      role: "系统已抽帧，具体内容需要视觉模型或人工确认",
      detail: "已抽取画面拆解，但缺少可判断的口播线索",
    });
  }

  const formula = segments.map((item) => item.label);
  const textLines = [
    `拍摄素材：${formula.length ? formula.join(" + ") : "待识别"}`,
  ].filter(Boolean);

  return { formula, segments, text: textLines.join("\n") };
}

function parseVisualStructure(visualText, transcript) {
  if (!visualText) return inferVisualStructure(transcript, state.frames, elements.videoPreview.duration);
  const lines = visualText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const formulaLine = lines.find((line) => /拍摄(结构|素材)/.test(line));
  const formula = formulaLine
    ? formulaLine.replace(/^.*?[:：]/, "").split(/[+＋]/).map((item) => item.trim()).filter(Boolean)
    : lines.map((line) => line.replace(/^\d+[.、]\s*/, "").replace(/^.*?[:：]/, "").trim()).filter(Boolean);
  const detailLines = lines.filter((line) => !/拍摄(结构|素材)/.test(line));
  const segments = formula.map((label, index) => {
    const detail = detailLines[index] ? detailLines[index].replace(/^.*?[:：]/, "") : "";
    return { label, role: "", detail };
  });
  return { formula, segments, text: visualText };
}

function inferScriptStructure(transcript, visual) {
  const lines = transcript.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const opening = lines[0] || "";
  const ending = lines[lines.length - 1] || "";
  const formula = [];
  const buckets = [];

  const hasPainOpening = /肩颈|卡粉|黑头|白头|熬夜|出油|酸|累|不干净|疲惫/.test(opening);
  const hasBenefitOpening = /真没想到|活动|优惠|[0-9]+(\.[0-9]+)?元|团购|只要/.test(opening);
  if (hasPainOpening) formula.push("痛点开场");
  else if (hasBenefitOpening) formula.push("利益开场");
  else if (opening) formula.push("情绪开场");

  if (/[0-9]+(\.[0-9]+)?元|优惠|活动|团购|只要/.test(transcript)) formula.push("价格利益");
  if (/检测|清洁|补水|按摩|头疗|护理|放松|焕亮|防晒/.test(transcript)) formula.push("服务证明");
  if (/肩颈|卡粉|黑头|白头|熬夜|出油|不干净|酸|累/.test(transcript)) formula.push("痛点承接");
  if (/白领|宝妈|妈妈|女生|上班|熬夜|朋友|姐妹/.test(transcript)) formula.push("人群召回");
  if (/团购|下单|购买|预约|点|来体验|想体验/.test(ending)) formula.push("团购转化");

  if (visual.formula.length) formula.push(`拍摄素材：${visual.formula.join("+")}`);

  buckets.push({
    label: "文案主线",
    copy: formula.filter((item) => !isVisualFormulaItem(item)).join(" + ") || "待识别",
  });
  buckets.push({
    label: "画面主线",
    copy: visual.formula.join(" + ") || "待识别",
  });
  buckets.push({
    label: "衔接判断",
    copy: judgeScriptVisualConnection(formula, visual.formula, opening),
  });

  return {
    formula: unique(formula),
    buckets,
    opening,
    ending,
    hasPainOpening,
    hasBenefitOpening,
  };
}

function judgeScriptVisualConnection(formula, visualFormula, opening) {
  if (!opening) return "缺少口播文案，无法判断文案和画面是否衔接";
  if (!/肩颈|卡粉|黑头|熬夜|出油|酸|累/.test(opening) && visualFormula.some((item) => item.includes("商圈") || item.includes("门头"))) {
    return "开头画面是真实场景，但文案先打情绪/优惠，痛点没有第一时间接上";
  }
  if (formula.includes("痛点开场") && visualFormula.length) {
    return "文案先打痛点，画面能接服务证明，结构比较顺";
  }
  return "文案结构基本成立，但需要确认每个卖点都有对应画面";
}

function inferMarketingIntent(transcript, visual, structure) {
  const allText = `${transcript}\n${visual.text}\n${structure.formula.join(" ")}`;
  const priceMatch = allText.match(/([0-9]+(?:\.[0-9]+)?\s*元[^，。；\n]*)/);
  const benefits = pickKeywords(allText, ["肤况检测", "肩颈按摩", "头疗", "面部清洁", "补水", "防晒", "去黑头", "黑白头", "五重清洁", "两重焕亮", "全身放松", "放松"]);
  const pains = pickKeywords(allText, ["肩颈酸胀", "肩颈累", "化妆卡粉", "脸洗不干净", "黑头白头", "熬夜出油", "出油", "不干净", "疲惫", "酸", "累"]);
  const scenes = pickKeywords(allText, ["商场", "门头", "到店", "下班", "熬夜后", "团购页", "室内场景", "顾客躺椅"]);
  const visualProof = visual.formula.length ? visual.formula.join(" + ") : "缺少明确拍摄素材";
  const cta = /团购|下单|预约|购买|点|来体验/.test(allText) ? "团购购买 / 到店体验" : "缺少明确购买引导";

  return [
    ["推广商品", priceMatch ? priceMatch[1].replace(/\s+/g, "") : "待从文案中提取商品和价格"],
    ["产品卖点", benefits.length ? unique(benefits).join("、") : "待补充产品功能"],
    ["用户痛点", pains.length ? unique(pains).join("、") : "待补充用户痛点"],
    ["优惠活动", priceMatch ? priceMatch[1].replace(/\s+/g, "") : "待补充优惠"],
    ["适用场景", scenes.length ? unique(scenes).join("、") : "待补充场景"],
    ["画面证据", visualProof],
    ["脚本结构", structure.formula.filter((item) => !isVisualFormulaItem(item)).join(" + ") || "待识别"],
    ["引导购买", cta],
  ];
}

function inferAudience(text) {
  const candidates = [
    ["新锐白领", /上班|下班|白领|肩颈|久坐|疲惫|商场|门头/],
    ["Z世代", /卡粉|黑头|白头|熬夜|出油|女生|姐妹|颜值/],
    ["都市蓝领", /肩颈|酸|累|放松|按摩|到店/],
    ["精致妈妈", /妈妈|宝妈|清洁|补水|护理|放松/],
    ["小镇青年", /团购|优惠|价格|活动|划算/],
  ];
  const hits = candidates
    .map(([name, regex]) => ({ name, reason: regex.test(text) ? reasonForAudience(name) : "", score: regex.test(text) ? 1 : 0 }))
    .filter((item) => item.score);
  return hits.length ? hits.slice(0, 4) : [{ name: "待识别人群", reason: "需要更多文案或画面信息", score: 0 }];
}

function estimateMetrics(structure, intent, audience, transcript, visual) {
  const execution = scoreExecutionStandards(structure, transcript, visual);
  let score = Math.round(
    execution.structureScore * 0.34 +
    execution.clarityScore * 0.22 +
    execution.audioScore * 0.22 +
    execution.densityScore * 0.22
  );
  if (isBenefitStacked(intent)) score -= 6;
  score = Math.max(0, Math.min(100, score));

  return {
    ...execution,
    score,
    rate3: clampMetric(8 + score * 0.22, 8, 36),
    rate5: clampMetric(4 + score * 0.14, 4, 24),
    ctr: clampMetric(0.6 + score * 0.027, 0.6, 4.2),
    cvr: clampMetric(1.2 + score * 0.052, 1.2, 8.8),
    costRisk: score >= 78 ? "低" : score >= 58 ? "中" : "高",
    stage: score >= 78 ? "可小额放量" : score >= 58 ? "先改再测" : "先改素材",
  };
}

function scoreExecutionStandards(structure, transcript, visual) {
  const copyFormula = structure.formula.filter((item) => !isVisualFormulaItem(item));
  let structureScore = 34;
  if (copyFormula.length >= 3) structureScore += 20;
  if (structure.formula.includes("服务证明")) structureScore += 14;
  if (structure.formula.includes("团购转化")) structureScore += 12;
  if (visual.formula.length >= 3) structureScore += 12;
  if (structure.hasPainOpening || structure.hasBenefitOpening) structureScore += 8;

  const audioScore = transcript.length >= 80 ? 88 : transcript.length >= 35 ? 72 : transcript.length > 0 ? 54 : 0;
  const clarityScore = visual.formula.some((item) => item.includes("待确认") || item.includes("待识别"))
    ? 48
    : visual.formula.length >= 3 ? 82 : visual.formula.length ? 64 : 0;
  const densityScore = visual.formula.length >= 5 ? 90 : visual.formula.length >= 4 ? 82 : visual.formula.length >= 3 ? 70 : visual.formula.length ? 52 : 0;

  return {
    structureScore: clampMetric(structureScore, 0, 100),
    clarityScore: clampMetric(clarityScore, 0, 100),
    audioScore: clampMetric(audioScore, 0, 100),
    densityScore: clampMetric(densityScore, 0, 100),
  };
}

function inferVerdict(metrics) {
  const score = metrics.score;
  const weakest = Math.min(metrics.structureScore, metrics.clarityScore, metrics.audioScore, metrics.densityScore);
  if (score >= 78) {
    return { label: "可小额放量", className: "good", text: "结构可拆、声音可识别、画面清晰且画面密度够，可以小预算验证。" };
  }
  if (score >= 58 && weakest >= 45) {
    return { label: "先改再测", className: "warning", text: "视频方向可用，但结构、声音、画面清晰度或画面密集度还有一项需要补强。" };
  }
  return { label: "先改素材", className: "danger", text: "视频没有形成清晰框架，或声音/画面/密度不足，直接投流容易放大问题。" };
}

function inferRisks(structure, intent, metrics, transcript, visual) {
  const risks = [];
  if (metrics.structureScore < 65) {
    risks.push(["结构不够清晰", "好的视频要能拆出开头、过程证明、卖点承接和转化收口，现在框架还不够完整。"]);
  }
  if (metrics.audioScore < 65) {
    risks.push(["声音识别不足", "口播或字幕不够清楚，系统很难判断文案主线，投放时用户也容易漏掉重点。"]);
  }
  if (metrics.clarityScore < 65) {
    risks.push(["画面清晰度不足", "画面需要让用户一眼看懂在做什么，服务过程、产品、顾客状态要清楚。"]);
  }
  if (metrics.densityScore < 65) {
    risks.push(["画面密集度不足", "爆款参考的特点是有效画面连续出现，不能长时间停在单一空镜或口播。"]);
  }
  if (!structure.hasPainOpening) {
    risks.push(["首屏痛点后置", "开头没有直接点出用户问题，外景或优惠先行会削弱3秒停留。"]);
  }
  if (isBenefitStacked(intent)) {
    risks.push(["卖点堆叠", "项目很多，但主卖点没有被用户第一时间理解。"]);
  }
  if (!visual.formula.some((item) => item.includes("服务") || item.includes("过程") || item.includes("体验"))) {
    risks.push(["画面证明不足", "拍摄素材里缺少服务过程或顾客体验，信任感不够。"]);
  }
  if (!structure.formula.includes("团购转化")) {
    risks.push(["转化收口弱", "结尾没有明确团购、预约或到店动作。"]);
  }
  if (metrics.score >= 78) risks.push(["放量边界", "即使可测，也先小预算看流速和支付成本。"]);
  return risks.slice(0, 3);
}

function inferOptimizationSuggestions(risks, structure, intent, metrics, visual) {
  const intentMap = Object.fromEntries(intent);
  const riskText = risks.map((risk) => risk[0]).join(" ");
  const visualChain = visual.formula.join(" + ");
  const mainPain = splitField(intentMap["用户痛点"])[0] || "核心痛点";
  const mainBenefit = splitField(intentMap["产品卖点"])[0] || "核心卖点";

  const firstLogic = riskText.includes("首屏")
    ? `当前开头没有第一时间打${mainPain}，前3秒要先抛痛点，再接价格/权益。`
    : `当前开头可以保留，但前3秒要把${mainPain}和${mainBenefit}放在同一条信息里。`;
  const secondLogic = riskText.includes("画面")
    ? "画面证明不足，必须补服务过程、细节特写和到店证据，不能只靠口播解释。"
    : `画面链路按“${visualChain || "场景—服务—转化"}”推进，每一段只承接一个卖点。`;
  const thirdLogic = structure.formula.includes("团购转化")
    ? `结尾保留团购动作，但不要再扩展新卖点，直接让用户点团购/预约。当前预估阶段：${metrics.stage}。`
    : `结尾缺少明确购买动作，要把最后一句改成点团购、预约或到店体验。当前预估阶段：${metrics.stage}。`;

  return [
    ["1. 框架逻辑", firstLogic],
    ["2. 画面逻辑", secondLogic],
    ["3. 转化逻辑", thirdLogic],
  ];
}

function buildRewriteSuggestion(structure, intent, actions, metrics, risks, visual) {
  const intentMap = Object.fromEntries(intent);
  const product = cleanFallback(intentMap["推广商品"], "当前团购项目");
  const benefits = splitField(intentMap["产品卖点"]);
  const pains = splitField(intentMap["用户痛点"]);
  if (!benefits.length) benefits.push(...fallbackBenefitsFromVisual(visual));
  if (!pains.length) pains.push(...fallbackPainsFromStructure(structure));

  const mainPain = pains[0];
  const mainBenefit = benefits[0];
  const painPhrase = pains.slice(0, 2).join("、");
  const benefitPhrase = benefits.slice(0, 3).join("、");
  const scene = cleanFallback(intentMap["适用场景"], "有同类需求的人");
  const riskText = risks.map((risk) => risk[0]).join("、") || "暂无明显高风险";
  const actionText = actions.map(([title, detail]) => `${title}：${detail}`).join("\n");
  const currentFramework = structure.formula.filter((item) => !isVisualFormulaItem(item)).join(" + ") || "待识别";
  const visualFramework = visual.formula.join(" + ") || "待识别";

  const framework = "痛点开场 + 价格利益 + 服务过程证明 + 功效细节 + 人群召回 + 团购转化";
  const openingAdvice = structure.hasPainOpening
    ? `保留痛点开头，但把“${mainPain}”说得更具体，避免泛泛讲优惠。`
    : `开头先不要从优惠或情绪开始，直接改成“${mainPain}”相关的用户问题。`;
  const copyAdvice = `文案只围绕“${mainPain} -> ${mainBenefit} -> ${product} -> 点团购预约”推进，中间不要堆太多无关项目。`;
  const copy = [
    `${painPhrase}的人，先看这一条。`,
    `${product}这次重点解决${mainPain}，不是简单堆项目，而是把${mainBenefit}这件事做清楚。`,
    `到店后先看状态，再做${benefitPhrase}，过程清楚，效果也能看见。`,
    `适合${scene}，想体验就点团购预约，名额和权益都在链接里。`,
  ];
  const execution = [
    { label: "1", title: "痛点钩子", body: copy[0] },
    { label: "2", title: "项目承接", body: copy[1] },
    { label: "3", title: "过程证明", body: copy[2] },
    { label: "4", title: "团购收口", body: copy[3] },
  ];

  const text = [
    `执行标准：投前分 ${metrics.score}；主要风险：${riskText}`,
    actionText ? `对应优化逻辑：\n${actionText}` : "",
    "",
    `1. 框架怎么改：当前是“${currentFramework}”，建议改成“${framework}”。`,
    `2. 开头怎么改：${openingAdvice}`,
    `3. 文案怎么改：${copyAdvice}`,
    `4. 成品文案生成逻辑：成品文案只承接“${currentFramework} -> ${visualFramework}”这条链路，不额外堆新卖点。`,
    "",
    "成品文案：",
    ...copy.map((line, index) => `${index + 1}. ${line}`),
    "",
    "执行标准：",
    ...execution.map((item) => `${item.label}. ${item.title}：${item.body}`),
  ].join("\n");

  return {
    cards: [
      {
        label: "问题 1",
        title: "框架要能被拆出来",
        body: `当前是“${currentFramework}”，建议改成“${framework}”。`,
      },
      {
        label: "问题 2",
        title: "开头要先抓痛点",
        body: openingAdvice,
      },
      {
        label: "问题 3",
        title: "文案要少堆卖点",
        body: copyAdvice,
      },
    ],
    copy,
    execution,
    text,
  };
}

function emptyRewritePlan() {
  return { cards: [], copy: [], execution: [], text: "" };
}

function buildBenchmarkGuidance(result) {
  if (!result || !result.ready) {
    return [
      {
        tag: "先看标准",
        title: "官方案例库",
        body: "导入视频前，可以先看官方案例里的开头、服务过程和团购收口，建立素材标准。",
      },
      {
        tag: "看什么",
        title: "不要只看画面好不好看",
        body: "重点看一条视频是否能拆出“痛点-过程-卖点-下单”这条链路。",
      },
    ];
  }

  const risks = (result.risks || []).map(([title, detail]) => `${title} ${detail}`).join(" ");
  const formula = result.structure && Array.isArray(result.structure.formula)
    ? result.structure.formula.join(" ")
    : "";
  const visual = result.visual && Array.isArray(result.visual.formula)
    ? result.visual.formula.join(" ")
    : "";
  const all = `${risks} ${formula} ${visual}`;
  const cards = [];

  if (/结构|框架|脚本|主线/.test(all) || (result.metrics && result.metrics.structureScore < 70)) {
    cards.push({
      tag: "对标 1",
      title: "看官方案例怎么拆结构",
      body: "打开案例后，先暂停拆顺序：开头先说什么，中段用什么画面证明，最后怎么引导团购。",
    });
  }
  if (/开头|首屏|痛点|停留/.test(all) || !(result.structure && result.structure.hasPainOpening)) {
    cards.push({
      tag: "对标 2",
      title: "看前三秒钩子",
      body: "重点找美容美体案例的前 3 秒：是不是先点出脸干、卡粉、肩颈酸、黑头等用户问题。",
    });
  }
  if (/画面|清晰|密集|过程|服务|证明|体验/.test(all) || (result.metrics && result.metrics.densityScore < 75)) {
    cards.push({
      tag: "对标 3",
      title: "看服务过程怎么拍",
      body: "不要只看装修和环境，重点看它有没有连续展示检测、操作、细节特写、顾客状态和结果反馈。",
    });
  }
  if (/团购|转化|收口|预约|下单/.test(all) || !formula.includes("团购转化")) {
    cards.push({
      tag: "对标 4",
      title: "看团购收口怎么出现",
      body: "观察价格、权益、预约动作在什么时候出现，避免把优惠孤立放在结尾才讲。",
    });
  }

  if (!cards.length) {
    cards.push({
      tag: "对标",
      title: "看同品类优秀案例",
      body: "这条素材方向基本成立，去官方库重点看同品类案例的节奏密度和结尾转化表达。",
    });
  }

  return cards.slice(0, 4);
}

function renderAnalysis(result) {
  if (state.videoLoaded && (state.transcriptBusy || state.visionBusy) && !result.ready) {
    renderPendingPanels();
    return;
  }

  renderVerdict(result);
  renderVisualObservation(result.visual);
  renderFrames();
  if (result.ready) {
    renderFinalScriptStructure(result.rewritePlan, result.structure);
  } else {
    renderStructure(result.structure);
  }
  renderIntent(result.intent);
  renderAudience(result.audience);
  if (result.ready) {
    renderExecutionStandard(result.metrics, result.rewritePlan);
  } else {
    elements.metricGrid.innerHTML = "";
  }
  renderActions(result.actions);
  renderRewriteCards(result.rewritePlan);
  renderBenchmarkGuidance(buildBenchmarkGuidance(result));
  elements.reportOutput.value = result.rewritten;
}

function renderVisualObservation(visual) {
  const formula = visual && visual.formula ? visual.formula : [];
  elements.visualFormula.innerHTML = formula.map((item, index) => `
    <span><em>${index + 1}</em>${escapeHtml(item)}</span>
  `).join("");
  elements.visualRows.innerHTML = "";
}

function renderVerdict(result) {
  if (!result.ready) {
    elements.verdictBadge.textContent = "等待识别";
    elements.verdictBadge.className = "pill neutral";
    elements.scoreValue.textContent = "--";
    elements.scoreBar.style.width = "0";
    elements.scoreBar.style.background = "";
    elements.verdictText.textContent = "文案和拍摄素材完成后生成投前判断。";
    elements.riskList.innerHTML = "";
    return;
  }

  elements.verdictBadge.textContent = result.verdict.label;
  elements.verdictBadge.className = `pill ${result.verdict.className}`;
  elements.scoreValue.textContent = result.metrics.score;
  elements.scoreBar.style.width = `${result.metrics.score}%`;
  elements.scoreBar.style.background = scoreColor(result.metrics.score);
  elements.verdictText.textContent = result.verdict.text;
  elements.riskList.innerHTML = result.risks.map(([title, detail]) => `
    <article class="risk-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `).join("");
}

function renderStructure(structure) {
  elements.structureFormula.innerHTML = structure.formula.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  elements.structureRows.innerHTML = structure.buckets.map((row) => `
    <article class="structure-row">
      <strong>${escapeHtml(row.label)}</strong>
      <p>${escapeHtml(row.copy)}</p>
    </article>
  `).join("");
}

function renderFinalScriptStructure(plan, fallbackStructure) {
  if (!plan || !plan.execution.length) {
    renderStructure(fallbackStructure);
    return;
  }

  elements.structureFormula.innerHTML = plan.execution
    .map((item) => `<span>${escapeHtml(item.title)}</span>`)
    .join("");
  elements.structureRows.innerHTML = plan.execution.map((item) => `
    <article class="structure-row">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join("");
}

function renderIntent(intent) {
  elements.intentGrid.innerHTML = intent.map(([title, value]) => `
    <article class="intent-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(value)}</p>
    </article>
  `).join("");
}

function renderAudience(audience) {
  elements.audienceGrid.innerHTML = audience.map((item) => `
    <article class="audience-card">
      <strong>${escapeHtml(item.name)}</strong>
      <p>${escapeHtml(item.reason)}</p>
    </article>
  `).join("");
}

function renderMetrics(metrics) {
  const rows = [
    ["结构完整度", `${metrics.structureScore}`, "能否拆出清晰框架"],
    ["画面清晰度", `${metrics.clarityScore}`, "用户是否一眼看懂"],
    ["声音识别度", `${metrics.audioScore}`, "口播/字幕是否清楚"],
    ["画面密集度", `${metrics.densityScore}`, "有效画面是否连续"],
    ["投放风险", metrics.costRisk, "素材放大后的成本压力"],
    ["执行阶段", metrics.stage, "下一步拍摄/投放动作"],
  ];
  elements.metricGrid.innerHTML = rows.map(([label, value, tip]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(tip)}</p>
    </article>
  `).join("");
}

function renderExecutionStandard(metrics, plan) {
  if (!plan || !plan.execution.length) {
    renderMetrics(metrics);
    return;
  }

  elements.metricGrid.innerHTML = plan.execution.map((item) => `
    <article class="metric-card">
      <span>步骤 ${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join("");
}

function renderActions(actions) {
  elements.actionList.innerHTML = "";
}

function renderRewriteCards(plan) {
  if (!plan || (!plan.cards.length && !plan.copy.length)) {
    elements.rewriteCards.innerHTML = "";
    return;
  }

  const issueCards = plan.cards.map((card) => `
    <article class="rewrite-card issue-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.body)}</p>
    </article>
  `).join("");
  const copyCard = plan.copy.length ? `
    <article class="rewrite-card copy-card">
      <span>修改后文案</span>
      <strong>成品文案</strong>
      <ol>
        ${plan.copy.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
      </ol>
    </article>
  ` : "";

  elements.rewriteCards.innerHTML = issueCards + copyCard;
}

function renderBenchmarkGuidance(cards) {
  if (!elements.benchmarkList) return;
  const safeCards = Array.isArray(cards) && cards.length ? cards : buildBenchmarkGuidance({ ready: false });
  elements.benchmarkList.innerHTML = safeCards.map((card) => `
    <article class="benchmark-card">
      <span>${escapeHtml(card.tag)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${escapeHtml(card.body)}</p>
    </article>
  `).join("") + `
    <a class="benchmark-action" href="${officialBenchmarkUrl}" target="_blank" rel="noopener">
      去官方库看对标视频
    </a>
  `;
}

function renderPendingPanels() {
  if (!state.videoLoaded) return;

  elements.verdictBadge.textContent = "缓存中";
  elements.verdictBadge.className = "pill warning";
  elements.scoreValue.textContent = "--";
  elements.scoreBar.style.width = "0";
  elements.scoreBar.style.background = "";
  elements.verdictText.textContent = "正在提取文案和拍摄素材，完成后生成投前判断。";
  elements.riskList.innerHTML = loadingCards(["文案缓存中", "画面缓存中", "投前判断缓存中"], "risk-card");

  elements.structureFormula.innerHTML = ["文案主线缓存中", "拍摄素材缓存中", "衔接关系缓存中"]
    .map((item) => `<span class="loading-chip">${escapeHtml(item)}</span>`)
    .join("");
  elements.structureRows.innerHTML = loadingRows([
    "正在整理口播文案结构",
    "正在等待画面素材顺序",
    "正在匹配文案和画面是否连贯",
  ]);

  elements.intentGrid.innerHTML = loadingCards(["商品", "卖点", "痛点", "优惠", "场景", "画面证据"], "intent-card");
  elements.audienceGrid.innerHTML = loadingCards(["吸引人群缓存中", "消费动机缓存中", "投放人群缓存中"], "audience-card");
  elements.metricGrid.innerHTML = loadingCards(["痛点钩子缓存中", "项目承接缓存中", "过程证明缓存中", "团购收口缓存中"], "metric-card");
  elements.actionList.innerHTML = "";
  elements.rewriteCards.innerHTML = `
    <article class="rewrite-card issue-card loading-card">
      <span>问题 1</span>
      <strong>框架缓存中</strong>
      <p><span class="loading-line"></span></p>
    </article>
    <article class="rewrite-card issue-card loading-card">
      <span>问题 2</span>
      <strong>开头缓存中</strong>
      <p><span class="loading-line"></span></p>
    </article>
    <article class="rewrite-card copy-card loading-card">
      <span>修改后文案</span>
      <strong>成品文案缓存中</strong>
      <p><span class="loading-line"></span></p>
    </article>
  `;
  renderBenchmarkGuidance([
    {
      tag: "匹配中",
      title: "正在匹配官方对标方向",
      body: "系统会根据问题点判断该看开头、过程画面、团购收口还是完整框架。",
    },
  ]);
  elements.reportOutput.value = [
    "正在提取普通话文案和拍摄素材...",
    "识别完成后将生成：",
    "1. 框架怎么改",
    "2. 开头怎么改",
    "3. 文案怎么改",
    "4. 成品文案",
  ].join("\n");
}

function loadingCards(titles, className) {
  return titles.map((title) => `
    <article class="${className} loading-card">
      <strong>${escapeHtml(title)}</strong>
      <p><span class="loading-line"></span></p>
    </article>
  `).join("");
}

function loadingRows(rows) {
  return rows.map((text) => `
    <article class="structure-row loading-card">
      <strong>${escapeHtml(text)}</strong>
      <p><span class="loading-line"></span></p>
    </article>
  `).join("");
}

function renderEmpty() {
  syncAppStateClasses();
  const result = {
    transcript: "",
    visual: { formula: [], segments: [], text: "" },
    structure: {
      formula: ["待识别"],
      buckets: [
        { label: "文案主线", copy: "等待自动识别普通话文案" },
        { label: "画面主线", copy: "等待自动抽帧并生成拍摄素材" },
        { label: "衔接判断", copy: "识别完成后自动判断文案和画面是否连贯" },
      ],
      opening: "",
      ending: "",
      hasPainOpening: false,
      hasBenefitOpening: false,
    },
    intent: [
      ["推广商品", "待识别"],
      ["产品卖点", "待识别"],
      ["用户痛点", "待识别"],
      ["优惠活动", "待识别"],
      ["适用场景", "待识别"],
      ["画面证据", "待识别"],
      ["脚本结构", "待识别"],
      ["引导购买", "待识别"],
    ],
    audience: [{ name: "待识别人群", reason: "导入视频后自动判断", score: 0 }],
    metrics: {
      score: 0,
      structureScore: 0,
      clarityScore: 0,
      audioScore: 0,
      densityScore: 0,
      rate3: 0,
      rate5: 0,
      ctr: 0,
      cvr: 0,
      costRisk: "待识别",
      stage: "待识别",
    },
    verdict: { label: "等待生成", className: "warning", text: "导入视频后，系统会先识别文案和画面，再生成投前判断。" },
    risks: [["等待识别", "上传视频后会显示加载状态，识别完成后自动填充结果。"]],
    actions: [],
    rewritten: "",
    rewritePlan: emptyRewritePlan(),
  };
  renderAnalysis(result);
  elements.scoreValue.textContent = "--";
  elements.scoreBar.style.width = "0";
  elements.understandingLoading.hidden = true;
  elements.actionList.innerHTML = "";
  elements.rewriteCards.innerHTML = "";
  renderBenchmarkGuidance(buildBenchmarkGuidance({ ready: false }));
  elements.reportOutput.value = "";
}

function normalizeMandarinTranscript(text) {
  const raw = String(text || "").trim();
  if (raw.length <= 8 && /HK/i.test(raw)) return "";
  return raw
    .replace(/\[[^\]]+\]/g, "")
    .replace(/嗯+|啊+|呃+|这个这个|然后然后/g, "")
    .replace(/六十九点九/g, "69.9")
    .replace(/六十九块九/g, "69.9元")
    .replace(/六十分钟/g, "60分钟")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([。！？!?])\s*/g, "$1\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function pickKeywords(text, keywords) {
  return keywords.filter((keyword) => text.includes(keyword));
}

function reasonForAudience(name) {
  const map = {
    新锐白领: "肩颈、下班、商场和到店放松需求强",
    Z世代: "黑头、卡粉、熬夜脸和颜值改善需求强",
    都市蓝领: "身体疲劳、按摩放松和价格敏感度高",
    精致妈妈: "护理、清洁、补水和放松场景匹配",
    小镇青年: "优惠、团购和性价比信息容易触发点击",
  };
  return map[name] || "与视频痛点和场景有匹配";
}

function isBenefitStacked(intent) {
  const benefit = Object.fromEntries(intent)["产品卖点"] || "";
  return splitField(benefit).length >= 6;
}

function splitField(value) {
  if (!value || value.includes("待")) return [];
  return value.split(/[、，,+]/).map((item) => item.trim()).filter(Boolean);
}

function fallbackBenefitsFromVisual(visual) {
  const text = visual && visual.formula ? visual.formula.join(" ") : "";
  if (/清洁|面部|肤况|黑头|白头/.test(text)) return ["面部清洁过程", "肤况改善"];
  if (/肩颈|按摩|放松/.test(text)) return ["肩颈放松", "服务手法"];
  if (/团购|价格|权益/.test(text)) return ["价格权益"];
  return ["核心服务卖点"];
}

function fallbackPainsFromStructure(structure) {
  const text = structure && structure.formula ? structure.formula.join(" ") : "";
  if (/痛点/.test(text)) return ["当前痛点"];
  if (/价格|利益/.test(text)) return ["价格敏感"];
  return ["目标用户问题"];
}

function cleanFallback(value, fallback) {
  return !value || value.includes("待") ? fallback : value;
}

function clampMetric(value, min, max) {
  return Number(Math.max(min, Math.min(max, value)).toFixed(2));
}

function scoreColor(score) {
  if (score >= 78) return "#047857";
  if (score >= 58) return "#b45309";
  return "#b42318";
}

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const minute = Math.floor(total / 60);
  const second = String(total % 60).padStart(2, "0");
  return `${minute}:${second}`;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function isVisualFormulaItem(item) {
  return item.startsWith("画面结构") || item.startsWith("拍摄素材");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function copyReport() {
  const text = elements.reportOutput.value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);
  }
  elements.copyBtn.textContent = "已复制";
  setTimeout(() => {
    elements.copyBtn.textContent = "复制结果";
  }, 1000);
}

function legacyCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function bindDrop() {
  elements.videoDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.videoDrop.style.borderColor = "#2563eb";
  });
  elements.videoDrop.addEventListener("dragleave", () => {
    elements.videoDrop.style.borderColor = "";
  });
  elements.videoDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.videoDrop.style.borderColor = "";
    setVideo(event.dataTransfer.files[0]);
  });
}

elements.videoInput.addEventListener("change", (event) => setVideo(event.target.files[0]));
elements.captureBtn.addEventListener("click", async () => {
  await captureFrames();
  autoDescribeVisual();
});
elements.transcribeBtn.addEventListener("click", () => transcribeVideo());
elements.visionBtn.addEventListener("click", () => autoDescribeVisual());
elements.analyzeBtn.addEventListener("click", analyzeVideo);
elements.copyBtn.addEventListener("click", copyReport);
elements.transcriptInput.addEventListener("input", () => {
  if (state.visualAuto) autoDescribeVisual();
  analyzeVideo();
});
elements.visualInput.addEventListener("input", () => {
  state.visualAuto = false;
  analyzeVideo();
});

bindDrop();
renderEmpty();
