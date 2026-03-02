/**
 * User panel — dedicated panel for human participant in debates.
 * Activated/deactivated by the orchestrator via IPC signals.
 */

const userInput = document.getElementById("user-input") as HTMLInputElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const historyEl = document.getElementById("history") as HTMLDivElement;
const inputArea = document.getElementById("input-area") as HTMLDivElement;

// Activate: enable input when it's the user's turn
window.__userPanelIPC.onActivate(() => {
  inputArea.classList.remove("disabled");
  inputArea.classList.add("active");
  userInput.disabled = false;
  userInput.placeholder = "토론 응답을 입력하세요...";
  submitBtn.disabled = false;
  userInput.focus();
});

// Deactivate: disable input after submission or when stopped
window.__userPanelIPC.onDeactivate(() => {
  inputArea.classList.remove("active");
  inputArea.classList.add("disabled");
  userInput.disabled = true;
  userInput.placeholder = "대기 중...";
  submitBtn.disabled = true;
});

async function handleSubmit(): Promise<void> {
  const content = userInput.value.trim();
  if (!content || submitBtn.disabled) return;

  // Add to local history
  const entry = document.createElement("div");
  entry.className = "history-entry";
  entry.textContent = content;
  historyEl.appendChild(entry);
  historyEl.scrollTop = historyEl.scrollHeight;

  userInput.value = "";
  await window.__userPanelIPC.submitInput(content);
}

submitBtn.addEventListener("click", handleSubmit);
userInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !submitBtn.disabled) handleSubmit();
});
