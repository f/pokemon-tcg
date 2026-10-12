// Shared lobby pieces: the sign-in panel, the nickname form and the deck picker. Card art carries the look;
// selection shows as lift and a yellow underline, never as boxes.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { SignInWithGoogle, SignInWithSpacefast, useMutation } from "@spacefast/zero/client";
import { Button, Field, Input } from "@spacefast/zero/kit";

import { CLASSIC_DECKS, DECKS, MODERN_DECKS, type DeckFormat } from "../shared/decks";
import { sanitizeNickname, NICK_MAX } from "../shared/rules";
import { useLang } from "./lang";
import { withRetry } from "./util";

export function PageTitle({ children, lead }: { children: ComponentChildren; lead?: ComponentChildren }) {
  return (
    <div class="mb-6">
      <h1 class="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{children}</h1>
      {lead ? <p class="mt-2 max-w-2xl text-base text-ink-muted">{lead}</p> : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: ComponentChildren }) {
  return <h2 class="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">{children}</h2>;
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" class="mt-3 text-sm font-medium text-danger">
      {text}
    </p>
  );
}

const signInClass =
  "inline-flex h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-canvas transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function SignInButtons() {
  const { t } = useLang();
  return (
    <div class="flex flex-wrap gap-3">
      <SignInWithGoogle className={signInClass}>{t("signInGoogle")}</SignInWithGoogle>
      <SignInWithSpacefast className={signInClass}>{t("signInSpacefast")}</SignInWithSpacefast>
    </div>
  );
}

/** Signed out, or a session the server does not accept: a short explainer and both sign-in buttons. */
export function SignInPanel({ lead }: { lead?: string }) {
  const { t } = useLang();
  return (
    <section class="py-10">
      <PageTitle lead={lead ?? t("signInLead")}>{t("signInTitle")}</PageTitle>
      <SignInButtons />
      <DeckFan />
    </section>
  );
}

/** A few featured cards fanned out under the sign-in buttons. */
function DeckFan() {
  const picks = ["ash", "misty", "c30-espeon", "me-gengar", "brock"].filter((k) => DECKS[k]);
  return (
    <div class="pointer-events-none mt-12 flex select-none justify-center" aria-hidden="true">
      {picks.map((key, i) => (
        <img
          key={key}
          src={DECKS[key].img}
          alt=""
          referrerpolicy="no-referrer"
          loading="lazy"
          class={
            i === 0
              ? "-mr-8 w-28 -rotate-12 translate-y-6 rounded-lg shadow-2xl sm:w-36"
              : i === 1
                ? "-mr-8 w-28 -rotate-6 translate-y-2 rounded-lg shadow-2xl sm:w-36"
                : i === 2
                  ? "relative z-10 -mr-8 w-28 rounded-lg shadow-2xl sm:w-36"
                  : i === 3
                    ? "-mr-8 w-28 rotate-6 translate-y-2 rounded-lg shadow-2xl sm:w-36"
                    : "w-28 rotate-12 translate-y-6 rounded-lg shadow-2xl sm:w-36"
          }
        />
      ))}
    </div>
  );
}

export function NicknameForm() {
  const { t } = useLang();
  const setNickname = useMutation<[string], { nickname: string }>("setNickname");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: Event) {
    event.preventDefault();
    const clean = sanitizeNickname(value);
    if (!clean) {
      setError(t("nicknameInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await withRetry(() => setNickname(clean));
    } catch {
      setError(t("err_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="py-8">
      <PageTitle lead={t("nicknameLead")}>{t("nicknameTitle")}</PageTitle>
      <form class="flex max-w-md flex-col gap-3" onSubmit={(e) => void submit(e)}>
        <Field label={t("nicknameLabel")} htmlFor="nickname" hint={t("nicknameHint")} error={error ?? undefined}>
          <Input
            id="nickname"
            name="nickname"
            autocomplete="nickname"
            maxLength={NICK_MAX}
            value={value}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
          />
        </Field>
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            {t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function FormatLabel({ format }: { format: string }) {
  const { t } = useLang();
  return (
    <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
      {format === "modern" ? t("modern") : t("classic")}
    </span>
  );
}

/**
 * Classic and modern decks in two groups; one group shows at a time. `only` limits the picker to one format
 * (after the server said which one a game uses).
 */
export function DeckPicker({
  selected,
  onSelect,
  only,
}: {
  selected: string | null;
  onSelect: (key: string) => void;
  only?: DeckFormat | null;
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<DeckFormat>(only ?? (selected ? DECKS[selected]?.format : undefined) ?? "classic");
  const group: DeckFormat = only ?? tab;
  const keys = group === "classic" ? CLASSIC_DECKS : MODERN_DECKS;

  return (
    <div>
      <div class="mb-4 flex items-baseline gap-6" role="tablist" aria-label={t("chooseDeck")}>
        {(["classic", "modern"] as const)
          .filter((f) => !only || f === only)
          .map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={group === f}
              onClick={() => setTab(f)}
              class={
                group === f
                  ? "text-lg font-bold text-ink underline decoration-accent decoration-[3px] underline-offset-8"
                  : "text-lg font-semibold text-ink-muted hover:text-ink"
              }
            >
              {f === "classic" ? t("classic") : t("modern")}
            </button>
          ))}
      </div>
      <p class="mb-5 text-sm text-ink-muted">{group === "classic" ? t("classicLead") : t("modernLead")}</p>
      <ul class="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
        {keys.map((key) => {
          const deck = DECKS[key];
          const active = key === selected;
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(key)}
                class={
                  active
                    ? "group block w-full -translate-y-1.5 text-left transition duration-150"
                    : "group block w-full text-left transition duration-150 hover:-translate-y-1"
                }
              >
                <img
                  src={deck.img}
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class={
                    active
                      ? "aspect-[63/88] w-full rounded-lg bg-surface object-cover shadow-[0_12px_32px_-8px_rgba(255,203,5,0.65)]"
                      : "aspect-[63/88] w-full rounded-lg bg-surface object-cover shadow-lg shadow-black/40 group-hover:shadow-xl"
                  }
                />
                <span
                  class={
                    active
                      ? "mt-2 block truncate text-sm font-bold text-ink underline decoration-accent decoration-2 underline-offset-4"
                      : "mt-2 block truncate text-sm font-semibold text-ink"
                  }
                >
                  {deck.name}
                </span>
                <span class="flex items-center justify-between gap-2">
                  <span class="truncate text-xs text-ink-muted">{deck.types.join(" · ")}</span>
                  <FormatLabel format={deck.format} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The bar that confirms a deck choice: the chosen card name and the main action. */
export function ChoiceBar({ deck, error, children }: { deck: string | null; error?: string | null; children: ComponentChildren }) {
  const { t } = useLang();
  const info = deck ? DECKS[deck] : null;
  return (
    <div class="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center justify-between gap-4 bg-canvas/95 px-4 py-4 backdrop-blur">
      <div class="min-w-0">
        {info ? (
          <p class="truncate text-base font-semibold text-ink">
            {info.name} <span class="ml-2 align-middle"><FormatLabel format={info.format} /></span>
          </p>
        ) : (
          <p class="text-sm text-ink-muted">{t("chooseDeck")}</p>
        )}
        {error ? (
          <p role="alert" class="mt-1 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div class="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}
