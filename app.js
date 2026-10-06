(function () {
  "use strict";

  const DATA = window.PLANT_DATA || { plants: [], images: {} };
  const plants = DATA.plants;
  const images = DATA.images || {};
  const STORAGE_KEY = "plantid-state-v1";

  const $ = (id) => document.getElementById(id);
  const grid = $("images");
  const counter = $("counter");
  const score = $("score");
  const noteEl = $("note");
  const inputs = { botanical: $("botanical"), common: $("common") };
  const checks = { botanical: $("botanical-check"), common: $("common-check") };
  const hints = { botanical: $("botanical-hint"), common: $("common-hint") };
  const answers = { botanical: $("botanical-answer"), common: $("common-answer") };
  const lightbox = $("lightbox");
  const lightboxImg = $("lightbox-img");
  const lightboxCaption = $("lightbox-caption");

  let order = plants.map((_, i) => i);
  let pos = 0;
  let state = loadState();

  // ---------- answer checking ----------

  // Lower-case, drop quotes and accents, treat × as x, turn punctuation into spaces.
  function norm(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/×/g, "x")
      .replace(/[‘’'"“”`]/g, "")
      .replace(/[.,;:()\[\]\-–—_/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isCorrect(plant, field, value) {
    const n = norm(value);
    if (!n) return false;
    const canonical = field === "botanical" ? plant.botanical : plant.common;
    const accept = field === "botanical" ? plant.botanicalAccept : plant.commonAccept;
    if (n === norm(canonical)) return true;
    return (accept || []).some((a) => norm(a) === n);
  }

  function isPartial(plant, field, value) {
    if (field !== "botanical") return false;
    const n = norm(value);
    return !!n && (plant.botanicalPartial || []).some((a) => norm(a) === n);
  }

  // ---------- state ----------

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable; keep going in memory */
    }
  }

  function plantState(plant) {
    if (!state[plant.id]) {
      state[plant.id] = { botanical: "", common: "", revealed: { botanical: false, common: false } };
    }
    return state[plant.id];
  }

  function current() {
    return plants[order[pos]];
  }

  // ---------- rendering ----------

  function render() {
    const plant = current();
    const ps = plantState(plant);
    counter.textContent = `Plant ${pos + 1} of ${plants.length}`;
    renderImages(plant);
    for (const field of ["botanical", "common"]) {
      inputs[field].value = ps[field] || "";
      evaluate(field, false);
      renderAnswer(field);
    }
    renderNote();
    $("prev").disabled = pos === 0;
    $("next").disabled = pos === plants.length - 1;
    updateScore();
    preload(pos + 1);
    inputs.botanical.focus();
  }

  function renderImages(plant) {
    const list = images[plant.id] || [];
    grid.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No photos for this plant yet. Run scripts/fetch_images.py to download them.";
      grid.appendChild(empty);
      return;
    }
    list.forEach((img, i) => {
      const card = document.createElement("figure");
      card.className = "image-card";
      card.style.margin = "0";

      const el = document.createElement("img");
      el.src = "images/" + img.file;
      el.alt = `Plant photo ${i + 1} (${img.part})`;
      el.addEventListener("click", () => openLightbox(img));

      const label = document.createElement("span");
      label.className = "part-label";
      label.textContent = img.part;

      const credit = document.createElement("figcaption");
      credit.className = "credit";
      credit.appendChild(document.createTextNode(`Photo: ${img.author} · ${img.license} · `));
      const link = document.createElement("a");
      link.href = img.pageUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "source";
      link.title = "Open on Wikimedia Commons (the page title gives away the name)";
      credit.appendChild(link);

      card.append(el, label, credit);
      grid.appendChild(card);
    });
  }

  function preload(nextPos) {
    if (nextPos >= plants.length) return;
    (images[plants[order[nextPos]].id] || []).forEach((img) => {
      const i = new Image();
      i.src = "images/" + img.file;
    });
  }

  function evaluate(field, save) {
    const plant = current();
    const ps = plantState(plant);
    const value = inputs[field].value;
    ps[field] = value;
    const correct = isCorrect(plant, field, value);
    const partial = !correct && isPartial(plant, field, value);
    inputs[field].classList.toggle("correct", correct);
    inputs[field].classList.toggle("partial", partial);
    checks[field].textContent = correct ? "✓" : "";
    hints[field].textContent = partial ? "Almost — add the cultivar name." : "";
    if (save !== false) saveState();
    updateScore();
    renderNote();
    return correct;
  }

  function renderAnswer(field) {
    const plant = current();
    const ps = plantState(plant);
    answers[field].textContent = ps.revealed[field] ? (field === "botanical" ? plant.botanical : plant.common) : "";
  }

  function renderNote() {
    const plant = current();
    const ps = plantState(plant);
    const known =
      ps.revealed.botanical || ps.revealed.common ||
      (isCorrect(plant, "botanical", ps.botanical) && isCorrect(plant, "common", ps.common));
    noteEl.textContent = known && plant.note ? plant.note : "";
  }

  function updateScore() {
    const learned = plants.filter((p) => {
      const ps = state[p.id];
      return ps && isCorrect(p, "botanical", ps.botanical) && isCorrect(p, "common", ps.common);
    }).length;
    score.textContent = `${learned} / ${plants.length} learned`;
  }

  // ---------- navigation ----------

  function go(delta) {
    const next = pos + delta;
    if (next < 0 || next >= plants.length) return;
    pos = next;
    render();
  }

  function shuffle() {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    pos = 0;
    render();
  }

  function reset() {
    if (!confirm("Clear all your answers and revealed names?")) return;
    state = {};
    saveState();
    render();
  }

  // ---------- lightbox ----------

  function openLightbox(img) {
    lightboxImg.src = "images/" + img.file;
    lightboxCaption.textContent = `${img.part} · Photo: ${img.author} · ${img.license}`;
    lightbox.hidden = false;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxImg.src = "";
  }

  // ---------- wiring ----------

  for (const field of ["botanical", "common"]) {
    inputs[field].addEventListener("input", () => evaluate(field, true));
    inputs[field].addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (field === "botanical") {
        inputs.common.focus();
        return;
      }
      const plant = current();
      const ps = plantState(plant);
      if (isCorrect(plant, "botanical", ps.botanical) && isCorrect(plant, "common", ps.common)) {
        go(1);
      } else if (!isCorrect(plant, "botanical", ps.botanical)) {
        inputs.botanical.focus();
      }
    });
  }

  document.querySelectorAll("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.reveal;
      plantState(current()).revealed[field] = true;
      saveState();
      renderAnswer(field);
      renderNote();
      inputs[field].focus();
    });
  });

  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(1));
  $("shuffle").addEventListener("click", shuffle);
  $("reset").addEventListener("click", reset);

  lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
      return;
    }
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (typing) return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  });

  if (!plants.length) {
    grid.innerHTML = '<div class="empty">No plant data found. Run scripts/fetch_images.py to generate data.js.</div>';
  } else {
    render();
  }
})();
