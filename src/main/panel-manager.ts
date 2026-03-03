import { BaseWindow, BrowserWindow, WebContentsView } from "electron";
import path from "path";
import type { SlotConfig, SlotId, SlotType, Provider } from "./types";
import { PROVIDER_META } from "./types";

const CONTROL_BAR_HEIGHT = 90;

/**
 * Polyfill for removed DOMNodeInserted / DOMNodeRemoved mutation events.
 * Chromium 127+ removed these events entirely, but Gemini's Angular code
 * still adds listeners for them. This polyfill uses MutationObserver to
 * synthetically dispatch these events so Gemini's internal rendering works.
 */
const MUTATION_EVENT_POLYFILL = `
(function() {
  if (window.__mutationEventPolyfilled) return;
  window.__mutationEventPolyfilled = true;

  var origAdd = EventTarget.prototype.addEventListener;
  var listeners = new Map();

  EventTarget.prototype.addEventListener = function(type, fn, opts) {
    if (type === 'DOMNodeInserted' || type === 'DOMNodeRemoved') {
      var target = this;
      if (!listeners.has(target)) listeners.set(target, []);
      listeners.get(target).push({ type: type, fn: fn });

      // Set up a MutationObserver on this target to fire synthetic events
      if (!target.__mutPolyfillObserver) {
        target.__mutPolyfillObserver = new MutationObserver(function(mutations) {
          for (var i = 0; i < mutations.length; i++) {
            var mut = mutations[i];
            for (var a = 0; a < mut.addedNodes.length; a++) {
              var evt = new Event('DOMNodeInserted', { bubbles: true });
              evt.target = mut.addedNodes[a];
              evt.relatedNode = mut.target;
              try { mut.addedNodes[a].dispatchEvent(evt); } catch(e) {}
            }
            for (var r = 0; r < mut.removedNodes.length; r++) {
              var revt = new Event('DOMNodeRemoved', { bubbles: true });
              revt.target = mut.removedNodes[r];
              revt.relatedNode = mut.target;
              try { mut.target.dispatchEvent(revt); } catch(e) {}
            }
          }
        });
        var observeTarget = (target === document || target === window) ? document.body : target;
        if (observeTarget && observeTarget.nodeType === 1) {
          target.__mutPolyfillObserver.observe(observeTarget, { childList: true, subtree: true });
        }
      }
      return;
    }
    return origAdd.call(this, type, fn, opts);
  };

  console.log('[TalkAgent:polyfill] DOMNodeInserted/Removed mutation event polyfill active');
})();
`;

interface PanelEntry {
  type: SlotType;
  view: WebContentsView;
}

export class PanelManager {
  private window: BaseWindow;
  private controlBar: WebContentsView | null = null;
  private panels: Map<SlotId, PanelEntry> = new Map();
  private slotOrder: SlotId[] = [];

  constructor(window: BaseWindow) {
    this.window = window;
  }

  /** Create only the control bar. Panels are created via configurePanels(). */
  createControlBar(): void {
    this.controlBar = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "../preload/control-bar.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.controlBar.webContents.loadFile(
      path.join(__dirname, "../renderer/control-bar.html")
    );
    this.window.contentView.addChildView(this.controlBar);

    this.updateLayout();
    this.window.on("resized", () => this.updateLayout());
  }

  /** Diff-based panel configuration: create new, destroy removed, replace type-changed, reorder. */
  configurePanels(slots: SlotConfig[]): void {
    const newSlotMap = new Map(slots.map(s => [s.id, s]));
    const currentSlotIds = new Set(this.panels.keys());

    // Destroy panels for removed slots
    for (const slotId of currentSlotIds) {
      if (!newSlotMap.has(slotId)) {
        console.log(`[PanelManager] Destroying removed slot: ${slotId}`);
        this.destroyPanel(slotId);
      }
    }

    // Create or replace panels
    for (const slot of slots) {
      const existing = this.panels.get(slot.id);
      if (!existing) {
        // New slot — create panel
        console.log(`[PanelManager] Creating panel: ${slot.id} (${slot.type})`);
        this.createPanel(slot.id, slot.type);
      } else if (existing.type !== slot.type) {
        // Type changed — destroy old and create new
        console.log(`[PanelManager] Replacing panel: ${slot.id} (${existing.type} → ${slot.type})`);
        this.destroyPanel(slot.id);
        this.createPanel(slot.id, slot.type);
      }
    }

    // Update slot order for layout
    this.slotOrder = slots.map(s => s.id);
    this.updateLayout();
  }

  private createPanel(slotId: SlotId, type: SlotType): void {
    let view: WebContentsView;

    if (type === "user") {
      view = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "../preload/user-panel.js"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      view.webContents.loadFile(
        path.join(__dirname, "../renderer/user-panel.html")
      );
    } else {
      const meta = PROVIDER_META[type as Provider];
      view = new WebContentsView({
        webPreferences: {
          partition: meta.partition,
          preload: path.join(__dirname, "../preload/panel.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      // Override User-Agent to look like a regular Chrome browser
      // (Gemini blocks or limits responses for non-standard UAs like Electron)
      const chromeUA = view.webContents.getUserAgent()
        .replace(/\s*Electron\/[\d.]+/, "")
        .replace(/\s*talkagent-electron\/[\d.]+/, "");
      view.webContents.setUserAgent(chromeUA);

      // Polyfill removed DOMNodeInserted mutation event (Chromium 127+).
      // Gemini's Angular code still depends on this deprecated API, causing
      // intermittent "대답이 중지되었습니다" failures when it doesn't fire.
      if (type === "gemini") {
        view.webContents.on("dom-ready", () => {
          view.webContents.executeJavaScript(MUTATION_EVENT_POLYFILL).catch(() => {});
        });
      }

      view.webContents.loadURL(meta.url);

      // Allow OAuth/auth popup windows (Google sign-in, etc.)
      // Popup inherits the same partition so cookies/session are shared.
      view.webContents.setWindowOpenHandler(({ url }) => {
        return {
          action: "allow" as const,
          overrideBrowserWindowOptions: {
            width: 500,
            height: 700,
            webPreferences: {
              partition: meta.partition,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: false,
            },
          },
        };
      });

      // Forward injection script logs + error-level messages (guarded against EPIPE on stdout)
      view.webContents.on("console-message", (_event, level, message) => {
        try {
          if (message.includes("[TalkAgent:")) {
            console.log(`[Panel:${slotId}] ${message}`);
          } else if (level >= 2) {
            // Log warnings/errors from the provider page itself
            console.log(`[Panel:${slotId}:err] ${message.slice(0, 300)}`);
          }
        } catch { /* stdout EPIPE — ignore */ }
      });
    }

    this.window.contentView.addChildView(view);
    this.panels.set(slotId, { type, view });
  }

  private destroyPanel(slotId: SlotId): void {
    const entry = this.panels.get(slotId);
    if (!entry) return;

    try {
      this.window.contentView.removeChildView(entry.view);
      entry.view.webContents.close();
    } catch { /* panel already destroyed */ }

    this.panels.delete(slotId);
  }

  updateLayout(): void {
    const bounds = this.window.getContentBounds();
    const width = bounds.width;
    const height = bounds.height;

    // Control bar: full width at top
    this.controlBar?.setBounds({
      x: 0,
      y: 0,
      width,
      height: CONTROL_BAR_HEIGHT,
    });

    // Panels: N equal-width columns below control bar
    const n = this.slotOrder.length;
    if (n === 0) return;

    const panelWidth = Math.floor(width / n);
    const panelHeight = height - CONTROL_BAR_HEIGHT;
    let x = 0;

    for (let i = 0; i < n; i++) {
      const entry = this.panels.get(this.slotOrder[i]);
      if (!entry) continue;
      const w = i === n - 1 ? width - x : panelWidth;
      entry.view.setBounds({
        x,
        y: CONTROL_BAR_HEIGHT,
        width: w,
        height: panelHeight,
      });
      x += w;
    }
  }

  /** Execute a script on an LLM panel's webContents. */
  async executeOnSlot(slotId: SlotId, script: string): Promise<unknown> {
    const entry = this.panels.get(slotId);
    if (!entry || entry.view.webContents.isDestroyed()) {
      throw new Error(`No panel for slot ${slotId}`);
    }
    try {
      return await entry.view.webContents.executeJavaScript(script);
    } catch (err) {
      throw new Error(`Panel frame unavailable for ${slotId}: ${(err as Error).message}`);
    }
  }

  /** Send IPC message to a specific panel. */
  sendToSlot(slotId: SlotId, channel: string, data: unknown): void {
    const entry = this.panels.get(slotId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.send(channel, data);
    }
  }

  /** Reload slot in-place (preserves conversation context for retry). */
  reloadSlot(slotId: SlotId): void {
    const entry = this.panels.get(slotId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.reload();
    }
  }

  /** Navigate slot back to its original provider URL (fresh start). */
  resetSlot(slotId: SlotId): void {
    const entry = this.panels.get(slotId);
    if (!entry || entry.type === "user" || entry.view.webContents.isDestroyed()) return;
    const meta = PROVIDER_META[entry.type as Provider];
    if (meta) {
      console.log(`[PanelManager] Resetting slot to origin: ${slotId} → ${meta.url}`);
      entry.view.webContents.loadURL(meta.url);
    }
  }

  /** Navigate slot back in history (like browser back button). */
  goBackSlot(slotId: SlotId): void {
    const entry = this.panels.get(slotId);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    if (entry.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack();
    }
  }

  getSlotWebContents(slotId: SlotId): Electron.WebContents | null {
    const entry = this.panels.get(slotId);
    return entry?.view.webContents ?? null;
  }

  getControlBarWebContents(): Electron.WebContents | null {
    return this.controlBar?.webContents ?? null;
  }

  /** Highlight or unhighlight a panel to indicate whose turn it is. */
  setSlotHighlight(slotId: SlotId, active: boolean): void {
    const entry = this.panels.get(slotId);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    const css = active
      ? `document.documentElement.style.outline="3px solid #3b82f6";document.documentElement.style.outlineOffset="-3px";`
      : `document.documentElement.style.outline="";document.documentElement.style.outlineOffset="";`;
    entry.view.webContents.executeJavaScript(css).catch(() => {});
  }

  /** Clear highlight from all panels. */
  clearAllHighlights(): void {
    for (const [slotId] of this.panels) {
      this.setSlotHighlight(slotId, false);
    }
  }

  /** Navigate all LLM panels to fresh chat URLs (skip user panels). */
  reloadAllLLMPanels(): void {
    for (const [slotId, entry] of this.panels) {
      if (entry.type !== "user" && !entry.view.webContents.isDestroyed()) {
        const meta = PROVIDER_META[entry.type as Provider];
        if (meta) {
          console.log(`[PanelManager] Navigating to new chat: ${slotId} (${entry.type})`);
          entry.view.webContents.loadURL(meta.url);
        }
      }
    }
  }

  destroy(): void {
    this.controlBar?.webContents.close();
    for (const [, entry] of this.panels) {
      entry.view.webContents.close();
    }
  }
}
