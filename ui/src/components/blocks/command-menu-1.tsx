import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Search } from "../../brand/icons";
import { useDismiss } from "../../lib/dismiss";
import { DictateButton } from "../ui/DictateButton";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

export type Command = {
  id: string;
  group: string;
  title: string;
  detail?: string;
  shortcut?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Shown but inert: the row names what it would act on and does nothing. */
  disabled?: boolean;
  /** Listed only once something is typed (every Discord channel would bury the rest). */
  searchOnly?: boolean;
};

export type CommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  groupOrder: string[];
  onSelect: (command: Command) => void;
  inputPlaceholder: string;
  /** Additional classes for the root section. */
  className?: string;
};

/** The library group is capped so navigation and actions always stay reachable. */
const GAME_GROUP = "Library";
const GAME_CAP = 50;

/** The close fade (the quick time, 120ms), and a frame to spare. */
const EXIT_MS = 140;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function matches(command: Command, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return !command.searchOnly;
  return `${command.title} ${command.detail ?? ""} ${command.group}`
    .toLowerCase()
    .includes(q);
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] border border-[#242424] px-1.5 text-[length:calc(12px*var(--exo-scale,1))] text-muted tabular-nums">
      {children}
    </kbd>
  );
}

export default function CommandMenu({
  open: isOpen,
  onOpenChange,
  commands,
  groupOrder,
  onSelect,
  inputPlaceholder,
  className,
}: CommandMenuProps) {
  const title = inputPlaceholder;
  const uid = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = `${uid}-listbox`;
  const filtered = useMemo(
    () => {
      let games = 0;
      // In the order the list shows them, so the arrow keys walk it top to bottom.
      return groupOrder.flatMap((group) => commands.filter((command) => {
        if (command.group !== group || !matches(command, query)) return false;
        return group !== GAME_GROUP || ++games <= GAME_CAP;
      }));
    },
    [commands, query, groupOrder],
  );
  const activeCommand = filtered[activeIndex];
  const activeId = activeCommand ? `${uid}-${activeCommand.id}` : undefined;

  const close = useCallback(() => {
    cancelAnimationFrame(frameRef.current ?? 0);
    setShown(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onOpenChange(false), EXIT_MS);
  }, [onOpenChange]);

  // A press outside the panel closes it; while it fades out, presses go to the page.
  useDismiss(dialogRef, close, { modal: true, on: isOpen && shown });

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!isOpen) {
      setShown(false);
      return;
    }
    // Opened by a global shortcut: focus goes back where it was on close.
    const previous = document.activeElement;
    returnFocusRef.current = previous instanceof HTMLElement && previous !== document.body ? previous : null;
    // The last search comes back selected, as Spotlight's does: typing replaces it, the arrows still reach it.
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    frameRef.current = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(frameRef.current ?? 0);
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      // The dialog is gone by now; a command that moved focus elsewhere (the
      // game sheet) keeps it, otherwise focus returns where it was.
      const focused = document.activeElement;
      if ((!focused || focused === document.body) && target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    const scroller = listRef.current;
    const row = scroller?.querySelector<HTMLElement>('[data-active="true"]');
    if (!scroller || !row) return;
    const listBox = scroller.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) {
      scroller.scrollTop -= listBox.top - rowBox.top;
    } else if (rowBox.bottom > listBox.bottom) {
      scroller.scrollTop += rowBox.bottom - listBox.bottom;
    }
  }, [activeIndex, query]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current ?? 0);
      clearTimeout(timerRef.current);
    },
    [],
  );

  const run = useCallback((command = activeCommand) => {
    if (!command || command.disabled) return;
    onSelect(command);
    setQuery("");
    setActiveIndex(0);
    close();
  }, [activeCommand, close, onSelect]);

  const move = (delta: number) => {
    setActiveIndex((i) => {
      const count = filtered.length;
      if (count === 0) return 0;
      return (i + delta + count) % count;
    });
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(filtered.length - 1, 0));
        break;
      case "Enter":
        if (!activeCommand) break;
        event.preventDefault();
        run();
        break;
    }
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Ctrl+K again closes it the way Escape does, fading out, instead of the shell's toggle removing it at once.
    const toggle = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    if (event.key === "Escape" || toggle) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    // Options are tabIndex -1 (the combobox drives them); only real tab stops count.
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.tabIndex >= 0);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const focused = root.ownerDocument.activeElement;
    if (event.shiftKey && focused === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && focused === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  return (
    <section
      className={cx(
        "flex h-full w-full items-center justify-center overflow-hidden",
        className,
      )}
    >
      {isOpen && (
        <>
          <div
            aria-hidden="true"
            className={cx(
              "absolute inset-0 z-40 cursor-default bg-[rgb(0_0_0/calc(0.7*var(--exo-scrim-k)))] transition-opacity ease-(--ease-out) from-key:duration-0",
              shown ? "pointer-events-auto opacity-100 duration-(--dur-base)" : "pointer-events-none opacity-0 duration-(--dur-quick)",
            )}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-title`}
            onKeyDown={onDialogKeyDown}
            className={cx(
              "pointer-events-auto absolute left-1/2 top-[12%] z-50 flex max-h-[76%] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden exo-glass is-panel rounded-[18px] transition-[opacity,scale] ease-(--ease-out) motion-reduce:scale-100 from-key:duration-0",
              shown
                ? "scale-100 opacity-100 duration-(--dur-base)"
                : "scale-[0.98] opacity-0 duration-(--dur-quick)",
            )}
          >
            <h2 id={`${uid}-title`} className="sr-only">
              {title}
            </h2>

            <div className="flex h-12 shrink-0 items-center gap-3 px-4">
              <Search
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted"
              />
              <label htmlFor={`${uid}-input`} className="sr-only">
                {inputPlaceholder}
              </label>
              <input
                ref={inputRef}
                id={`${uid}-input`}
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder={inputPlaceholder}
                className="h-8 min-w-0 flex-1 bg-transparent text-[length:calc(13px*var(--exo-scale,1))] text-fg placeholder:text-muted focus:outline-none"
              />
              <DictateButton target={inputRef} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div
                ref={listRef}
                // The combobox owns the keyboard; a focusable scroller let Tab leave the modal.
                tabIndex={-1}
                // Fades into the glass's edge where it scrolls on (exo-shell.css › Infinity pool), never a band painted over the glass.
                className="exo-command-list min-h-0 flex-1 overflow-y-auto bg-transparent p-1.5"
              >
                {filtered.length > 0 ? (
                  <div id={listboxId} role="listbox" aria-label="Commands">
                    {groupOrder.map((group) => {
                      const rows = filtered.filter((c) => c.group === group);
                      if (rows.length === 0) return null;
                      const groupId = `${uid}-${group}`;
                      return (
                        <div
                          key={group}
                          role="group"
                          aria-labelledby={groupId}
                          className="mb-1 last:mb-0"
                        >
                          <p
                            id={groupId}
                            className="px-2.5 pb-1 pt-2 text-[length:calc(12px*var(--exo-scale,1))] font-medium text-muted"
                          >
                            {group}
                          </p>
                          {rows.map((command) => {
                            const index = filtered.indexOf(command);
                            const Icon = command.icon;
                            const selected = index === activeIndex;
                            return (
                              <button
                                key={command.id}
                                id={`${uid}-${command.id}`}
                                role="option"
                                aria-selected={selected}
                                aria-disabled={command.disabled || undefined}
                                data-active={selected}
                                type="button"
                                tabIndex={-1}
                                onPointerMove={() => setActiveIndex(index)}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  setActiveIndex(index);
                                  run(command);
                                }}
                                className={cx(
                                  "flex min-h-11 w-full items-center gap-3 rounded-(--exo-row-radius) px-2.5 py-2 text-left transition-colors duration-[120ms]",
                                  command.disabled ? "cursor-default opacity-30" : "cursor-pointer",
                                  selected && !command.disabled && "bg-(--hover-fill)",
                                )}
                              >
                                {Icon && <Icon size={16} className="h-4 w-4 shrink-0 text-muted" />}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[length:calc(13px*var(--exo-scale,1))] font-medium text-fg">
                                    {command.title}
                                  </span>
                                  {command.detail && (
                                    <span className="block truncate text-[length:calc(12px*var(--exo-scale,1))] text-muted">
                                      {command.detail}
                                    </span>
                                  )}
                                </span>
                                {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center px-2.5 py-10 text-center">
                    <p className="text-[length:calc(13px*var(--exo-scale,1))] font-medium text-fg">
                      Nothing matches “{query.trim()}”
                    </p>
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setQuery("");
                        setActiveIndex(0);
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                      className="exo-set-btn mt-4"
                    >
                      Clear search
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
