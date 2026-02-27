/**
 * Single-page flow runner for the provided static HTML screens.
 * - Does NOT change the UI markup/styles; it mounts each provided screen as-is.
 * - Handles navigation + state, and fills placeholder values.
 */

(() => {
  const root = document.getElementById("appRoot");
  if (!root) return;

  const T = (name) => document.getElementById(`tpl-${name}`);
  const clone = (name) => {
    const tpl = T(name);
    if (!tpl) throw new Error(`Missing template: ${name}`);
    return tpl.content.cloneNode(true);
  };

  // ---------------------------
  // App state
  // ---------------------------
  const state = {
    guest: {
      fullName: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
      gender: "",
      age: "",
      idType: "",
      idNumber: "",
    },
    stay: {
      checkin: "",
      checkout: "",
      adults: "",
      children: "",
      room: "",
      rateKey: "",
      deposit: "",
      discount: "",
    },
    payment: {
      method: "",
      bookingId: "",
      last4: "",
    },
    computed: {
      nights: 0,
      rate: 0,
      total: 0,
    },
  };

  const KNOWN_GUEST_IDS = new Set([
    "1234567890",
    "5555555555",
    "9876543210",
    "0000000000",
  ]);

  const RATE_MAP = {
    "king-75": { label: "King Size - $75", amount: 75 },
    "queen-65": { label: "Queen Size - $65", amount: 65 },
    "double-85": { label: "Double Bed - $85", amount: 85 },
    "studio-75": { label: "Studio - $75", amount: 75 },
    "studio-weekly-50": { label: "Studio Weekly - $50", amount: 50 },
  };

  // ---------------------------
  // Utilities
  // ---------------------------
  const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
  const $ = (sel, scope = document) => scope.querySelector(sel);

  function money(n) {
    const x = Number.isFinite(n) ? n : 0;
    return `$ ${x.toFixed(2)}`;
  }

  function parseMoneyLike(v) {
    if (v == null) return 0;
    const num = String(v).replace(/[^0-9.\-]/g, "");
    const f = parseFloat(num);
    return Number.isFinite(f) ? f : 0;
  }

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  function computeNights(checkinISO, checkoutISO) {
    if (!checkinISO || !checkoutISO) return 0;
    // Hotel day: 2pm -> 11am next day; with date-only inputs we treat this as "nights".
    // If checkout <= checkin, treat as 1 night.
    const inD = new Date(`${checkinISO}T14:00:00`);
    const outD = new Date(`${checkoutISO}T11:00:00`);
    const diffMs = outD - inD;
    const nights = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return Math.max(1, Number.isFinite(nights) ? nights : 0);
  }

  function computeDerived() {
    const nights = computeNights(state.stay.checkin, state.stay.checkout);
    const rate = RATE_MAP[state.stay.rateKey]?.amount ?? 0;
    const deposit = parseMoneyLike(state.stay.deposit);
    const discount = parseMoneyLike(state.stay.discount);
    const total = nights * rate + deposit - discount;

    state.computed.nights = nights;
    state.computed.rate = rate;
    state.computed.total = total;
  }

  function ensureBookingId() {
    if (state.payment.bookingId) return;
    // 10 digits
    state.payment.bookingId = String(
      Math.floor(1000000000 + Math.random() * 9000000000)
    );
  }

  function setRowValueByLeftText(container, leftText, rightText) {
    const rows = $$(".row", container);
    for (const row of rows) {
      const left = $(".left", row);
      const right = $(".right", row);
      if (!left || !right) continue;
      if (left.textContent.trim() === leftText) {
        right.textContent = rightText;
        return true;
      }
    }
    return false;
  }

  function setAllRowValues(container, mapping) {
    for (const [k, v] of Object.entries(mapping)) {
      setRowValueByLeftText(container, k, v);
    }
  }

  function mount(screenName) {
    root.innerHTML = "";
    root.appendChild(clone(screenName));
    initScreen(screenName);
  }

  // ---------------------------
  // Screen initializers
  // ---------------------------
  function initScreen(name) {
    switch (name) {
      case "dashboard":
        return initDashboard();
      case "registration":
        return initRegistration();
      case "returning":
        return initReturningGuest();
      case "new":
        return initNewGuest();
      case "stay":
        return initStayDetails();
      case "summary":
        return initBookingSummary();
      case "cash":
        return initCashPayment();
      case "cashSuccess":
        return initCashPaymentSuccessful();
      case "card":
        return initCardPayment();
      case "tap":
        return initTapToPay();
      case "processing":
        return initCardProcessing();
      case "cardSuccess":
        return initCardPaymentSuccessful();
      case "cardDeclined":
        return initCardPaymentDeclined();
      case "receipt":
        return initReceiptPrinted();
      default:
        break;
    }
  }

  // Dashboard
  function initDashboard() {
    const checkInCard = $('[aria-label="Check-In"]');
    if (checkInCard) {
      const go = () => mount("registration");
      checkInCard.addEventListener("click", go);
      checkInCard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") go();
      });
    }
  }

  // Registration + scanner (script copied 1:1 except wrapped)
  function initRegistration() {
    // Prefill if returning from back.
    const form = document.getElementById("guestForm");
    if (form) {
      const map = {
        fullName: state.guest.fullName,
        streetAddress: state.guest.streetAddress,
        city: state.guest.city,
        state: state.guest.state,
        zip: state.guest.zip,
        gender: state.guest.gender,
        age: state.guest.age,
        idType: state.guest.idType,
        idNumber: state.guest.idNumber,
      };
      for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
      }
    }

    // Next button
    const nextBtn = $(".primary-btn");
    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        const f = document.getElementById("guestForm");
        if (f && !f.reportValidity()) return;

        // Capture
        state.guest.fullName =
          document.getElementById("fullName")?.value?.trim() || "";
        state.guest.streetAddress =
          document.getElementById("streetAddress")?.value?.trim() || "";
        state.guest.city = document.getElementById("city")?.value?.trim() || "";
        state.guest.state = document.getElementById("state")?.value || "";
        state.guest.zip = document.getElementById("zip")?.value?.trim() || "";
        state.guest.gender = document.getElementById("gender")?.value || "";
        state.guest.age = document.getElementById("age")?.value?.trim() || "";
        state.guest.idType = document.getElementById("idType")?.value || "";
        state.guest.idNumber =
          document.getElementById("idNumber")?.value?.trim() || "";

        // Determine returning vs new
        const id = state.guest.idNumber;
        const lastDigit = (id.match(/(\d)\s*$/) || [])[1];
        const isReturning =
          (id && KNOWN_GUEST_IDS.has(id)) ||
          (lastDigit != null && parseInt(lastDigit, 10) % 2 === 0);

        mount(isReturning ? "returning" : "new");
      });
    }

    initScannerModule(); // scanner behavior on this screen
  }

  function initScannerModule() {
    // Original script from refinedGuestRegistration.html, adapted only to be re-entrant.
    // If elements don't exist (e.g., user navigated away), it bails.
    const $id = (id) => document.getElementById(id);

    const scannerScreen = $id("scannerScreen");
    const registrationScreen = $id("registrationScreen"); // eslint-disable-line no-unused-vars

    const openScannerBtn = $id("openScannerBtn");
    const closeBtn = $id("closeBtn");
    const flashBtn = $id("flashBtn");
    const video = $id("camera");

    if (!scannerScreen || !openScannerBtn || !closeBtn || !flashBtn || !video)
      return;

    // Form fields
    const fullNameEl = $id("fullName");
    const streetEl = $id("streetAddress");
    const cityEl = $id("city");
    const stateEl = $id("state");
    const zipEl = $id("zip");
    const genderEl = $id("gender");
    const ageEl = $id("age");
    const idTypeEl = $id("idType");
    const idNumEl = $id("idNumber");

    // Scanner state
    let stream = null;
    let track = null;
    let torchOn = false;

    // Engine state
    let detector = null;
    let zxing = null;
    let zxingReader = null;

    let stopLoop = true;
    let lastText = "";
    let lastAt = 0;

    const FPS_MS = 120;
    const DUP_MS = 1600;
    const ROI_W = 0.9;
    const ROI_H = 0.55;

    const canvas = $id("scanCanvas");
    const ctx = canvas?.getContext?.("2d", { willReadFrequently: true });

    function openScanner() {
      scannerScreen.classList.add("is-open");
      startCameraAndScan();
    }

    function closeScanner() {
      stopCamera();
      scannerScreen.classList.remove("is-open");
    }

    openScannerBtn.addEventListener("click", openScanner);
    closeBtn.addEventListener("click", closeScanner);

    flashBtn.addEventListener("click", async () => {
      if (!track) return;

      try {
        const capabilities = track.getCapabilities?.() || {};
        if (!capabilities.torch) {
          alert("Flash not supported on this device.");
          return;
        }

        torchOn = !torchOn;

        await track.applyConstraints({ advanced: [{ torch: torchOn }] });

        flashBtn.classList.toggle("flash-active", torchOn);
        flashBtn.setAttribute("aria-pressed", String(torchOn));
      } catch (err) {
        console.error("Torch error:", err);
        alert("Unable to toggle flash on this device.");
      }
    });

    async function initEngineIfNeeded() {
      if (detector || zxingReader) return;

      if ("BarcodeDetector" in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          const supportsPdf417 =
            Array.isArray(formats) && formats.includes("pdf417");
          if (supportsPdf417) {
            detector = new BarcodeDetector({ formats: ["pdf417"] });
            return;
          }
        } catch {
          // fall through to ZXing
        }
      }

      zxing = await import(
        "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm"
      );
      zxingReader = new zxing.BrowserMultiFormatReader();

      const hints = new Map();
      hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
        zxing.BarcodeFormat.PDF_417,
      ]);
      zxingReader.hints = hints;
    }

    async function startCamera() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      video.srcObject = stream;
      await video.play();

      track = stream.getVideoTracks?.()?.[0] || null;
    }

    function stopCamera() {
      stopLoop = true;
      torchOn = false;

      try {
        video.pause();
      } catch {}
      try {
        video.srcObject = null;
      } catch {}

      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      track = null;

      flashBtn.classList.remove("flash-active");
      flashBtn.setAttribute("aria-pressed", "false");
    }

    async function startCameraAndScan() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("This browser doesn’t support camera access.");
        closeScanner();
        return;
      }

      stopLoop = false;

      try {
        await initEngineIfNeeded();
        await startCamera();
        scanLoop();
      } catch (err) {
        console.error("Camera/start error:", err);
        alert("Unable to access camera. Please allow camera permission.");
        closeScanner();
      }
    }

    function parseAamva(raw) {
      let text = (raw || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\x1e\x1d\x1c]/g, "\n");

      text = text
        .replace(/(^|[\n\r])\s*(DL|ID)(?=[A-Z]{3})/g, "$1$2\n")
        .replace(/(@[\s\S]{0,200}?)(DL|ID)(?=[A-Z]{3})/g, "$1$2\n");

      const fields = {};
      for (const line of text.split("\n")) {
        const m = line.match(/^([A-Z]{3})(.*)$/);
        if (m) {
          const code = m[1];
          const val = (m[2] || "").trim();
          if (val && fields[code] == null) fields[code] = val;
        }
      }

      const re = /\b([A-Z]{3})([^\n\r]*)/g;
      let mm;
      while ((mm = re.exec(text)) !== null) {
        const code = mm[1];
        const val = (mm[2] || "").trim();
        if (val && fields[code] == null) fields[code] = val;
      }

      return fields;
    }

    function computeAgeFromDOB(dobStr) {
      if (!dobStr) return null;
      const digits = dobStr.replace(/\D/g, "");
      if (digits.length < 8) return null;

      let year, month, day;
      const first4 = parseInt(digits.slice(0, 4), 10);
      if (first4 >= 1900 && first4 <= 2099) {
        year = first4;
        month = parseInt(digits.slice(4, 6), 10);
        day = parseInt(digits.slice(6, 8), 10);
      } else {
        month = parseInt(digits.slice(0, 2), 10);
        day = parseInt(digits.slice(2, 4), 10);
        year = parseInt(digits.slice(4, 8), 10);
      }

      if (!year || !month || !day) return null;

      const today = new Date();
      let age = today.getFullYear() - year;
      const m = today.getMonth() + 1;
      const d = today.getDate();
      if (m < month || (m === month && d < day)) age -= 1;
      if (age < 0 || age > 130) return null;
      return age;
    }

    function normalizeZip(zipRaw) {
      if (!zipRaw) return "";
      const digits = zipRaw.replace(/\D/g, "");
      return digits.slice(0, 5);
    }

    function normalizeGender(gRaw) {
      if (!gRaw) return "";
      const v = String(gRaw).trim().toUpperCase();
      if (v === "1" || v === "M" || v === "MALE") return "Male";
      if (v === "2" || v === "F" || v === "FEMALE") return "Female";
      return "Other";
    }

    function deriveIdType(raw) {
      if (!raw) return "";

      const t = String(raw)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[\x1e\x1d\x1c]/g, "\n")
        .toUpperCase();

      const compact = t.replace(/\s+/g, "");

      const m = compact.match(/ANSI([0-9]{6})([0-9]{2})([0-9]{2})([0-9]{2})(.*)/);
      if (!m) return "";

      const entries = parseInt(m[4], 10);
      if (!Number.isFinite(entries) || entries <= 0) return "";

      const table = m[5] || "";

      for (let i = 0; i < entries; i++) {
        const start = i * 10;
        if (start + 10 > table.length) break;

        const type = table.slice(start, start + 2);
        if (type === "DL" || type === "ID") return type;
      }

      return "";
    }

    function fillFormFromScan(rawText) {
      const f = parseAamva(rawText);

      const first = (f.DAC || "").trim();
      const middle = (f.DAD || "").trim();
      const last = (f.DCS || "").trim();
      const name = [first, middle, last]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const street = (f.DAG || "").trim();
      const city = (f.DAI || "").trim();
      const st = (f.DAJ || "").trim().toUpperCase();
      const zip = normalizeZip(f.DAK || "");

      const gender = normalizeGender(f.DBC || "");
      const age = computeAgeFromDOB(f.DBB || "");

      const idNumber = (f.DAQ || "").trim();
      const idType = deriveIdType(rawText);

      if (name) fullNameEl.value = name;
      if (street) streetEl.value = street;
      if (city) cityEl.value = city;

      if (st && stateEl?.querySelector?.(`option[value="${st}"]`)) {
        stateEl.value = st;
      }

      if (zip) zipEl.value = zip;

      if (gender && genderEl?.querySelector?.(`option[value="${gender}"]`)) {
        genderEl.value = gender;
      }

      if (age != null && age !== "") ageEl.value = String(age);

      if (idType && idTypeEl?.querySelector?.(`option[value="${idType}"]`)) {
        idTypeEl.value = idType;
      }

      if (idNumber) idNumEl.value = idNumber;

      for (const el of [
        fullNameEl,
        streetEl,
        cityEl,
        stateEl,
        zipEl,
        genderEl,
        ageEl,
        idTypeEl,
        idNumEl,
      ]) {
        if (!el) continue;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    function publish(text) {
      const now = Date.now();
      if (!text) return;
      if (text === lastText && now - lastAt < DUP_MS) return;

      lastText = text;
      lastAt = now;

      try {
        fillFormFromScan(text);
        navigator.vibrate?.(25);
      } catch (e) {
        console.error("Autofill error:", e);
      }

      closeScanner();
    }

    async function scanLoop() {
      if (stopLoop) return;

      try {
        await initEngineIfNeeded();

        if (detector) {
          const codes = await detector.detect(video);
          if (codes?.length) publish(codes[0].rawValue || "");
        } else if (zxingReader && zxing && canvas && ctx) {
          if (video.readyState >= 2) {
            const w = video.videoWidth;
            const h = video.videoHeight;

            const cropW = Math.floor(w * ROI_W);
            const cropH = Math.floor(h * ROI_H);
            const sx = Math.floor((w - cropW) / 2);
            const sy = Math.floor((h - cropH) / 2);

            canvas.width = cropW;
            canvas.height = cropH;
            ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

            const imageData = ctx.getImageData(0, 0, cropW, cropH);

            const luminance = new zxing.RGBLuminanceSource(
              imageData.data,
              cropW,
              cropH
            );
            const binarizer = new zxing.HybridBinarizer(luminance);
            const bitmap = new zxing.BinaryBitmap(binarizer);

            try {
              const res = zxingReader.decodeBitmap(bitmap);
              publish(res?.getText?.() || "");
            } catch {
              // expected when nothing found
            }
          }
        }
      } catch {
        // keep scanning
      }

      setTimeout(scanLoop, FPS_MS);
    }

    window.addEventListener("beforeunload", stopCamera);

    // ---- Simulation hook (for usability testing on desktops without a camera) ----
    // If camera permission is blocked, allow user to click the camera area to simulate a scan.
    const cameraArea = $(".camera-area");
    if (cameraArea) {
      cameraArea.addEventListener("click", () => {
        if (!scannerScreen.classList.contains("is-open")) return;

        // Only simulate if camera isn't running.
        const hasStream = !!(
          video.srcObject && video.srcObject.getTracks?.().length
        );
        if (hasStream) return;

        const sample = [
          "ANSI 636000110002DL00410278ZV03190008",
          "DL",
          "DAQ1234567890",
          "DCSMARTIN",
          "DACJAMIE",
          "DADM",
          "DAG123 MAIN ST",
          "DAIANYTOWN",
          "DAJCA",
          "DAK90210",
          "DBB19920115",
          "DBC1",
        ].join("\n");

        publish(sample);
      });
    }
  }

  // Returning guest
  function initReturningGuest() {
    const card = $(".card");
    if (card) {
      setAllRowValues(card, {
        Guest: state.guest.fullName || "Full Name",
        "ID Number": state.guest.idNumber || "0000000000",
        "ID Type": state.guest.idType || "ID/DL/Passport",
        Rating: "0.00",
        "Active Since": new Date().toLocaleString(),
        "Latest Activity": new Date().toLocaleString(),
      });
    }

    const buttons = $$(".bottombar .btn");
    const cancelBtn = buttons[0];
    const proceedBtn = buttons[1];

    cancelBtn?.addEventListener("click", () => mount("registration"));
    proceedBtn?.addEventListener("click", () => mount("stay"));
  }

  // New guest
  function initNewGuest() {
    const card = $(".card");
    if (card) {
      // New guest screen uses split card sections; update both where relevant.
      const rights = $$(".right", card);
      if (rights[0]) rights[0].textContent = state.guest.fullName || "Full Name";
      if (rights[1]) rights[1].textContent = state.guest.idNumber || "0000000000";
      if (rights[2]) rights[2].textContent = state.guest.idType || "ID/DL/Passport";
    }

    const buttons = $$(".bottombar .btn");
    const skipBtn = buttons[0];
    const saveBtn = buttons[1];

    skipBtn?.addEventListener("click", () => mount("stay"));
    saveBtn?.addEventListener("click", () => mount("stay"));
  }

  // Stay details
  function initStayDetails() {
    // Default dates (copied from stayDetails.html)
    (function setDefaultDates() {
      const checkin = document.getElementById("checkin");
      const checkout = document.getElementById("checkout");

      if (checkin && checkout && !checkin.value && !checkout.value) {
        const d1 = new Date();
        const d2 = new Date();
        d2.setDate(d1.getDate() + 2);

        checkin.value = toISODate(d1);
        checkout.value = toISODate(d2);
      }
    })();

    // Prefill
    const map = state.stay;
    for (const [id, val] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    }

    const nextBtn = $(".primary-btn");
    nextBtn?.addEventListener("click", () => {
      // capture
      state.stay.checkin = document.getElementById("checkin")?.value || "";
      state.stay.checkout = document.getElementById("checkout")?.value || "";
      state.stay.adults = document.getElementById("adults")?.value || "";
      state.stay.children = document.getElementById("children")?.value || "";
      state.stay.room = document.getElementById("room")?.value || "";
      state.stay.rateKey = document.getElementById("rate")?.value || "";
      state.stay.deposit = document.getElementById("deposit")?.value || "";
      state.stay.discount = document.getElementById("discount")?.value || "";

      computeDerived();
      ensureBookingId();
      mount("summary");
    });

    // Back button
    const backBtn = $(".icon-btn.back");
    backBtn?.addEventListener("click", () => {
      // Return to the guest type screen; simplest: back to registration
      mount("registration");
    });
  }

  // Booking summary
  function initBookingSummary() {
    computeDerived();
    ensureBookingId();

    const cards = $$(".card");
    const detailsCard = cards[0];
    const totalCard = cards[1];

    const checkinLabel = state.stay.checkin
      ? `${state.stay.checkin} 2:00 PM`
      : "Time and Date";
    const checkoutLabel = state.stay.checkout
      ? `${state.stay.checkout} 11:00 AM`
      : "Time and Date";
    const guestsCount =
      (parseInt(state.stay.adults || "0", 10) || 0) +
      (parseInt(state.stay.children || "0", 10) || 0);

    const rateLabel = RATE_MAP[state.stay.rateKey]?.label
      ? `$ ${RATE_MAP[state.stay.rateKey].amount.toFixed(2)}`
      : "$ 00.00";

    if (detailsCard) {
      setAllRowValues(detailsCard, {
        Guest: state.guest.fullName || "Full Name",
        "Check-in": checkinLabel,
        "Check-out": checkoutLabel,
        "No. of Days": String(state.computed.nights || 0).padStart(2, "0"),
        "Room Number": state.stay.room || "000",
        Guests: String(guestsCount).padStart(2, "0"),
        "Daily Rate": rateLabel,
        Deposit: money(parseMoneyLike(state.stay.deposit)),
        Discount: money(parseMoneyLike(state.stay.discount)),
      });
    }

    if (totalCard) {
      setAllRowValues(totalCard, {
        "Total Amount": money(state.computed.total),
      });
    }

    // Back button
    const backBtn = $(".icon-btn.back");
    backBtn?.addEventListener("click", () => mount("stay"));

    const buttons = $$(".bottombar .btn");
    const cashBtn = buttons[0];
    const cardBtn = buttons[1];

    cashBtn?.addEventListener("click", () => {
      state.payment.method = "cash";
      mount("cash");
    });
    cardBtn?.addEventListener("click", () => {
      state.payment.method = "card";
      mount("card");
    });
  }

  // Cash payment
  function initCashPayment() {
    const card = $(".card");
    if (card) {
      setAllRowValues(card, {
        "Total Amount": money(state.computed.total),
      });
    }
    const yesBtn = $(".primary-btn");
    yesBtn?.addEventListener("click", () => mount("cashSuccess"));
  }

  function initCashPaymentSuccessful() {
    ensureBookingId();

    const stack = $(".stack") || document;
    const allCards = $$(".card", stack);
    for (const c of allCards) {
      setAllRowValues(c, {
        Guest: state.guest.fullName || "Full Name",
        "Check-in": state.stay.checkin
          ? `${state.stay.checkin} 2:00 PM`
          : "Time and Date",
        "Check-out": state.stay.checkout
          ? `${state.stay.checkout} 11:00 AM`
          : "Time and Date",
        "No. of Days": String(state.computed.nights || 0).padStart(2, "0"),
        "Room Number": state.stay.room || "000",
        Guests: String(
          (parseInt(state.stay.adults || "0", 10) || 0) +
            (parseInt(state.stay.children || "0", 10) || 0)
        ).padStart(2, "0"),
        "Booking ID": state.payment.bookingId,
        "Transaction Type": "Cash",
        "Total Amount": money(state.computed.total),
      });
    }

    const printBtn = $(".primary-btn");
    printBtn?.addEventListener("click", () => mount("receipt"));
  }

  // Card payment
  function initCardPayment() {
    computeDerived();

    // Total amount card
    const totalCard = $(".card");
    if (totalCard) {
      setAllRowValues(totalCard, { "Total Amount": money(state.computed.total) });
    }

    // Input helpers (copied from cardPayment.html)
    const cardNumber = document.getElementById("cardNumber");
    const expiry = document.getElementById("expiry");
    const zip = document.getElementById("zip");
    const cvv = document.getElementById("cvv");

    if (cardNumber) {
      cardNumber.addEventListener("input", () => {
        const digits = cardNumber.value.replace(/\D/g, "").slice(0, 19);
        const groups = digits.match(/.{1,4}/g) || [];
        cardNumber.value = groups.join(" ");
      });
    }
    if (expiry) {
      expiry.addEventListener("input", () => {
        const digits = expiry.value.replace(/\D/g, "").slice(0, 4);
        const mm = digits.slice(0, 2);
        const yy = digits.slice(2, 4);
        expiry.value = yy ? `${mm}/${yy}` : mm;
      });
    }
    if (cvv) {
      cvv.addEventListener("input", () => {
        cvv.value = cvv.value.replace(/\D/g, "").slice(0, 4);
      });
    }
    if (zip) {
      zip.addEventListener("input", () => {
        zip.value = zip.value.replace(/\D/g, "").slice(0, 5);
      });
    }

    // Tap to pay
    const tapBtn = $(".tap-btn");
    tapBtn?.addEventListener("click", () => mount("tap"));

    // Proceed to pay
    const payBtn = $(".primary-btn");
    payBtn?.addEventListener("click", () => {
      const digits = cardNumber?.value?.replace(/\D/g, "") || "";
      state.payment.last4 = digits.slice(-4);

      // simple decline simulation: if last digit is 0 => declined
      const last = digits.slice(-1);
      const declined = last === "0" && digits.length >= 12;

      mount("processing");
      // after 4 seconds show result
      window.setTimeout(() => {
        mount(declined ? "cardDeclined" : "cardSuccess");
      }, 4000);
    });

    // Back button
    const backBtn = $(".icon-btn[aria-label='Back']");
    backBtn?.addEventListener("click", () => mount("summary"));
  }

  // Tap to pay screen: tap anywhere on canvas to simulate
  function initTapToPay() {
    const closeBtn = $(".close-btn");
    closeBtn?.addEventListener("click", () => mount("card"));

    const canvas = $(".canvas");
    const tap = () => {
      mount("processing");
      window.setTimeout(() => mount("cardSuccess"), 4000);
    };
    canvas?.addEventListener("click", tap);
  }

  function initCardProcessing() {
    // dots animation (copied from cardPaymentProcessing.html)
    (function animateDots() {
      const dotsEl = document.getElementById("dots");
      if (!dotsEl) return;
      const frames = [".", "..", "..."];
      let i = 0;
      dotsEl.textContent = "...";
      window.setInterval(() => {
        dotsEl.textContent = frames[i % frames.length];
        i++;
      }, 450);
    })();
  }

  function initCardPaymentSuccessful() {
    ensureBookingId();

    const stack = $(".stack") || document;
    const allCards = $$(".card", stack);
    for (const c of allCards) {
      setAllRowValues(c, {
        Guest: state.guest.fullName || "Full Name",
        "Check-in": state.stay.checkin
          ? `${state.stay.checkin} 2:00 PM`
          : "Time and Date",
        "Check-out": state.stay.checkout
          ? `${state.stay.checkout} 11:00 AM`
          : "Time and Date",
        "No. of Days": String(state.computed.nights || 0).padStart(2, "0"),
        "Room Number": state.stay.room || "000",
        Guests: String(
          (parseInt(state.stay.adults || "0", 10) || 0) +
            (parseInt(state.stay.children || "0", 10) || 0)
        ).padStart(2, "0"),
        "Booking ID": state.payment.bookingId,
        "Transaction Type": "Card",
        "Total Amount": money(state.computed.total),
      });
    }

    const printBtn = $(".primary-btn");
    printBtn?.addEventListener("click", () => mount("receipt"));
  }

  function initCardPaymentDeclined() {
    ensureBookingId();

    const cards = $$(".card");
    for (const c of cards) {
      setAllRowValues(c, {
        "Booking ID": state.payment.bookingId,
        "Transaction Type": "Card",
        "Total Amount": money(state.computed.total),
      });
    }

    const buttons = $$(".bottombar .btn");
    const retryBtn = buttons[0];
    const changeBtn = buttons[1];

    retryBtn?.addEventListener("click", () => mount("card"));
    changeBtn?.addEventListener("click", () => mount("summary"));
  }

  function initReceiptPrinted() {
    const buttons = $$(".bottombar .btn");
    const shareBtn = buttons[0];
    const doneBtn = buttons[1];

    shareBtn?.addEventListener("click", () => alert("Share simulated."));
    doneBtn?.addEventListener("click", () => {
      // Reset minimal state for next participant
      state.guest = {
        fullName: "",
        streetAddress: "",
        city: "",
        state: "",
        zip: "",
        gender: "",
        age: "",
        idType: "",
        idNumber: "",
      };
      state.stay = {
        checkin: "",
        checkout: "",
        adults: "",
        children: "",
        room: "",
        rateKey: "",
        deposit: "",
        discount: "",
      };
      state.payment = { method: "", bookingId: "", last4: "" };
      state.computed = { nights: 0, rate: 0, total: 0 };

      // Go to dashboard (or directly to registration). Keeping dashboard as "home".
      mount("dashboard");
    });
  }

  // ---------------------------
  // Boot
  // ---------------------------
  // Per user story: open directly to the check-in form (Guest Registration)
  mount("registration");
})();