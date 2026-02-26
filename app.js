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
    dob: "",     // store DOB even if UI shows only age
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
  },
  ui: {
    flashOn: false
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
  // dob format expected: YYYYMMDD (AAMVA DBB often)
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
   PDF417 Scanner (Real Camera)
   - Uses BarcodeDetector when available
   - Checks bounding box is fully inside the alignment guide
   - Torch toggle when supported
========================= */

let scanner = {
  stream: null,
  track: null,
  usingFrontCamera: false,
  detector: null,
  running: false,
  paused: false,
  rafId: null,
  lastResultAt: 0,
  torchOn: false
};

function setScannerStatus(msg){
  const el = document.getElementById("scannerStatus");
  if (el) el.textContent = msg;
}

function barcodeDetectorSupported(){
  return ("BarcodeDetector" in window);
}

async function createDetector(){
  // Prefer PDF417 only (fast path). Some implementations need multiple formats.
  // If pdf417 not supported, this will throw.
  const formats = ["pdf417"];
  return new BarcodeDetector({ formats });
}

async function startScanner(){
  const video = document.getElementById("scannerVideo");
  const canvas = document.getElementById("scannerCanvas");
  if (!video || !canvas) return;

  stopScanner(); // ensure clean

  setScannerStatus("Requesting camera permission…");

  // Choose rear camera by default
  const constraints = {
    audio: false,
    video: {
      facingMode: scanner.usingFrontCamera ? "user" : "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };

  try {
    scanner.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = scanner.stream;

    scanner.track = scanner.stream.getVideoTracks()[0];

    // Initialize detector if possible
    if (barcodeDetectorSupported()){
      try {
        scanner.detector = await createDetector();
      } catch (e) {
        scanner.detector = null;
      }
    } else {
      scanner.detector = null;
    }

    scanner.running = true;
    scanner.paused = false;

    // Wait until video has dimensions
    await new Promise((res) => {
      if (video.readyState >= 2) return res();
      video.onloadedmetadata = () => res();
    });

    setScannerStatus(scanner.detector
      ? "Scanning for PDF417…"
      : "PDF417 detector not available on this browser. (Use library fallback)");

    scanLoop();
  } catch (err) {
    console.error(err);
    setScannerStatus("Camera permission denied or unavailable.");
    // return failure to Guest Registration (snackbar 11)
    navigate("guestRegistration");
    showSnackbar("Auto-fill failed. Please enter details manually.");
  }
}

function stopScanner(){
  if (scanner.rafId) cancelAnimationFrame(scanner.rafId);
  scanner.rafId = null;
  scanner.running = false;

  const video = document.getElementById("scannerVideo");
  if (video) video.srcObject = null;

  if (scanner.stream){
    scanner.stream.getTracks().forEach(t => t.stop());
  }

  scanner.stream = null;
  scanner.track = null;
  scanner.detector = null;
  scanner.paused = false;
  scanner.torchOn = false;
}

function getGuideRect(){
  const guide = document.querySelector("#scanner .scan-guide");
  if (!guide) return null;
  return guide.getBoundingClientRect();
}

function isBoxFullyInsideGuide(box, guideRect){
  // box: {x,y,width,height} in viewport coordinates
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  return (
    left >= guideRect.left &&
    top >= guideRect.top &&
    right <= guideRect.right &&
    bottom <= guideRect.bottom
  );
}

function mapDetectedBoxToViewport(detected, video){
  // BarcodeDetector returns boundingBox in image coordinates for some implementations,
  // but in many browsers it’s already in the same coordinate space.
  // We convert by scaling from video pixel space to on-screen video element rect.

  const vr = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  if (!vw || !vh) return null;

  const sx = vr.width / vw;
  const sy = vr.height / vh;

  const bb = detected.boundingBox;
  if (!bb) return null;

  return {
    x: vr.left + bb.x * sx,
    y: vr.top + bb.y * sy,
    width: bb.width * sx,
    height: bb.height * sy
  };
}

async function scanLoop(){
  if (!scanner.running) return;

  scanner.rafId = requestAnimationFrame(scanLoop);
  if (scanner.paused) return;
  if (!scanner.detector) return; // no support (use fallback library here)

  const now = Date.now();
  // throttle detection slightly to reduce CPU
  if (now - scanner.lastResultAt < 120) return;

  const video = document.getElementById("scannerVideo");
  if (!video || video.readyState < 2) return;

  try {
    const results = await scanner.detector.detect(video);
    if (!results || results.length === 0) return;

    // Take first match
    const r = results[0];
    if (!r.rawValue) return;

    // Require barcode fully inside guide
    const guideRect = getGuideRect();
    if (!guideRect) return;

    const viewportBox = mapDetectedBoxToViewport(r, video);
    if (!viewportBox) return;

    if (!isBoxFullyInsideGuide(viewportBox, guideRect)){
      setScannerStatus("Align barcode fully inside the guide…");
      return;
    }

    // Success
    scanner.lastResultAt = now;
    setScannerStatus("PDF417 detected. Parsing…");

    // rawValue should contain parsed payload text from detector
    const raw = r.rawValue;

    const parsed = parseAamva(raw);
    stopScanner();

    if (!parsed.ok){
      navigate("guestRegistration");
      showSnackbar("Auto-fill failed. Please enter details manually.");
      return;
    }

    navigate("guestRegistration");
    applyScanToRegistration(parsed);
    showSnackbar("Details auto-filled.");

    // then route to returning/new guest decision
    const decision = decideReturningGuest();
    setTimeout(() => {
      if (decision === "returning") {
        document.getElementById("returningName").textContent = state.guest.fullName || "Guest";
        document.getElementById("returningMeta").textContent = `${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("returningGuest");
      } else {
        document.getElementById("newGuestSummary").textContent =
          `${state.guest.fullName || "Guest"} • ${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("newGuest");
      }
    }, 250);

  } catch (e) {
    // Some browsers throw sporadically; keep scanning
    console.warn("detect error", e);
  }
}

/* Torch (Flash) toggle */
async function toggleTorch(){
  if (!scanner.track){
    showSnackbar("Flash not available.");
    return;
  }

  const caps = scanner.track.getCapabilities ? scanner.track.getCapabilities() : null;
  if (!caps || !caps.torch){
    showSnackbar("Flash not supported on this device.");
    return;
  }

  scanner.torchOn = !scanner.torchOn;
  try{
    await scanner.track.applyConstraints({ advanced: [{ torch: scanner.torchOn }] });
    showSnackbar(scanner.torchOn ? "Flash ON" : "Flash OFF");
  } catch(e){
    console.error(e);
    showSnackbar("Flash toggle failed.");
  }
}

/* Switch camera (front/back) */
async function switchCamera(){
  scanner.usingFrontCamera = !scanner.usingFrontCamera;
  await startScanner();
}

/* Pause / resume */
function togglePause(){
  scanner.paused = !scanner.paused;
  const btn = document.getElementById("pauseResumeBtn");
  if (btn) btn.textContent = scanner.paused ? "Resume" : "Pause";
  setScannerStatus(scanner.paused ? "Paused." : "Scanning for PDF417…");
}

/* =========================
   Hook into your existing navigation
   Start camera when entering scanner screen
   Stop camera when leaving
========================= */
function onScreenChange(screenId){
  if (screenId === "scanner"){
    startScanner();
  } else {
    stopScanner();
  }
}

/* Patch navigate() so it triggers scanner lifecycle */
const _navigate = navigate;
navigate = function(screenId){
  _navigate(screenId);
  onScreenChange(screenId);
};

/* Wire scanner UI buttons */
function wireRealScannerUI(){
  document.getElementById("flashToggleBtn")?.addEventListener("click", toggleTorch);
  document.getElementById("switchCameraBtn")?.addEventListener("click", switchCamera);
  document.getElementById("pauseResumeBtn")?.addEventListener("click", togglePause);

  document.getElementById("scannerCloseBtn")?.addEventListener("click", () => {
    stopScanner();
  });
}

/* Call this inside init() */


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
   AAMVA Parsing (simple, robust-enough for demo)
   - Extracts common fields by 3-letter codes in text
   - Works with payload containing lines like: DACJOHN, DCSDOE, etc.
========================= */
function parseAamva(raw){
  if (!raw || raw.trim().length < 10) return { ok:false, reason:"empty" };

  const text = raw.replace(/\r/g, "");
  const fields = {};

  // Capture occurrences like "DACJOHN" up to line break
  // Also works if concatenated: "...DCSDOE\nDACJOHN\n..."
  const regex = /\b([A-Z]{3})([^\n\r]*)/g;
  // Safer approach: look for known codes and read until newline
  const known = ["DAC","DAD","DCS","DAG","DAI","DAJ","DAK","DBC","DBB","DAQ"];

  known.forEach(code => {
    const m = text.match(new RegExp(`${code}([^\\n\\r]*)`));
    if (m && m[1] != null) fields[code] = m[1].trim();
  });

  // Required for meaningful autofill
  if (!fields.DAC && !fields.DCS && !fields.DAQ) {
    return { ok:false, reason:"missing_critical" };
  }

  return { ok:true, fields, raw:text };
}

/* =========================
   Mapping Rules (per your spec)
========================= */
function applyScanToRegistration(parsed){
  const { fields, raw } = parsed;

  // Full Name: First [Middle] Last (omit middle if empty)
  const first = (fields.DAC || "").trim();
  const middle = (fields.DAD || "").trim();
  const last = (fields.DCS || "").trim();
  const fullName = [first, middle, last].filter(Boolean).join(" ").trim();

  // Address fields
  const street = (fields.DAG || "").trim();
  const city = (fields.DAI || "").trim();

  // State: must match dropdown list (DAJ is often 2-letter)
  const scannedState = (fields.DAJ || "").trim().toUpperCase();
  const stateMatches = US_STATES.some(([abbr]) => abbr === scannedState);

  // ZIP: normalize to 5 digits
  const zipRaw = (fields.DAK || "").trim();
  const zip5 = onlyDigits(zipRaw).slice(0,5);

  // Gender normalization from DBC
  const genderRaw = (fields.DBC || "").trim().toUpperCase();
  let gender = "";
  if (genderRaw === "1" || genderRaw === "M" || genderRaw === "MALE") gender = "Male";
  else if (genderRaw === "2" || genderRaw === "F" || genderRaw === "FEMALE") gender = "Female";
  else if (genderRaw === "9" || genderRaw === "U" || genderRaw === "UNKNOWN" || genderRaw) gender = "Other";

  // DOB -> Age
  const dob = (fields.DBB || "").trim();
  const age = calcAgeFromDOB(dob);

  // ID Number
  const idNumber = (fields.DAQ || "").trim();

  // Update state
  state.guest.rawScan = raw;
  state.guest.fullName = fullName || state.guest.fullName;
  state.guest.street = street || state.guest.street;
  state.guest.city = city || state.guest.city;
  state.guest.zip = zip5 || state.guest.zip;
  state.guest.gender = gender || state.guest.gender;
  state.guest.dob = dob || state.guest.dob;
  state.guest.age = age || state.guest.age;
  state.guest.idNumber = idNumber || state.guest.idNumber;

  // For Type of Identification (DL/ID): unknown -> leave blank (manual choice)
  // (We keep it empty unless already selected)
  // state.guest.idType stays as user-selected or later logic

  // Apply to UI
  $("#fullName").value = state.guest.fullName;
  $("#street").value = state.guest.street;
  $("#city").value = state.guest.city;
  $("#zip").value = state.guest.zip;
  $("#gender").value = state.guest.gender || "";
  $("#age").value = state.guest.age || "";
  $("#idNumber").value = state.guest.idNumber || "";
  $("#dob").value = state.guest.dob || "";
  $("#rawScan").value = state.guest.rawScan || "";

  // State dropdown behavior:
  if (stateMatches) {
    $("#state").value = scannedState;
    setFieldError("state", "");
  } else if (scannedState) {
    // leave unselected + show inline error (per your rule)
    $("#state").value = "";
    setFieldError("state", "Scanned state not recognized. Please select manually.");
  }

  // ZIP basic validation inline (optional)
  if (zipRaw && zip5.length !== 5) {
    setFieldError("zip", "Invalid ZIP from scan. Please enter 5 digits.");
  }
}

/* =========================
   Returning vs New Guest (demo)
   Replace with real API match by idNumber, name, DOB, etc.
========================= */
function decideReturningGuest(){
  const id = (state.guest.idNumber || "").trim();
  if (!id) return "new";
  // demo rule: last digit even => returning
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

  // Simple model: total = (nights * rate) + deposit - discount
  const total = Math.max(0, (nights * rate) + deposit - discount);
  state.booking.total = total;
  return total;
}

/* =========================
   Rendering summary
========================= */
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

/* Add summary row style from JS (keeps CSS simple) */
(function injectSummaryRowStyle(){
  const css = `
    .summary-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #eee;}
    .summary-row:last-child{border-bottom:none;}
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

/* =========================
   Validation
========================= */
function validateRegistration(){
  const form = $("#registrationForm");
  clearErrors(form);

  // Pull values
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

  // Type of identification: required IF unknown from scan and user didn't choose
  // (Your spec: if unknown -> leave unselected and require manual choice)
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
   Confirm discard (close actions)
========================= */
function confirmDiscard(){
  return window.confirm("Discard check-in?");
}

/* =========================
   Event Wiring
========================= */
function wireNav(){
  // data-nav buttons
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nav]");
    if (!btn) return;
    const to = btn.getAttribute("data-nav");
    if (to) navigate(to);
  });

  // snackbar close
  $("#snackbarCloseBtn").addEventListener("click", hideSnackbar);

  // Dashboard other tiles
  $all('[data-action="other"]').forEach(b => b.addEventListener("click", () => {
    showSnackbar("Module not included in this flow.");
  }));

  // Logout/profile placeholders
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
      // Snackbar 12
      showSnackbar("Please Complete All the Required Fields.");
      return;
    }
    // Next: go to Stay Details
    navigate("stayDetails");
  });
}

function wireScanner(){
  $("#flashToggleBtn").addEventListener("click", () => {
    state.ui.flashOn = !state.ui.flashOn;
    showSnackbar(state.ui.flashOn ? "Flash ON (simulated)" : "Flash OFF (simulated)");
  });

  $("#scanFailBtn").addEventListener("click", () => {
    // Failure -> return to Guest Registration and show snackbar 11
    navigate("guestRegistration");
    showSnackbar("Auto-fill failed. Please enter details manually.");
  });

  $("#parseScanBtn").addEventListener("click", () => {
    const raw = $("#aamvaPayload").value;
    const parsed = parseAamva(raw);
    if (!parsed.ok){
      navigate("guestRegistration");
      showSnackbar("Auto-fill failed. Please enter details manually.");
      return;
    }

    // Apply to registration fields
    navigate("guestRegistration");
    applyScanToRegistration(parsed);

    // Snackbar 13
    showSnackbar("Details auto-filled.");

    // After scan, decide returning vs new guest (demo)
    const decision = decideReturningGuest();
    setTimeout(() => {
      if (decision === "returning") {
        $("#returningName").textContent = state.guest.fullName || "Guest";
        $("#returningMeta").textContent = `${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("returningGuest");
      } else {
        $("#newGuestSummary").textContent = `${state.guest.fullName || "Guest"} • ${state.guest.idType || "DL"} • ${state.guest.idNumber || "—"}`;
        navigate("newGuest");
      }
    }, 350);
  });
}

function wireReturningNewGuest(){
  $("#returningProceedBtn").addEventListener("click", () => {
    // attach existing guestId (demo)
    state.guest.guestId = "G-" + Math.random().toString(16).slice(2,8).toUpperCase();
    navigate("stayDetails");
  });

  $("#newGuestSkipBtn").addEventListener("click", () => {
    // continue without saving guest record
    state.guest.guestId = null;
    navigate("stayDetails");
  });

  $("#newGuestSaveBtn").addEventListener("click", () => {
    // create guest record (demo)
    state.guest.guestId = "G-" + Math.random().toString(16).slice(2,8).toUpperCase();
    $("#newGuestDetails").textContent = `Guest created: ${state.guest.guestId}`;
    navigate("stayDetails");
  });
}

function wireStayDetails(){
  // live nights
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
  // Close buttons with discard confirm
  $("#cardCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });
  $("#cashCloseBtn").addEventListener("click", () => {
    if (confirmDiscard()) navigate("dashboard");
  });

  // Tap to Pay route
  $("#tapToPayBtn").addEventListener("click", () => {
    state.payment.transactionType = "NFC";
    renderNfcSummary();
    navigate("tapToPay");
  });

  // Manual proceed
  $("#cardProceedBtn").addEventListener("click", () => {
    const ok = validateManualCard();
    if (!ok){
      showSnackbar("Please Complete All the Required Fields.");
      return;
    }
    state.payment.transactionType = "Manual";
    startProcessingAndRoute();
  });

  // NFC simulated tap
  $("#simulateNfcTapBtn").addEventListener("click", () => {
    startProcessingAndRoute();
  });

  // Cash confirm
  $("#cashYesBtn").addEventListener("click", () => {
    // record cash transaction (demo)
    state.payment.transactionType = "Cash";
    state.payment.transactionId = "";
    navigate("cashSuccess");
    renderTransactionDetails("cashSuccessDetails", "cash");
  });
}

function startProcessingAndRoute(){
  navigate("paymentProcessing");

  // Demo decision: card numbers ending with 0/5 decline, otherwise success
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
      catch { /* user cancelled */ }
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
  // keep it simple: clear guest/stay/payment
  state.guest = { guestId:null, fullName:"", street:"", city:"", state:"", zip:"", gender:"", dob:"", age:"", idType:"", idNumber:"", rawScan:"" };
  state.stay = { checkIn:"", checkOut:"", adults:"", children:"0", room:"", dailyRate:"", deposit:"0", discount:"0", nights:0 };
  state.booking = { bookingId:"", total:0 };
  state.payment = { method:"", transactionId:"", transactionType:"" };

  // clear forms
  $("#registrationForm").reset();
  $("#stayForm").reset();
  $("#cardForm").reset();
  $("#aamvaPayload").value = "";
  $("#nightsValue").textContent = "—";
}

/* =========================
   Init
========================= */
function init(){
  initStateDropdown();
  wireNav();
  wireRegistration();
  wireScanner();
  wireReturningNewGuest();
  wireStayDetails();
  wireBookingSummary();
  wirePayments();
  wireReceipt();
  wireRealScannerUI();

  // default dates (optional)
  const today = new Date();
  const iso = today.toISOString().slice(0,10);
  $("#checkIn").value = iso;

  const tomorrow = new Date(today.getTime() + 86400000);
  $("#checkOut").value = tomorrow.toISOString().slice(0,10);
  $("#nightsValue").textContent = "1";
  state.stay.nights = 1;
}

init();