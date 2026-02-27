/* =========================
   App State
========================= */
const state = {
  guest: {
    guestId: null,
    fullName: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    gender: "",
    dob: "",     // store DOB even if UI only shows age
    age: "",
    idType: "",
    idNumber: "",
    rawScan: ""
  },
  stay: {
    checkIn: "",
    checkOut: "",
    adults: "",
    children: "0",
    room: "",
    dailyRate: "",
    deposit: "0",
    discount: "0",
    nights: 0
  },
  booking: {
    bookingId: "",
    total: 0
  },
  payment: {
    method: "",
    transactionId: "",
    transactionType: ""
  }
};

/* =========================
   Helpers
========================= */
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

function navigate(screenId){
  $all(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");
  window.scrollTo(0,0);
}

function showSnackbar(message){
  $("#snackbarMsg").textContent = message;
  $("#snackbar").classList.add("show");
}
function hideSnackbar(){
  $("#snackbar").classList.remove("show");
}

function setFieldError(fieldId, msg){
  const input = document.getElementById(fieldId);
  const err = document.querySelector(`[data-error-for="${fieldId}"]`);
  if (input) input.classList.toggle("input-error", Boolean(msg));
  if (err) err.textContent = msg || "";
}

function clearErrors(formRoot){
  formRoot.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
  formRoot.querySelectorAll(".field-error").forEach(el => el.textContent = "");
}

function onlyDigits(str){ return (str || "").replace(/\D/g, ""); }

function calcAgeFromDOB(dobYYYYMMDD){
  if (!dobYYYYMMDD || dobYYYYMMDD.length < 8) return "";
  const y = Number(dobYYYYMMDD.slice(0,4));
  const m = Number(dobYYYYMMDD.slice(4,6));
  const d = Number(dobYYYYMMDD.slice(6,8));
  if (!y || !m || !d) return "";

  const today = new Date();
  const dob = new Date(y, m - 1, d);
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
  return String(Math.max(0, age));
}

function nightsBetween(checkInISO, checkOutISO){
  if (!checkInISO || !checkOutISO) return 0;
  const a = new Date(checkInISO);
  const b = new Date(checkOutISO);
  const diff = b - a;
  const nights = Math.round(diff / (1000*60*60*24));
  return Number.isFinite(nights) ? nights : 0;
}

function formatMoney(n){
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/* =========================
   US States Dropdown
========================= */
const US_STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
  ["DC","District of Columbia"]
];

function initStateDropdown(){
  const sel = $("#state");
  US_STATES.forEach(([abbr, name]) => {
    const opt = document.createElement("option");
    opt.value = abbr;
    opt.textContent = name;
    sel.appendChild(opt);
  });
}

/* =========================
   AAMVA Parsing (practical implementation)
========================= */
function parseAamva(raw){
  if (!raw || raw.trim().length < 10) return { ok:false, reason:"empty" };

  const text = raw.replace(/\r/g, "");
  const fields = {};
  const known = ["DAC","DAD","DCS","DAG","DAI","DAJ","DAK","DBC","DBB","DAQ"];

  known.forEach(code => {
    const m = text.match(new RegExp(`${code}([^\\n\\r]*)`));
    if (m && m[1] != null) fields[code] = m[1].trim();
  });

  if (!fields.DAC && !fields.DCS && !fields.DAQ) {
    return { ok:false, reason:"missing_critical" };
  }

  return { ok:true, fields, raw:text };
}

/* =========================
   Mapping Rules (per spec)
========================= */
function applyScanToRegistration(parsed){
  const { fields, raw } = parsed;

  const first = (fields.DAC || "").trim();
  const middle = (fields.DAD || "").trim();
  const last = (fields.DCS || "").trim();
  const fullName = [first, middle, last].filter(Boolean).join(" ").trim();

  const street = (fields.DAG || "").trim();
  const city = (fields.DAI || "").trim();

  const scannedState = (fields.DAJ || "").trim().toUpperCase();
  const stateMatches = US_STATES.some(([abbr]) => abbr === scannedState);

  const zipRaw = (fields.DAK || "").trim();
  const zip5 = onlyDigits(zipRaw).slice(0,5);

  const genderRaw = (fields.DBC || "").trim().toUpperCase();
  let gender = "";
  if (genderRaw === "1" || genderRaw === "M" || genderRaw === "MALE") gender = "Male";
  else if (genderRaw === "2" || genderRaw === "F" || genderRaw === "FEMALE") gender = "Female";
  else if (genderRaw === "9" || genderRaw === "U" || genderRaw === "UNKNOWN" || genderRaw) gender = "Other";

  const dob = (fields.DBB || "").trim();
  const age = calcAgeFromDOB(dob);

  const idNumber = (fields.DAQ || "").trim();

  state.guest.rawScan = raw;
  state.guest.fullName = fullName || state.guest.fullName;
  state.guest.street = street || state.guest.street;
  state.guest.city = city || state.guest.city;
  state.guest.zip = zip5 || state.guest.zip;
  state.guest.gender = gender || state.guest.gender;
  state.guest.dob = dob || state.guest.dob;
  state.guest.age = age || state.guest.age;
  state.guest.idNumber = idNumber || state.guest.idNumber;

  $("#fullName").value = state.guest.fullName;
  $("#street").value = state.guest.street;
  $("#city").value = state.guest.city;
  $("#zip").value = state.guest.zip;
  $("#gender").value = state.guest.gender || "";
  $("#age").value = state.guest.age || "";
  $("#idNumber").value = state.guest.idNumber || "";
  $("#dob").value = state.guest.dob || "";
  $("#rawScan").value = state.guest.rawScan || "";

  if (stateMatches) {
    $("#state").value = scannedState;
    setFieldError("state", "");
  } else if (scannedState) {
    $("#state").value = "";
    setFieldError("state", "Scanned state not recognized. Please select manually.");
  }

  if (zipRaw && zip5.length !== 5) {
    setFieldError("zip", "Invalid ZIP from scan. Please enter 5 digits.");
  }
}

/* =========================
   Returning vs New Guest (demo)
========================= */
function decideReturningGuest(){
  const id = (state.guest.idNumber || "").trim();
  if (!id) return "new";
  const digits = onlyDigits(id);
  const last = digits ? Number(digits[digits.length - 1]) : NaN;
  return Number.isFinite(last) && last % 2 === 0 ? "returning" : "new";
}

/* =========================
   Booking total computation
========================= */
function computeTotal(){
  const nights = state.stay.nights || 0;
  const rate = Number(state.stay.dailyRate || 0);
  const deposit = Number(state.stay.deposit || 0);
  const discount = Number(state.stay.discount || 0);
  const total = Math.max(0, (nights * rate) + deposit - discount);
  state.booking.total = total;
  return total;
}

/* =========================
   Summary rendering
========================= */
(function injectSummaryRowStyle(){
  const css = `
    .summary-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eee;}
    .summary-row:last-child{border-bottom:none;}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

function renderBookingSummary(){
  const lines = [
    ["Guest", state.guest.fullName || "—"],
    ["ID", `${state.guest.idType || "—"} • ${state.guest.idNumber || "—"}`],
    ["Check-in", state.stay.checkIn || "—"],
    ["Check-out", state.stay.checkOut || "—"],
    ["Nights", String(state.stay.nights || 0)],
    ["Room", state.stay.room || "—"],
    ["Guests", `${state.stay.adults || "—"} adults, ${state.stay.children || "0"} children`],
    ["Daily rate", formatMoney(state.stay.dailyRate)],
    ["Deposit", formatMoney(state.stay.deposit)],
    ["Discount", formatMoney(state.stay.discount)]
  ];

  const container = $("#summaryLines");
  container.innerHTML = "";
  lines.forEach(([k,v]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    row.innerHTML = `<div class="muted">${k}</div><div><b>${v}</b></div>`;
    container.appendChild(row);
  });

  const total = computeTotal();
  $("#totalAmount").textContent = formatMoney(total);
  $("#cardTotalAmount").textContent = formatMoney(total);
  $("#cashTotalAmount").textContent = formatMoney(total);
  $("#nfcTotalAmount").textContent = formatMoney(total);
}

function renderNfcSummary(){
  const container = $("#nfcSummaryLines");
  container.innerHTML = "";
  const lines = [
    ["Guest", state.guest.fullName || "—"],
    ["Room", state.stay.room || "—"]
  ];
  lines.forEach(([k,v]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    row.innerHTML = `<div class="muted">${k}</div><div><b>${v}</b></div>`;
    container.appendChild(row);
  });
}

function renderTransactionDetails(targetId, method){
  const bookingId = state.booking.bookingId || "BK-" + Math.random().toString(16).slice(2,8).toUpperCase();
  state.booking.bookingId = bookingId;

  const txnId = state.payment.transactionId || "TX-" + Math.random().toString(16).slice(2,10).toUpperCase();
  state.payment.transactionId = txnId;

  const txnType = method === "cash" ? "Cash" : (state.payment.transactionType || "NFC");
  const total = formatMoney(state.booking.total);

  const lines = [
    ["Booking ID", bookingId],
    ["Transaction Type", txnType],
    ["Transaction ID", txnId],
    ["Total Amount", total]
  ];

  const container = document.getElementById(targetId);
  container.innerHTML = "";
  lines.forEach(([k,v]) => {
    const row = document.createElement("div");
    row.className = "summary-row";
    row.innerHTML = `<div class="muted">${k}</div><div><b>${v}</b></div>`;
    container.appendChild(row);
  });
}

/* =========================
   Validation
========================= */
function validateRegistration(){
  const form = $("#registrationForm");
  clearErrors(form);

  state.guest.fullName = $("#fullName").value.trim();
  state.guest.street = $("#street").value.trim();
  state.guest.city = $("#city").value.trim();
  state.guest.state = $("#state").value.trim();
  state.guest.zip = $("#zip").value.trim();
  state.guest.gender = $("#gender").value.trim();
  state.guest.age = $("#age").value.trim();
  state.guest.idType = $("#idType").value.trim();
  state.guest.idNumber = $("#idNumber").value.trim();
  state.guest.dob = $("#dob").value.trim();
  state.guest.rawScan = $("#rawScan").value.trim();

  let ok = true;

  if (!state.guest.fullName){ setFieldError("fullName","Full name is required."); ok=false; }
  if (!state.guest.street){ setFieldError("street","Street address is required."); ok=false; }
  if (!state.guest.city){ setFieldError("city","City is required."); ok=false; }
  if (!state.guest.state){ setFieldError("state","State is required."); ok=false; }

  const zipDigits = onlyDigits(state.guest.zip);
  if (zipDigits.length !== 5){ setFieldError("zip","ZIP must be 5 digits."); ok=false; }

  if (!state.guest.gender){ setFieldError("gender","Gender is required."); ok=false; }

  const ageNum = Number(state.guest.age);
  if (!state.guest.age || !Number.isFinite(ageNum) || ageNum < 0){
    setFieldError("age","Age must be a valid number.");
    ok=false;
  }

  if (!state.guest.idNumber){ setFieldError("idNumber","Identification number is required."); ok=false; }

  if (!state.guest.idType){
    setFieldError("idType","Please select DL or ID.");
    ok=false;
  }

  return ok;
}

function validateStayDetails(){
  const form = $("#stayForm");
  clearErrors(form);

  state.stay.checkIn = $("#checkIn").value;
  state.stay.checkOut = $("#checkOut").value;
  state.stay.adults = $("#adults").value;
  state.stay.children = $("#children").value;
  state.stay.room = $("#room").value;
  state.stay.dailyRate = $("#dailyRate").value;
  state.stay.deposit = $("#deposit").value || "0";
  state.stay.discount = $("#discount").value || "0";

  let ok = true;

  if (!state.stay.checkIn){ setFieldError("checkIn","Check-in is required."); ok=false; }
  if (!state.stay.checkOut){ setFieldError("checkOut","Check-out is required."); ok=false; }

  if (state.stay.checkIn && state.stay.checkOut){
    const nights = nightsBetween(state.stay.checkIn, state.stay.checkOut);
    if (nights <= 0){
      setFieldError("checkOut","Check-out must be after check-in.");
      ok=false;
    } else {
      state.stay.nights = nights;
      $("#nightsValue").textContent = String(nights);
    }
  } else {
    $("#nightsValue").textContent = "—";
  }

  if (!state.stay.adults){ setFieldError("adults","Adults is required."); ok=false; }
  if (!state.stay.room){ setFieldError("room","Room is required."); ok=false; }
  if (!state.stay.dailyRate){ setFieldError("dailyRate","Daily rate is required."); ok=false; }

  const dep = Number(state.stay.deposit);
  if (!Number.isFinite(dep) || dep < 0){ setFieldError("deposit","Deposit must be >= 0."); ok=false; }

  const disc = Number(state.stay.discount);
  if (!Number.isFinite(disc) || disc < 0){ setFieldError("discount","Discount must be >= 0."); ok=false; }

  return ok;
}

function validateManualCard(){
  const form = $("#cardForm");
  clearErrors(form);

  const cardNumber = onlyDigits($("#cardNumber").value);
  const expiry = $("#expiry").value.trim();
  const cvv = onlyDigits($("#cvv").value);
  const name = $("#cardName").value.trim();
  const zip = onlyDigits($("#cardZip").value);

  let ok = true;

  if (cardNumber.length < 12){ setFieldError("cardNumber","Enter a valid card number."); ok=false; }
  if (!/^\d{2}\/\d{2}$/.test(expiry)){ setFieldError("expiry","Use MM/YY."); ok=false; }
  if (cvv.length < 3){ setFieldError("cvv","CVV is required."); ok=false; }
  if (!name){ setFieldError("cardName","Name is required."); ok=false; }
  if (zip.length !== 5){ setFieldError("cardZip","ZIP must be 5 digits."); ok=false; }

  return ok;
}

/* =========================
   Confirm discard
========================= */
function confirmDiscard(){
  return window.confirm("Discard check-in?");
}

/* =========================
   REAL PDF417 Scanner (BarcodeDetector + ZXing fallback)
========================= */
const Pdf417Scanner = (() => {
  let stream = null;
  let devices = [];
  let currentDeviceId = null;
  let running = false;
  let paused = false;
  let torchOn = false;
  let stopLoop = false;
  let loopTimer = null;

  let detector = null;
  let zxing = null;
  let zxingReader = null;
  let decodeHints = null;

  let lastText = "";
  let lastAt = 0;

  const SCAN_INTERVAL_MS = 110;

  function setStatus(msg){
    const el = document.getElementById("scannerStatus");
    if (el) el.textContent = msg;
  }

  function setEngine(name, kind = ""){
    const el = document.getElementById("enginePill");
    if (!el) return;
    el.textContent = `Engine: ${name}`;
    el.className = `pill ${kind}`.trim();
  }

  function setCameraState(name, kind = ""){
    const el = document.getElementById("cameraPill");
    if (!el) return;
    el.textContent = `Camera: ${name}`;
    el.className = `pill ${kind}`.trim();
  }

  function syncButtons(){
    const startBtn = document.getElementById("startScannerBtn");
    const stopBtn = document.getElementById("stopScannerBtn");
    const pauseBtn = document.getElementById("pauseResumeBtn");

    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
    if (pauseBtn) {
      pauseBtn.disabled = !running;
      pauseBtn.textContent = paused ? "Resume" : "Pause";
    }
  }

  function getVideo(){
    return document.getElementById("scannerVideo");
  }

  function getCanvasCtx(){
    const canvas = document.getElementById("scannerCanvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return { canvas, ctx };
  }

  function getGuideRect(){
    const guide = document.getElementById("scanGuide");
    return guide ? guide.getBoundingClientRect() : null;
  }

  function pointsToViewportRect(points, videoEl){
    const vr = videoEl.getBoundingClientRect();
    if (!points || points.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    return {
      left: vr.left + minX,
      top: vr.top + minY,
      right: vr.left + maxX,
      bottom: vr.top + maxY
    };
  }

  function isRectInsideGuide(box, guide){
    if (!box || !guide) return false;
    return (
      box.left >= guide.left &&
      box.top >= guide.top &&
      box.right <= guide.right &&
      box.bottom <= guide.bottom
    );
  }

  async function initEngine(){
    if (detector || zxingReader) return;

    if ("BarcodeDetector" in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.();
        const supportsPdf417 = Array.isArray(formats) && formats.includes("pdf417");
        if (supportsPdf417) {
          detector = new window.BarcodeDetector({ formats: ["pdf417"] });
          setEngine("BarcodeDetector", "ok");
          return;
        }
        setEngine("BarcodeDetector(no pdf417) → ZXing", "warn");
      } catch {
        setEngine("BarcodeDetector error → ZXing", "warn");
      }
    } else {
      setEngine("ZXing fallback", "warn");
    }

    zxing = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm");
    zxingReader = new zxing.MultiFormatReader();
    decodeHints = new Map();
    decodeHints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.PDF_417]);
    decodeHints.set(zxing.DecodeHintType.TRY_HARDER, true);
    zxingReader.setHints(decodeHints);
    setEngine("ZXing (@zxing/library)", "ok");
  }

  async function refreshCameras(){
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all.filter(d => d.kind === "videoinput");
    if (!devices.length) {
      currentDeviceId = null;
      return;
    }
    const preferred = devices.find(d => /back|rear|environment/i.test(d.label));
    currentDeviceId = currentDeviceId || preferred?.deviceId || devices[0].deviceId;
  }

  async function start(deviceId = null){
    const videoEl = getVideo();
    if (!videoEl) return;

    await stop();
    setStatus("Requesting camera…");

    try {
      await initEngine();

      const constraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      await videoEl.play();

      const track = stream.getVideoTracks?.()[0];
      const settings = track?.getSettings?.() || {};
      if (settings.deviceId) currentDeviceId = settings.deviceId;

      await refreshCameras();

      running = true;
      paused = false;
      torchOn = false;
      stopLoop = false;

      setCameraState("running", "ok");
      syncButtons();
      updateTorchAvailability();
      setStatus("Scanning for PDF417…");

      scanLoop();
    } catch (e) {
      console.error(e);
      setCameraState("blocked", "warn");
      syncButtons();
      setStatus("Camera unavailable or permission denied.");
      showSnackbar("Auto-fill failed. Please enter details manually.");
      navigate("guestRegistration");
    }
  }

  async function stop(){
    stopLoop = true;
    running = false;
    paused = false;
    torchOn = false;

    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }

    const videoEl = getVideo();
    if (videoEl) {
      videoEl.pause();
      videoEl.srcObject = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    setCameraState("idle");
    syncButtons();
    const torchBtn = document.getElementById("torchBtn");
    if (torchBtn) torchBtn.disabled = true;
  }

  function togglePause(){
    if (!running) return;
    paused = !paused;
    syncButtons();
    setStatus(paused ? "Paused." : "Scanning for PDF417…");
  }

  async function switchCamera(){
    if (!devices.length) await refreshCameras();
    if (devices.length < 2){
      showSnackbar("No second camera found.");
      return;
    }
    const idx = devices.findIndex(d => d.deviceId === currentDeviceId);
    const next = devices[(idx + 1) % devices.length];
    currentDeviceId = next.deviceId;
    await start(currentDeviceId);
  }

  function getActiveTrack(){
    return stream?.getVideoTracks?.()[0] || null;
  }

  function updateTorchAvailability(){
    const torchBtn = document.getElementById("torchBtn");
    if (!torchBtn) return;

    const track = getActiveTrack();
    const caps = track?.getCapabilities?.();
    const hasTorch = Boolean(caps?.torch);
    torchBtn.disabled = !hasTorch;
  }

  async function toggleTorch(){
    const track = getActiveTrack();
    if (!track?.getCapabilities) {
      showSnackbar("Flash not available.");
      return;
    }

    const caps = track.getCapabilities();
    if (!caps.torch){
      showSnackbar("Flash not supported on this device.");
      return;
    }

    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      showSnackbar(torchOn ? "Flash ON" : "Flash OFF");
    } catch (e) {
      console.error(e);
      showSnackbar("Flash toggle failed.");
    }
  }

  function publish(rawText){
    const text = (rawText || "").trim();
    if (!text) return;

    const now = Date.now();
    if (text === lastText && now - lastAt < 1500) return;
    lastText = text;
    lastAt = now;

    onScanSuccess(text);
  }

  function decodeWithZxing(imageData, width, height){
    if (!zxing || !zxingReader) return "";
    const luminance = new zxing.RGBLuminanceSource(imageData.data, width, height);
    const binarizer = new zxing.HybridBinarizer(luminance);
    const bitmap = new zxing.BinaryBitmap(binarizer);
    const result = zxingReader.decode(bitmap, decodeHints);
    return result?.getText?.() || "";
  }

  async function scanLoop(){
    if (stopLoop || !running) return;

    try {
      if (!paused) {
        const videoEl = getVideo();
        if (detector) {
          const barcodes = await detector.detect(videoEl);
          if (barcodes?.length) {
            const first = barcodes[0];
            const guide = getGuideRect();
            const points = first.cornerPoints || [];
            const box = pointsToViewportRect(points, videoEl);
            if (!guide || !box || isRectInsideGuide(box, guide)) {
              publish(first.rawValue || "");
            } else {
              setStatus("Align barcode fully inside the guide…");
            }
          }
        } else if (zxingReader && videoEl && videoEl.readyState >= 2) {
          const w = videoEl.videoWidth;
          const h = videoEl.videoHeight;
          if (w > 0 && h > 0) {
            const canvasBundle = getCanvasCtx();
            if (canvasBundle) {
              const { canvas, ctx } = canvasBundle;
              const cropW = Math.floor(w * 0.9);
              const cropH = Math.floor(h * 0.55);
              const sx = Math.floor((w - cropW) / 2);
              const sy = Math.floor((h - cropH) / 2);

              canvas.width = cropW;
              canvas.height = cropH;
              ctx.drawImage(videoEl, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

              const imageData = ctx.getImageData(0, 0, cropW, cropH);
              try {
                const text = decodeWithZxing(imageData, cropW, cropH);
                publish(text);
              } catch {
                // No barcode found on this frame.
              }
            }
          }
        }
      }
    } catch {
      setStatus("Scanning… try better light or move closer.");
    }

    loopTimer = setTimeout(scanLoop, SCAN_INTERVAL_MS);
  }

  async function scanImageFile(file){
    if (!file) return;
    await initEngine();

    const canvasBundle = getCanvasCtx();
    if (!canvasBundle) return;
    const { canvas, ctx } = canvasBundle;

    const image = new Image();
    image.src = URL.createObjectURL(file);
    await image.decode();

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);

    if (detector) {
      const barcodes = await detector.detect(canvas);
      if (barcodes?.length) {
        publish(barcodes[0].rawValue || "");
        return;
      }
      setStatus("No PDF417 found in the image.");
      return;
    }

    if (zxingReader) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      try {
        const text = decodeWithZxing(imageData, canvas.width, canvas.height);
        publish(text);
      } catch {
        setStatus("No PDF417 found in the image.");
      }
    }
  }

  function onScanSuccess(rawText){
    stop();
    setStatus("PDF417 detected. Parsing…");

    const parsed = parseAamva(rawText);
    if (!parsed.ok){
      navigate("guestRegistration");
      showSnackbar("Auto-fill failed. Please enter details manually.");
      return;
    }

    navigate("guestRegistration");
    applyScanToRegistration(parsed);
    showSnackbar("Details auto-filled.");

    const decision = decideReturningGuest();
    setTimeout(() => {
      if (decision === "returning") {
        $("#returningName").textContent = state.guest.fullName || "Guest";
        $("#returningMeta").textContent = `${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("returningGuest");
      } else {
        $("#newGuestSummary").textContent =
          `${state.guest.fullName || "Guest"} • ${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("newGuest");
      }
    }, 250);
  }

  return {
    start,
    stop,
    togglePause,
    switchCamera,
    toggleTorch,
    scanImageFile,
    initEngine,
    setStatus
  };
})();

/* Start/stop scanner on navigation */
const _navigate = navigate;
navigate = function(screenId){
  _navigate(screenId);
  if (screenId === "scanner") Pdf417Scanner.start();
  else Pdf417Scanner.stop();
};

/* =========================
   Wiring
========================= */
function wireNav(){
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nav]");
    if (!btn) return;
    const to = btn.getAttribute("data-nav");
    if (to) navigate(to);
  });

  $("#snackbarCloseBtn").addEventListener("click", hideSnackbar);

  $all('[data-action="other"]').forEach(b => b.addEventListener("click", () => {
    showSnackbar("Module not included in this flow.");
  }));
  $all('[data-action="logout"]').forEach(b => b.addEventListener("click", () => {
    showSnackbar("Logout confirmation not implemented in this demo.");
  }));
  $all('[data-action="profile"]').forEach(b => b.addEventListener("click", () => {
    showSnackbar("Profile screen not implemented in this demo.");
  }));
}

function wireRegistration(){
  $("#registrationNextBtn").addEventListener("click", () => {
    const ok = validateRegistration();
    if (!ok){
      showSnackbar("Please Complete All the Required Fields.");
      return;
    }
    navigate("stayDetails");
  });
}

function wireReturningNewGuest(){
  $("#returningProceedBtn").addEventListener("click", () => {
    state.guest.guestId = "G-" + Math.random().toString(16).slice(2,8).toUpperCase();
    navigate("stayDetails");
  });

  $("#newGuestSkipBtn").addEventListener("click", () => {
    state.guest.guestId = null;
    navigate("stayDetails");
  });

  $("#newGuestSaveBtn").addEventListener("click", () => {
    state.guest.guestId = "G-" + Math.random().toString(16).slice(2,8).toUpperCase();
    $("#newGuestDetails").textContent = `Guest created: ${state.guest.guestId}`;
    navigate("stayDetails");
  });
}

function wireStayDetails(){
  ["checkIn","checkOut"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      const ci = $("#checkIn").value;
      const co = $("#checkOut").value;
      const n = nightsBetween(ci, co);
      $("#nightsValue").textContent = n > 0 ? String(n) : "—";
      state.stay.nights = n > 0 ? n : 0;
    });
  });

  $("#stayCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });

  $("#stayNextBtn").addEventListener("click", () => {
    const ok = validateStayDetails();
    if (!ok){
      showSnackbar("Please Complete All the Required Fields.");
      return;
    }
    renderBookingSummary();
    navigate("bookingSummary");
  });
}

function wireBookingSummary(){
  $("#summaryCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });

  $("#payCashBtn").addEventListener("click", () => {
    state.payment.method = "cash";
    navigate("cashConfirm");
  });

  $("#payCardBtn").addEventListener("click", () => {
    state.payment.method = "card";
    navigate("cardPayment");
  });
}

function wirePayments(){
  $("#cardCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });
  $("#cashCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });

  $("#tapToPayBtn").addEventListener("click", () => {
    state.payment.transactionType = "NFC";
    renderNfcSummary();
    navigate("tapToPay");
  });

  $("#cardProceedBtn").addEventListener("click", () => {
    const ok = validateManualCard();
    if (!ok){
      showSnackbar("Please Complete All the Required Fields.");
      return;
    }
    state.payment.transactionType = "Manual";
    startProcessingAndRoute();
  });

  $("#simulateNfcTapBtn").addEventListener("click", () => {
    startProcessingAndRoute();
  });

  $("#cashYesBtn").addEventListener("click", () => {
    state.payment.transactionType = "Cash";
    state.payment.transactionId = "";
    navigate("cashSuccess");
    renderTransactionDetails("cashSuccessDetails", "cash");
  });
}

function startProcessingAndRoute(){
  navigate("paymentProcessing");

  const digits = onlyDigits($("#cardNumber")?.value || "");
  const last = digits ? digits[digits.length - 1] : "";
  const decline = (last === "0" || last === "5") && state.payment.transactionType !== "NFC";

  setTimeout(() => {
    if (decline){
      navigate("cardDeclined");
      $("#declinedDetails").innerHTML = `
        <div class="summary-row"><div class="muted">Reason</div><div><b>Issuer declined</b></div></div>
        <div class="summary-row"><div class="muted">Total</div><div><b>${formatMoney(state.booking.total)}</b></div></div>
      `;
    } else {
      navigate("cardSuccess");
      renderTransactionDetails("cardSuccessDetails", "card");
    }
  }, 1200);
}

function wireReceipt(){
  $("#printReceiptFromCardBtn").addEventListener("click", () => navigate("receiptPrinted"));
  $("#printReceiptFromCashBtn").addEventListener("click", () => navigate("receiptPrinted"));

  $("#shareBtn").addEventListener("click", async () => {
    const text = `Receipt: ${state.booking.bookingId} • ${formatMoney(state.booking.total)}`;
    if (navigator.share){
      try { await navigator.share({ title: "Receipt", text }); }
      catch {}
    } else {
      showSnackbar("Share not supported in this browser.");
    }
  });

  $("#doneBtn").addEventListener("click", () => {
    resetFlow();
    navigate("dashboard");
  });
}

function resetFlow(){
  state.guest = { guestId:null, fullName:"", street:"", city:"", state:"", zip:"", gender:"", dob:"", age:"", idType:"", idNumber:"", rawScan:"" };
  state.stay = { checkIn:"", checkOut:"", adults:"", children:"0", room:"", dailyRate:"", deposit:"0", discount:"0", nights:0 };
  state.booking = { bookingId:"", total:0 };
  state.payment = { method:"", transactionId:"", transactionType:"" };

  $("#registrationForm").reset();
  $("#stayForm").reset();
  $("#cardForm").reset();
  $("#nightsValue").textContent = "—";
}

function wireScannerUI(){
  $("#startScannerBtn")?.addEventListener("click", async () => {
    Pdf417Scanner.setStatus("Requesting camera permission…");
    await Pdf417Scanner.start();
  });

  $("#stopScannerBtn")?.addEventListener("click", async () => {
    await Pdf417Scanner.stop();
    Pdf417Scanner.setStatus("Stopped.");
  });

  $("#pauseResumeBtn")?.addEventListener("click", () => Pdf417Scanner.togglePause());
  $("#switchCameraBtn")?.addEventListener("click", () => Pdf417Scanner.switchCamera());
  $("#torchBtn")?.addEventListener("click", () => Pdf417Scanner.toggleTorch());
  $("#flashToggleBtn")?.addEventListener("click", () => Pdf417Scanner.toggleTorch());

  $("#fileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      Pdf417Scanner.setStatus("Decoding image…");
      await Pdf417Scanner.scanImageFile(file);
    } catch (err) {
      console.error(err);
      Pdf417Scanner.setStatus("Could not decode that image.");
    } finally {
      e.target.value = "";
    }
  });

  $("#scannerCloseBtn")?.addEventListener("click", () => {
    Pdf417Scanner.stop();
    navigate("guestRegistration");
  });
}

/* =========================
   Init
========================= */
function init(){
  initStateDropdown();
  wireNav();
  wireScannerUI();
  wireRegistration();
  wireReturningNewGuest();
  wireStayDetails();
  wireBookingSummary();
  wirePayments();
  wireReceipt();

  const today = new Date();
  const iso = today.toISOString().slice(0,10);
  $("#checkIn").value = iso;

  const tomorrow = new Date(today.getTime() + 86400000);
  $("#checkOut").value = tomorrow.toISOString().slice(0,10);
  $("#nightsValue").textContent = "1";
  state.stay.nights = 1;
}

init();