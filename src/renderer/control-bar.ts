/**
 * Control bar UI — slot-based debate configuration.
 * Slots can be added, removed, reordered, and configured with LLM or User type.
 * Duplicate types are supported (e.g., GPT x 2, User x 2).
 * Each slot mutation is synced to main process to dynamically create/destroy panels.
 */

const promptInput = document.getElementById("prompt-input") as HTMLInputElement;
const modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
const roundsSelect = document.getElementById("rounds-select") as HTMLSelectElement;
const bridgeCheck = document.getElementById("bridge-check") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const resumeBtn = document.getElementById("resume-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const roundInfo = document.getElementById("round-info") as HTMLDivElement;
const googleLoginBtn = document.getElementById("google-login-btn") as HTMLButtonElement;
const slotContainer = document.getElementById("slot-container") as HTMLDivElement;
const addSlotBtn = document.getElementById("add-slot-btn") as HTMLButtonElement;

// === Slot Data Model ===

type SlotType = "gpt" | "gemini" | "claude" | "user";
const SLOT_TYPE_LABELS: Record<SlotType, string> = {
  gpt: "GPT", gemini: "Gemini", claude: "Claude", user: "User",
};

interface SlotUI {
  id: string;
  type: SlotType;
  instruction: string;
}

let slots: SlotUI[] = [
  { id: "slot-0", type: "gpt", instruction: "" },
  { id: "slot-1", type: "gemini", instruction: "" },
  { id: "slot-2", type: "claude", instruction: "" },
];
let slotCounter = 3;

// === Label Generation ===

function generateLabels(slotList: SlotUI[]): Map<string, string> {
  const labels = new Map<string, string>();
  const typeTotals = new Map<SlotType, number>();

  // Count occurrences of each type
  for (const s of slotList) {
    typeTotals.set(s.type, (typeTotals.get(s.type) || 0) + 1);
  }

  const typeCounters = new Map<SlotType, number>();
  for (const s of slotList) {
    const total = typeTotals.get(s.type) || 0;
    if (total === 1) {
      labels.set(s.id, SLOT_TYPE_LABELS[s.type]);
    } else {
      const count = (typeCounters.get(s.type) || 0) + 1;
      typeCounters.set(s.type, count);
      labels.set(s.id, `${SLOT_TYPE_LABELS[s.type]}-${count}`);
    }
  }
  return labels;
}

// === Sync Slots to Main Process ===

async function syncSlotsToMain(): Promise<void> {
  const labels = generateLabels(slots);
  const configs = slots.map(s => ({
    id: s.id,
    type: s.type,
    label: labels.get(s.id) || SLOT_TYPE_LABELS[s.type],
    instruction: s.instruction.trim(),
  }));
  try {
    await window.talkagent.configureSlots(configs);
  } catch (err) {
    console.error("[ControlBar] Failed to sync slots:", err);
  }
}

// === Slot Rendering ===

function renderSlots(): void {
  // Save instruction values before re-render
  for (const slot of slots) {
    const input = slotContainer.querySelector(`[data-slot-id="${slot.id}"] .slot-instruction`) as HTMLInputElement | null;
    if (input) slot.instruction = input.value;
  }

  slotContainer.innerHTML = "";
  const labels = generateLabels(slots);

  for (const slot of slots) {
    const item = document.createElement("div");
    item.className = "slot-item";
    item.dataset.slotId = slot.id;
    item.draggable = true;

    // Status badge
    const status = document.createElement("span");
    status.className = `slot-status ${slot.type}`;
    status.textContent = labels.get(slot.id) || SLOT_TYPE_LABELS[slot.type];

    // Type selector
    const select = document.createElement("select");
    select.className = "slot-type-select";
    for (const [value, label] of Object.entries(SLOT_TYPE_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === slot.type) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      slot.type = select.value as SlotType;
      renderSlots();
      syncSlotsToMain();
    });

    // Instruction input
    const instInput = document.createElement("input");
    instInput.type = "text";
    instInput.className = "slot-instruction";
    instInput.placeholder = "지침";
    instInput.value = slot.instruction;
    instInput.addEventListener("input", () => {
      slot.instruction = instInput.value;
    });

    // Reset panel button (navigate back to original URL)
    const resetPanelBtn = document.createElement("button");
    resetPanelBtn.className = "slot-reset-btn";
    resetPanelBtn.textContent = "\u21ba";
    resetPanelBtn.title = "패널 초기화";
    if (slot.type === "user") resetPanelBtn.style.display = "none";
    resetPanelBtn.addEventListener("click", () => {
      window.talkagent.resetPanel(slot.id);
    });

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = "slot-remove-btn";
    removeBtn.textContent = "\u00d7";
    removeBtn.addEventListener("click", () => removeSlot(slot.id));

    // Drag events
    item.addEventListener("dragstart", (e) => {
      item.classList.add("dragging");
      e.dataTransfer!.setData("text/plain", slot.id);
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      const fromId = e.dataTransfer!.getData("text/plain");
      const toId = slot.id;
      if (fromId === toId) return;
      const fromIdx = slots.findIndex(s => s.id === fromId);
      const toIdx = slots.findIndex(s => s.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = slots.splice(fromIdx, 1);
      slots.splice(toIdx, 0, moved);
      renderSlots();
      syncSlotsToMain();
    });

    item.appendChild(status);
    item.appendChild(select);
    item.appendChild(instInput);
    item.appendChild(resetPanelBtn);
    item.appendChild(removeBtn);
    slotContainer.appendChild(item);
  }
}

function addSlot(): void {
  const id = `slot-${slotCounter++}`;
  slots.push({ id, type: "gpt", instruction: "" });
  renderSlots();
  syncSlotsToMain();
}

function removeSlot(id: string): void {
  if (slots.length <= 1) return; // minimum 1 slot
  slots = slots.filter(s => s.id !== id);
  renderSlots();
  syncSlotsToMain();
}

// Initial render + sync
renderSlots();
syncSlotsToMain();

// === Search ===

const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results") as HTMLDivElement;

let searchTimeout: ReturnType<typeof setTimeout>;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchResults.classList.add("hidden");
      return;
    }
    try {
      const results: SearchResult[] = await window.talkagent.searchVault(query);
      renderSearchResults(results);
    } catch {
      searchResults.classList.add("hidden");
    }
  }, 300);
});

// Close search results on click outside
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest("#search-area")) {
    searchResults.classList.add("hidden");
  }
});

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderSearchResults(results: SearchResult[]): void {
  if (results.length === 0) {
    searchResults.innerHTML = '<div class="no-results">결과 없음</div>';
  } else {
    searchResults.innerHTML = results.slice(0, 10).map((r) => {
      const typeClass = `result-type-${r.matchType}`;
      const typeLabel = r.matchType === "topic" ? "주제" : r.matchType === "prompt" ? "프롬프트" : "캡처";
      return `<div class="search-result-item" data-topic="${escapeHtml(r.topicId)}">
        <div><span class="result-type ${typeClass}">${typeLabel}</span></div>
        <span class="result-title">${escapeHtml(r.topicTitle)}</span>
        <span class="result-snippet">${escapeHtml(r.snippet)}</span>
      </div>`;
    }).join("");
  }
  searchResults.classList.remove("hidden");
}

// === Event Listeners ===

addSlotBtn.addEventListener("click", addSlot);

googleLoginBtn.addEventListener("click", async () => {
  googleLoginBtn.disabled = true;
  googleLoginBtn.textContent = "...";
  try {
    const result = await window.talkagent.googleLogin();
    if (result.ok) {
      roundInfo.textContent = "Google 로그인 완료";
    } else {
      roundInfo.textContent = result.error || "Google 로그인 실패";
    }
  } catch {
    roundInfo.textContent = "Google 로그인 오류";
  } finally {
    googleLoginBtn.disabled = false;
    googleLoginBtn.textContent = "G";
  }
});

sendBtn.addEventListener("click", handleSend);

promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !sendBtn.disabled) handleSend();
});

stopBtn.addEventListener("click", async () => {
  await window.talkagent.stop();
});

resumeBtn.addEventListener("click", handleResume);

resetBtn.addEventListener("click", async () => {
  resetBtn.disabled = true;
  await window.talkagent.reset();
  promptInput.value = "";
  roundInfo.textContent = "";
  // Clear all slot instructions
  for (const slot of slots) {
    slot.instruction = "";
  }
  renderSlots();
  setUIState("idle");
  resetBtn.disabled = false;
});

// === Status updates from main process ===

window.talkagent.onStatusUpdate((status: unknown) => {
  const s = status as {
    slots?: Record<string, string>;
    roundNumber?: number;
    status?: string;
    waitingSlotId?: string;
    canResume?: boolean;
  };

  if (s.slots) {
    for (const [slotId, state] of Object.entries(s.slots)) {
      const statusEl = slotContainer.querySelector(`[data-slot-id="${slotId}"] .slot-status`) as HTMLElement | null;
      if (statusEl) {
        // Remove previous state classes, add new one
        statusEl.classList.remove("ready", "working", "error");
        if (state === "ready" || state === "working" || state === "error") {
          statusEl.classList.add(state);
        }
      }
    }
  }

  if (s.roundNumber) {
    roundInfo.textContent = `R${s.roundNumber}/${roundsSelect.value}`;
  }

  // Clear waiting highlights
  slotContainer.querySelectorAll(".waiting-highlight").forEach(el => {
    el.classList.remove("waiting-highlight");
  });

  if (s.status === "running") {
    setUIState("running");
  }
  if (s.status === "waiting-for-user") {
    setUIState("waiting-for-user");
    roundInfo.textContent += " 사용자 입력 대기";
    // Highlight the waiting slot
    if (s.waitingSlotId) {
      const waitingEl = slotContainer.querySelector(`[data-slot-id="${s.waitingSlotId}"]`);
      if (waitingEl) waitingEl.classList.add("waiting-highlight");
    }
  }
  if (s.status === "paused") {
    setUIState("paused");
    roundInfo.textContent += " 일시정지";
  }
  if (s.status === "completed") {
    setUIState("paused");
    roundInfo.textContent += " 완료";
  }
  if (s.status === "error") {
    setUIState("idle");
    roundInfo.textContent += " Error";
  }
  if (s.status === "idle") {
    setUIState("idle");
    roundInfo.textContent = "";
  }
});

// === Send Handler ===

async function handleSend(): Promise<void> {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  if (slots.length === 0) return;

  // Save latest instruction values from DOM
  for (const slot of slots) {
    const input = slotContainer.querySelector(`[data-slot-id="${slot.id}"] .slot-instruction`) as HTMLInputElement | null;
    if (input) slot.instruction = input.value;
  }

  setUIState("running");
  const maxRounds = parseInt(roundsSelect.value, 10) || 3;
  roundInfo.textContent = `${maxRounds}R 시작...`;

  const labels = generateLabels(slots);
  const slotConfigs = slots.map(s => ({
    id: s.id,
    type: s.type,
    label: labels.get(s.id) || SLOT_TYPE_LABELS[s.type],
    instruction: s.instruction.trim(),
  }));

  try {
    const result = (await window.talkagent.startOrchestration({
      prompt,
      mode: modeSelect.value,
      slots: slotConfigs,
      maxRounds,
      useBridge: bridgeCheck.checked,
    })) as { error?: string };

    if (result.error) {
      roundInfo.textContent = result.error;
      setUIState("idle");
    }
  } catch {
    roundInfo.textContent = "Error";
    setUIState("idle");
  }
}

async function handleResume(): Promise<void> {
  setUIState("running");
  const additionalRounds = parseInt(roundsSelect.value, 10) || 3;
  roundInfo.textContent += ` +${additionalRounds}R...`;

  try {
    const result = (await window.talkagent.resume(additionalRounds)) as { error?: string };
    if (result.error) {
      roundInfo.textContent = result.error;
      setUIState("idle");
    }
  } catch {
    roundInfo.textContent = "Error";
    setUIState("idle");
  }
}

// === UI State ===

function setUIState(state: "idle" | "running" | "paused" | "waiting-for-user"): void {
  switch (state) {
    case "idle":
      sendBtn.textContent = "시작";
      sendBtn.disabled = false;
      sendBtn.classList.remove("hidden");
      resumeBtn.classList.add("hidden");
      stopBtn.classList.add("hidden");
      resetBtn.classList.add("hidden");
      break;
    case "running":
      sendBtn.textContent = "진행 중...";
      sendBtn.disabled = true;
      sendBtn.classList.remove("hidden");
      resumeBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      resetBtn.classList.remove("hidden");
      break;
    case "paused":
      sendBtn.classList.add("hidden");
      resumeBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
      resetBtn.classList.remove("hidden");
      break;
    case "waiting-for-user":
      sendBtn.textContent = "진행 중...";
      sendBtn.disabled = true;
      sendBtn.classList.remove("hidden");
      resumeBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
      resetBtn.classList.remove("hidden");
      break;
  }
}
