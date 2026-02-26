// --- App State ---
const store = {
  mod: { autofill: "success", pay: "success" }, // moderator forcing
  stay: { checkIn: "", checkOut: "", adults: "", children: "", room: "", rate: "", deposit: 0, discount: 0 },
  guest: { fullName: "", street: "", city: "", state: "", zip: "", gender: "", age: "", idType: "", idNumber: "", dob: "" },
  booking: { bookingId: "", roomNumber: "", total: 0, txnId: "" },
  payment: { method: "", status: "idle" } // idle|processing|success|declined
};

// --- Utilities ---
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function randDigits(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return 0;
  const a = new Date(isoA), b = new Date(isoB);
  const diff = Math.max(0, b - a);
  return Math.round(diff / (1000 * 60 * 60 * 24));
}
function calcAgeFromDob(dobISO) {
  if (!dobISO) return "";
  const dob = new Date(dobISO);
  if (Number.isNaN(dob.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return String(Math.max(0, age));
}

// --- Routing ---
function show(route) {
  $$(".view").forEach(v => v.classList.toggle("active", v.dataset.route === route));
  // optional: stop camera when leaving scanner
  if (route !== "scanner") stopScanner();
}

function go(route) {
  history.pushState({ route }, "", `#/${route}`);
  show(route);
  if (route === "scanner") setupScanner();
  if (route === "bookingSummary") renderSummary();
  if (route === "paymentDetails") renderPayment();
  if (route === "paymentSuccess" || route === "paymentDeclined") renderPaymentResult();
  if (route === "receipt") renderReceipt();
}
function back() {
  history.back();
}
window.addEventListener("popstate", () => {
  const route = (location.hash.replace("#/", "") || "dashboard");
  show(route);
  if (route === "scanner") setupScanner();
});

// --- Toasts ---
function toast(type, msg) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<div>${msg}</div><button class="x" aria-label="dismiss">✕</button>`;
  el.querySelector(".x").onclick = () => el.remove();
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// --- Validation + Status Icons ---
const requiredFields = ["fullName", "street", "city", "state", "zip", "gender", "age", "idType", "idNumber"];

function validateGuest() {
  const g = store.guest;
  const errors = {};

  for (const f of requiredFields) {
    if (!String(g[f] || "").trim()) errors[f] = "Required";
  }
  if (g.zip && !/^\d{5}$/.test(g.zip)) errors.zip = "ZIP must be 5 digits";
  // Age is readonly. Ensure numeric.
  if (g.age && !/^\d+$/.test(g.age)) errors.age = "Invalid age";

  return { ok: Object.keys(errors).length === 0, errors };
}

function updateFieldStatuses(validation) {
  for (const f of requiredFields) {
    const s = $(`[data-status-for="${f}"]`);
    if (!s) continue;
    const v = String(store.guest[f] || "").trim();
    if (!v) {
      s.className = "status empty";
      s.textContent = "";
    } else if (validation.errors[f]) {
      s.className = "status bad";
      s.textContent = "!";
    } else {
      s.className = "status ok";
      s.textContent = "✓";
    }
  }
}

// --- Bind inputs to state ---
function bind() {
  // Stay Details
  $("#checkIn").addEventListener("change", e => store.stay.checkIn = e.target.value);
  $("#checkOut").addEventListener("change", e => store.stay.checkOut = e.target.value);
  $("#adults").addEventListener("change", e => store.stay.adults = e.target.value);
  $("#children").addEventListener("change", e => store.stay.children = e.target.value);
  $("#room").addEventListener("change", e => store.stay.room = e.target.value);
  $("#rate").addEventListener("change", e => store.stay.rate = e.target.value);
  $("#deposit").addEventListener("input", e => store.stay.deposit = Number(e.target.value || 0));
  $("#discount").addEventListener("input", e => store.stay.discount = Number(e.target.value || 0));

  // Guest Registration
  const map = [
    ["fullName", "fullName"],
    ["street", "street"],
    ["city", "city"],
    ["state", "state"],
    ["zip", "zip"],
    ["gender", "gender"],
    ["idType", "idType"],
    ["idNumber", "idNumber"],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      store.guest[key] = el.value;
      const v = validateGuest();
      updateFieldStatuses(v);
    });
    el.addEventListener("blur", () => {
      const v = validateGuest();
      updateFieldStatuses(v);
    });
  }
}

// --- Flow handlers ---
function stayNext() {
  // Create booking ids now (prototype)
  store.booking.bookingId = randDigits(10);
  store.booking.roomNumber = store.stay.room || "000";

  go("guestRegistration");
}

function guestNext() {
  const v = validateGuest();
  updateFieldStatuses(v);

  if (!v.ok) {
    toast("error", "Please fix required fields.");
    return;
  }

  // Compute totals
  const nights = daysBetween(store.stay.checkIn, store.stay.checkOut) || 1;
  const rate = Number(store.stay.rate || 0);
  const deposit = Number(store.stay.deposit || 0);
  const discount = Number(store.stay.discount || 0);
  const total = Math.max(0, (nights * rate) + deposit - discount);

  store.booking.total = total;

  go("bookingSummary");
}

// --- Booking Summary render ---
function renderSummary() {
  const g = store.guest;
  $("#sumGuest").textContent = g.fullName || "Full Name";
  $("#sumIn").textContent = store.stay.checkIn ? new Date(store.stay.checkIn).toDateString() : "Time and Date";
  $("#sumOut").textContent = store.stay.checkOut ? new Date(store.stay.checkOut).toDateString() : "Time and Date";
  $("#sumDays").textContent = String(daysBetween(store.stay.checkIn, store.stay.checkOut) || 0).padStart(2, "0");
  $("#sumRoom").textContent = store.booking.roomNumber || "000";
  const guestsCount = Number(store.stay.adults || 0) + Number(store.stay.children || 0);
  $("#sumGuests").textContent = String(guestsCount || 0).padStart(2, "0");
  $("#sumBooking").textContent = store.booking.bookingId || "0000000000";

  $("#sumRate").textContent = money(store.stay.rate || 0);
  $("#sumDeposit").textContent = money(store.stay.deposit || 0);
  $("#sumDiscount").textContent = money(store.stay.discount || 0);
  $("#sumTotal").textContent = money(store.booking.total || 0);

  $("#cashTotal").textContent = money(store.booking.total || 0);
  $("#payTotal").textContent = money(store.booking.total || 0);

  // Declined/Success placeholders
  $("#declGuest").textContent = g.fullName || "Full Name";
  $("#declRoom").textContent = store.booking.roomNumber || "000";
  $("#declBooking").textContent = store.booking.bookingId || "0000000000";
  $("#declTotal").textContent = money(store.booking.total || 0);

  $("#succGuest").textContent = g.fullName || "Full Name";
  $("#succRoom").textContent = store.booking.roomNumber || "000";
  $("#succBooking").textContent = store.booking.bookingId || "0000000000";
  $("#succTotal").textContent = money(store.booking.total || 0);
}

// --- Payment screens ---
function renderPayment() {
  $("#payTotal").textContent = money(store.booking.total || 0);
}
function beginPayment(method) {
  store.payment.method = method;
  store.payment.status = "processing";

  go("processing");

  // simulate processing time
  setTimeout(() => {
    const outcome = store.mod.pay; // forced by moderator panel
    store.payment.status = (outcome === "success") ? "success" : "declined";
    store.booking.txnId = randDigits(14);

    go(store.payment.status === "success" ? "paymentSuccess" : "paymentDeclined");
  }, 1400);
}
function renderPaymentResult() {
  const txnType = store.payment.method === "cash"
    ? "Cash"
    : "Debit/Credit/NFC";

  $("#succType").textContent = txnType;
  $("#succTxn").textContent = store.booking.txnId || randDigits(14);

  $("#declType").textContent = txnType;
  $("#declTxn").textContent = store.booking.txnId || randDigits(14);
}

function printReceipt() {
  go("receipt");
}
function renderReceipt() {
  $("#rGuest").textContent = store.guest.fullName || "";
  $("#rRoom").textContent = store.booking.roomNumber || "";
  $("#rBooking").textContent = store.booking.bookingId || "";
  $("#rPay").textContent = (store.payment.method || "").toUpperCase() || "CARD";
  $("#rTotal").textContent = money(store.booking.total || 0);
}

// --- Modals ---
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

// --- Moderator panel ---
let titleTapCount = 0;
let titleTapTimer = null;
function handleTitleTap() {
  titleTapCount++;
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(() => titleTapCount = 0, 900);
  if (titleTapCount >= 5) {
    $("#modPanel").classList.remove("hidden");
    titleTapCount = 0;
  }
}

// --- Scanner (PDF417) ---
let codeReader = null;
let currentStream = null;
let torchOn = false;

async function setupScanner() {
  const video = $("#video");
  // Lazy init ZXing reader
  if (window.ZXing) {
    codeReader = codeReader || new ZXing.BrowserMultiFormatReader();
  } else {
    toast("error", "ZXing library not loaded. Use Sample ID.");
  }

  // Start camera preview even before decode
  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    video.srcObject = currentStream;
  } catch (e) {
    toast("error", "Camera blocked. Use Sample ID.");
  }
}

function stopScanner() {
  const video = $("#video");
  if (video && video.srcObject) video.srcObject = null;
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  torchOn = false;
}

async function toggleTorch() {
  if (!currentStream) { toast("error", "Camera not started."); return; }
  const track = currentStream.getVideoTracks()[0];
  const caps = track.getCapabilities?.();
  if (!caps || !caps.torch) { toast("error", "Torch not supported on this device."); return; }

  torchOn = !torchOn;
  await track.applyConstraints({ advanced: [{ torch: torchOn }] });
}

async function startScan() {
  if (store.mod.autofill === "fail") {
    toast("error", "Auto-fill failed. Please enter details manually.");
    // stay on guestRegistration
    go("guestRegistration");
    const v = validateGuest();
    updateFieldStatuses(v);
    return;
  }

  // If ZXing unavailable, fallback
  if (!codeReader || !window.ZXing) {
    useSampleId();
    return;
  }

  toast("success", "Scanning… hold barcode steady.");
  try {
    // Decode once from current stream
    const deviceId = undefined;
    const result = await codeReader.decodeOnceFromVideoDevice(deviceId, "video");
    const raw = result?.text || "";

    const parsed = parseAAMVA(raw);
    if (!parsed || (!parsed.fullName && !parsed.idNumber)) {
      toast("error", "Could not parse barcode. Using manual entry.");
      go("guestRegistration");
      return;
    }

    autofillGuest(parsed);
    go("scanSuccess");
    setTimeout(() => go("guestRegistration"), 650);

  } catch (e) {
    toast("error", "Scan failed. Try again or use Sample ID.");
  }
}

function useSampleId() {
  if (store.mod.autofill === "fail") {
    toast("error", "Auto-fill failed. Please enter details manually.");
    go("guestRegistration");
    return;
  }
  autofillGuest(sampleGuest());
  go("scanSuccess");
  setTimeout(() => go("guestRegistration"), 650);
}

function sampleGuest() {
  // You can customize to your test personas
  const dobISO = "1996-05-14";
  return {
    fullName: "Jane Doe",
    street: "3666 Seigen Lane, Apt 24",
    city: "Baton Rouge",
    state: "LA",
    zip: "70816",
    gender: "Female",
    dobISO,
    idType: "Driver's License",
    idNumber: "0134236894"
  };
}

function autofillGuest(p) {
  store.guest.fullName = p.fullName || store.guest.fullName;
  store.guest.street = p.street || store.guest.street;
  store.guest.city = p.city || store.guest.city;
  store.guest.state = p.state || store.guest.state;
  store.guest.zip = (p.zip || "").slice(0, 5) || store.guest.zip;
  store.guest.gender = p.gender || store.guest.gender;
  store.guest.idType = p.idType || store.guest.idType || "Driver's License";
  store.guest.idNumber = p.idNumber || store.guest.idNumber;

  if (p.dobISO) {
    store.guest.dob = p.dobISO;
    store.guest.age = calcAgeFromDob(p.dobISO);
  }

  // Push into UI fields
  $("#fullName").value = store.guest.fullName;
  $("#street").value = store.guest.street;
  $("#city").value = store.guest.city;
  $("#state").value = store.guest.state;
  $("#zip").value = store.guest.zip;
  $("#gender").value = store.guest.gender;
  $("#age").value = store.guest.age;
  $("#idType").value = store.guest.idType;
  $("#idNumber").value = store.guest.idNumber;

  toast("success", "Details auto-filled.");
  const v = validateGuest();
  updateFieldStatuses(v);
}

// --- AAMVA parser (basic) ---
// Extracts common fields from PDF417 payload.
// Works for many US licenses but not perfect (good enough for prototyping).
function parseAAMVA(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Often data includes newlines or record separators
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const get = (code) => {
    // Many payloads contain like "DAAJOHN,DOE"
    const found = lines.find(l => l.startsWith(code));
    return found ? found.slice(code.length).trim() : "";
  };

  const lastFirstMiddle = get("DAA"); // LAST,FIRST,MIDDLE
  let fullName = "";
  if (lastFirstMiddle) {
    const parts = lastFirstMiddle.split(",");
    const last = (parts[0] || "").trim();
    const first = (parts[1] || "").trim();
    const mid = (parts[2] || "").trim();
    fullName = [first, mid, last].filter(Boolean).join(" ");
  } else {
    // Sometimes separate fields:
    const first = get("DAC");
    const last = get("DCS");
    const mid = get("DAD");
    fullName = [first, mid, last].filter(Boolean).join(" ").trim();
  }

  const street = get("DAG");
  const city = get("DAI");
  const state = get("DAJ");
  const zip = get("DAK");
  const sex = get("DBC"); // 1=Male 2=Female (commonly)
  const dob = get("DBB"); // YYYYMMDD or MMDDYYYY
  const idNumber = get("DAQ");

  const gender = sex === "2" ? "Female" : sex === "1" ? "Male" : "";

  const dobISO = normalizeDob(dob);

  return {
    fullName,
    street,
    city,
    state,
    zip,
    gender,
    dobISO,
    idType: "Driver's License",
    idNumber
  };
}

function normalizeDob(d) {
  const digits = (d || "").replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const a = Number(digits.slice(0, 4));
  // If first 4 digits look like a year, assume YYYYMMDD
  if (a > 1900 && a < 2100) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    return `${y}-${m}-${day}`;
  }
  // else MMDDYYYY
  const m = digits.slice(0, 2);
  const day = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  return `${y}-${m}-${day}`;
}

// --- Event delegation ---
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const act = btn.dataset.action;

  if (act === "go") return go(btn.dataset.to);
  if (act === "back") return back();
  if (act === "stayNext") return stayNext();
  if (act === "guestNext") return guestNext();

  if (act === "payCash") { store.payment.method = "cash"; openModal("#cashModal"); return; }
  if (act === "payCard") { store.payment.method = "card"; go("paymentDetails"); return; }

  if (act === "closeCashModal") return closeModal("#cashModal");
  if (act === "confirmCash") { closeModal("#cashModal"); beginPayment("cash"); return; }

  if (act === "tapToPay") return beginPayment("card");
  if (act === "proceedPay") return beginPayment("card");

  if (act === "changeMethod") return go("bookingSummary");
  if (act === "retryPay") return beginPayment(store.payment.method || "card");

  if (act === "printReceipt") return printReceipt();
  if (act === "receiptPrinted") return openModal("#receiptModal");
  if (act === "doneReceipt") { closeModal("#receiptModal"); go("dashboard"); return; }
  if (act === "shareReceipt") return shareReceipt();

  if (act === "openModPanel") return handleTitleTap();
  if (act === "modClose") return $("#modPanel").classList.add("hidden");

  if (act === "setAutofill") { store.mod.autofill = btn.dataset.value; toast("success", `Autofill: ${store.mod.autofill}`); return; }
  if (act === "setPay") { store.mod.pay = btn.dataset.value; toast("success", `Payment: ${store.mod.pay}`); return; }
  if (act === "fillSampleGuest") { autofillGuest(sampleGuest()); return; }
  if (act === "clearGuest") { clearGuest(); return; }

  if (act === "toggleTorch") return toggleTorch();
  if (act === "startScan") return startScan();
  if (act === "useSampleId") return useSampleId();
});

function clearGuest() {
  store.guest = { fullName:"", street:"", city:"", state:"", zip:"", gender:"", age:"", idType:"", idNumber:"", dob:"" };
  $("#fullName").value = "";
  $("#street").value = "";
  $("#city").value = "";
  $("#state").value = "";
  $("#zip").value = "";
  $("#gender").value = "";
  $("#age").value = "";
  $("#idType").value = "";
  $("#idNumber").value = "";
  updateFieldStatuses(validateGuest());
  toast("success", "Guest cleared.");
}

// Share receipt (best-effort)
async function shareReceipt() {
  const text = `Receipt - ${store.guest.fullName}\nRoom: ${store.booking.roomNumber}\nTotal: ${money(store.booking.total)}`;
  try {
    if (navigator.share) await navigator.share({ title: "Receipt", text });
    else toast("error", "Web Share not supported on this device.");
  } catch {
    // user canceled share
  }
}

// --- Init ---
bind();
show((location.hash.replace("#/", "") || "dashboard"));
history.replaceState({ route: (location.hash.replace("#/", "") || "dashboard") }, "", location.hash || "#/dashboard");

// Ensure statuses reflect initial
updateFieldStatuses(validateGuest());