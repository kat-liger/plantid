(function () {
  "use strict";

  const DATA = window.PLANT_DATA || { plants: [], images: {} };
  const allPlants = DATA.plants.filter((p) => !p.skip);
  const images = DATA.images || {};
  const LIST_KEY = "plantid-list"; // only the chosen list is remembered, never answers
  const ALL = "__all__";
  const QUIZ = "__quiz__"; // every plant not yet on a class quiz
  const quizPlants = allPlants.filter((p) => !p.quizzed);

  const $ = (id) => document.getElementById(id);
  const grid = $("images");
  const counter = $("counter");
  const score = $("score");
  const noteEl = $("note");
  const listSelect = $("list");
  const inputs = { botanical: $("botanical"), common: $("common") };
  const checks = { botanical: $("botanical-check"), common: $("common-check") };
  const hints = { botanical: $("botanical-hint"), common: $("common-hint") };
  const answers = { botanical: $("botanical-answer"), common: $("common-answer") };
  const lightbox = $("lightbox");
  const lightboxImg = $("lightbox-img");
  const lightboxCaption = $("lightbox-caption");

  const listNames = [...new Set(allPlants.map((p) => p.list || "Plants"))];
  let plants = []; // plants in the chosen list
  let order = [];
  let pos = 0;
  let learned = new Set(); // ids named correctly in this session (both names)
  let revealed = { botanical: false, common: false };

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

  // ---------- lists ----------

  function populateLists() {
    listSelect.innerHTML = "";
    for (const name of listNames) {
      const n = allPlants.filter((p) => (p.list || "Plants") === name).length;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${n} plants)`;
      listSelect.appendChild(opt);
    }
    if (listNames.length > 1) {
      const opt = document.createElement("option");
      opt.value = ALL;
      opt.textContent = `All lists (${allPlants.length} plants)`;
      listSelect.appendChild(opt);
    }
    if (quizPlants.length) {
      const opt = document.createElement("option");
      opt.value = QUIZ;
      opt.textContent = `Quiz (${quizPlants.length} plants not yet quizzed)`;
      listSelect.appendChild(opt);
    }
    let chosen = null;
    try {
      chosen = localStorage.getItem(LIST_KEY);
    } catch (e) {
      /* ignore */
    }
    const valid = [...listSelect.options].some((o) => o.value === chosen);
    listSelect.value = valid ? chosen : listNames[listNames.length - 1]; // newest list by default
  }

  function setList(name) {
    plants =
      name === ALL
        ? allPlants
        : name === QUIZ
          ? quizPlants
          : allPlants.filter((p) => (p.list || "Plants") === name);
    order = plants.map((_, i) => i);
    pos = 0;
    try {
      localStorage.setItem(LIST_KEY, name);
    } catch (e) {
      /* storage unavailable; fine */
    }
    render();
  }

  function current() {
    return plants[order[pos]];
  }

  // ---------- rendering ----------

  // Every visit to a plant starts with empty fields: nothing typed is kept.
  function render() {
    const plant = current();
    revealed = { botanical: false, common: false };
    counter.textContent = plant ? `Plant ${pos + 1} of ${plants.length}` : "No plants in this list";
    renderImages(plant);
    for (const field of ["botanical", "common"]) {
      inputs[field].value = "";
      inputs[field].classList.remove("correct", "partial");
      checks[field].textContent = "";
      hints[field].textContent = "";
      answers[field].textContent = "";
    }
    noteEl.textContent = "";
    $("prev").disabled = pos === 0;
    $("next").disabled = pos >= plants.length - 1;
    updateScore();
    preload(pos + 1);
    inputs.botanical.focus();
  }

  function renderImages(plant) {
    const list = plant ? images[plant.id] || [] : [];
    grid.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = plant
        ? "No photos for this plant yet. Run scripts/fetch_images.py to download them."
        : "Choose another list above.";
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

  function evaluate(field) {
    const plant = current();
    if (!plant) return false;
    const value = inputs[field].value;
    const correct = isCorrect(plant, field, value);
    const partial = !correct && isPartial(plant, field, value);
    inputs[field].classList.toggle("correct", correct);
    inputs[field].classList.toggle("partial", partial);
    checks[field].textContent = correct ? "✓" : "";
    hints[field].textContent = partial ? "Almost — add the cultivar name." : "";
    if (bothCorrect()) learned.add(plant.id);
    updateScore();
    renderNote();
    return correct;
  }

  function bothCorrect() {
    const plant = current();
    return (
      !!plant &&
      isCorrect(plant, "botanical", inputs.botanical.value) &&
      isCorrect(plant, "common", inputs.common.value)
    );
  }

  function renderAnswer(field) {
    const plant = current();
    answers[field].textContent = revealed[field] ? (field === "botanical" ? plant.botanical : plant.common) : "";
  }

  function renderNote() {
    const plant = current();
    const known = revealed.botanical || revealed.common || bothCorrect();
    const bits = [];
    if (plant && known) {
      if (plant.family) bits.push(`Family: ${plant.family}`);
      if (plant.note) bits.push(plant.note);
    }
    noteEl.textContent = bits.join(" ");
  }

  function updateScore() {
    const n = plants.filter((p) => learned.has(p.id)).length;
    score.textContent = `${n} / ${plants.length} learned`;
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
    if (!confirm("Clear the learned count and start this list from the beginning?")) return;
    learned = new Set();
    order = plants.map((_, i) => i);
    pos = 0;
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
    inputs[field].addEventListener("input", () => evaluate(field));
    inputs[field].addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (field === "botanical") {
        inputs.common.focus();
        return;
      }
      if (bothCorrect()) {
        go(1);
      } else if (!isCorrect(current(), "botanical", inputs.botanical.value)) {
        inputs.botanical.focus();
      }
    });
  }

  document.querySelectorAll("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!current()) return;
      const field = btn.dataset.reveal;
      revealed[field] = true;
      renderAnswer(field);
      renderNote();
      inputs[field].focus();
    });
  });

  $("prev").addEventListener("click", () => go(-1));
  $("next").addEventListener("click", () => go(1));
  $("shuffle").addEventListener("click", shuffle);
  $("reset").addEventListener("click", reset);
  listSelect.addEventListener("change", () => setList(listSelect.value));

  lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) {
      closeLightbox();
      return;
    }
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "SELECT") return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  });

  // Open a specific plant from the URL: index.html#scabiosa-columbaria
  function jumpTo(id) {
    const plant = allPlants.find((p) => p.id === id);
    if (!plant) return false;
    const listName = plant.list || "Plants";
    if (!plants.includes(plant)) {
      listSelect.value = listName;
      setList(listName);
    }
    const idx = plants.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    pos = order.indexOf(idx);
    render();
    return true;
  }

  if (!allPlants.length) {
    grid.innerHTML = '<div class="empty">No plant data found. Run scripts/fetch_images.py to generate data.js.</div>';
  } else {
    populateLists();
    setList(listSelect.value);
    const hashId = decodeURIComponent(location.hash.slice(1));
    if (hashId) jumpTo(hashId);
  }
})();
