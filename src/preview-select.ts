/** In-player menus: native OS popups cannot reliably inherit the shadow theme. */
export function createSelectControls(shadow: ShadowRoot, panel: HTMLElement) {
  const popup = document.createElement("div");
  popup.className = "select-menu";
  popup.id = "preview-select-menu";
  popup.setAttribute("role", "listbox");
  popup.hidden = true;
  shadow.append(popup);
  const entries = [...shadow.querySelectorAll<HTMLSelectElement>("select")].map(select => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "select-trigger";
    trigger.id = `${select.id}-trigger`;
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") ?? "Choose an option");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-controls", popup.id);
    trigger.setAttribute("aria-expanded", "false");
    select.hidden = true;
    select.after(trigger);
    return { select, trigger };
  });
  let open: typeof entries[number] | undefined;
  let active = 0, signature = "";
  function close() {
    open?.trigger.setAttribute("aria-expanded", "false");
    open?.trigger.removeAttribute("aria-activedescendant");
    open = undefined;
    popup.hidden = true;
  }
  function highlight(index: number) {
    if (!open) return;
    active = Math.max(0, Math.min(open.select.options.length - 1, index));
    [...popup.children].forEach((child, i) => child.classList.toggle("active", i === active));
    const option = popup.children[active] as HTMLElement | undefined;
    if (option) {
      open.trigger.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  }
  function choose(index: number) {
    const entry = open;
    if (!entry || entry.select.disabled || !entry.select.options[index] || entry.select.options[index].disabled) return;
    entry.select.selectedIndex = index;
    close();
    entry.select.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
    entry.trigger.focus({ preventScroll: true });
  }
  function position() {
    if (!open) return;
    const root = panel.getBoundingClientRect(), button = open.trigger.getBoundingClientRect();
    const width = Math.min(Math.max(button.width, 250), root.width - 24);
    const height = Math.min(240, root.height - 24, Math.max(42, open.select.options.length * 36 + 8));
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${height}px`;
    popup.style.left = `${Math.max(12, Math.min(button.right - root.left - width, root.width - width - 12))}px`;
    const below = button.bottom - root.top + 5;
    popup.style.top = `${Math.max(12, below + height <= root.height - 12 ? below : button.top - root.top - height - 5)}px`;
  }
  function sync() {
    for (const { select, trigger } of entries) {
      trigger.disabled = select.disabled;
      const label = select.selectedOptions[0]?.textContent ?? "Unavailable";
      if (trigger.textContent !== label) trigger.textContent = label;
      trigger.title = label;
    }
    if (!open) return;
    if (open.select.disabled || shadow.querySelector<HTMLElement>("#controls")?.hidden) { close(); return; }
    position();
    const options = [...open.select.options];
    const next = JSON.stringify(options.map(o => [o.value, o.textContent, o.selected, o.disabled]));
    if (next !== signature) {
      signature = next;
      popup.replaceChildren(...options.map((option, index) => {
        const item = document.createElement("div");
        item.id = `preview-option-${index}`;
        item.className = "select-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.setAttribute("aria-disabled", String(option.disabled));
        item.textContent = option.textContent;
        item.onmousedown = event => event.preventDefault();
        item.onclick = () => choose(index);
        item.onpointermove = () => highlight(index);
        return item;
      }));
      highlight(open.select.selectedIndex);
    }
  }
  function show(entry: typeof entries[number]) {
    close();
    if (entry.select.disabled) return;
    open = entry;
    signature = "";
    popup.hidden = false;
    popup.setAttribute("aria-label", entry.trigger.getAttribute("aria-label")!);
    entry.trigger.setAttribute("aria-expanded", "true");
    sync();
    highlight(entry.select.selectedIndex);
  }
  for (const entry of entries) {
    entry.trigger.onclick = () => open === entry ? close() : show(entry);
    entry.trigger.onblur = () => close();
  }
  window.addEventListener("keydown", event => {
    const entry = entries.find(e => event.composedPath()[0] === e.trigger);
    if (!entry || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") { close(); return; }
    // A focused trigger is not a text field. Player shortcuts must remain
    // available after selection and must never reopen a closed menu.
    const navigation = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"];
    if (open !== entry && event.key !== "Enter") return;
    if (!navigation.includes(event.key)) { close(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === "Escape") { close(); return; }
    if (event.key === "Enter") { if (open === entry) choose(active); else show(entry); return; }
    if (open !== entry) show(entry);
    if (event.key === "ArrowDown") highlight(active + 1);
    else if (event.key === "ArrowUp") highlight(active - 1);
    else if (event.key === "Home") highlight(0);
    else if (event.key === "End") highlight(entry.select.options.length - 1);
  }, true);
  window.addEventListener("pointerdown", event => {
    if (open && !event.composedPath().includes(open.trigger) && !event.composedPath().includes(popup)) close();
  }, true);
  return { sync, close, focus: (id: string) => entries.find(e => e.select.id === id)?.trigger.focus({ preventScroll: true }) };
}
