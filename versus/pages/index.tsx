"use client";

import { useEffect, useState } from "preact/hooks";
import { Link, useMutation, useQuery } from "@spacefast/zero/client";
import { Button, Spinner } from "@spacefast/zero/kit";

import { DECKS } from "../shared/decks";
import { isLocalHost } from "../shared/config";
import { MAX_ACTIVE_MATCHES, type MatchView, type MyMatchItem } from "../shared/rules";
import { useLang, type T } from "../client/lang";
import { ChoiceBar, DeckPicker, ErrorLine, FormatLabel, NicknameForm, PageTitle, SectionTitle, SignInPanel } from "../client/ui";
import { appHref, go, newInvite, withRetry } from "../client/util";

type Profile = { nickname: string | null } | null;
type Waiting = { id: string; code: string };

export default function IndexPage() {
  const { t } = useLang();
  // Subscriptions on this page: myProfile, plus either match (waiting room) or myMatches (home). Never more than two.
  const profile = useQuery<Profile>("myProfile");
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  if (profile === undefined) return <Loading label={t("loading")} />;
  if (profile === null) return <SignInPanel />;
  if (profile.nickname === null) return <NicknameForm />;
  if (waiting) return <WaitingRoom waiting={waiting} onClose={() => setWaiting(null)} />;
  return <Home nickname={profile.nickname} onCreated={setWaiting} />;
}

function Loading({ label }: { label: string }) {
  return (
    <div class="flex justify-center py-24">
      <Spinner label={label} />
    </div>
  );
}

function Home({ nickname, onCreated }: { nickname: string; onCreated: (w: Waiting) => void }) {
  const { t } = useLang();
  const games = useQuery<MyMatchItem[]>("myMatches");
  const active = (games ?? []).filter((g) => g.status === "open" || g.status === "playing").length;
  return (
    <div class="pt-6">
      <p class="mb-1 text-sm text-ink-muted">
        {t("you")}: <span class="font-semibold text-ink">{nickname}</span>
      </p>
      {games && games.length > 0 ? <MyGames games={games} /> : null}
      <NewGame full={active >= MAX_ACTIVE_MATCHES} onCreated={onCreated} />
    </div>
  );
}

function NewGame({ full, onCreated }: { full: boolean; onCreated: (w: Waiting) => void }) {
  const { t } = useLang();
  const createMatch = useMutation<[string, string], { id: string }>("createMatch");
  const [deck, setDeck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not retried: if a create commits but its answer is lost, a retry with the same hash is refused and a fresh hash
  // would make a second game. The player checks My games instead (the link of a lost answer can't be recovered).
  async function create() {
    if (!deck || busy) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await newInvite();
      const created = await createMatch(deck, invite.hash);
      if (!created || typeof created.id !== "string") throw new Error("no id");
      onCreated({ id: created.id, code: invite.code });
    } catch {
      setError(t("err_create"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="pt-8">
      <PageTitle lead={t("chooseDeck")}>{t("newGame")}</PageTitle>
      <DeckPicker selected={deck} onSelect={setDeck} />
      <ChoiceBar deck={deck} error={error}>
        {full ? (
          <p class="max-w-xs text-right text-sm text-ink-muted">{t("err_too_many")}</p>
        ) : (
          <Button size="lg" disabled={!deck || busy} loading={busy} onClick={() => void create()}>
            {busy ? t("creating") : t("createGame")}
          </Button>
        )}
      </ChoiceBar>
    </section>
  );
}

function statusText(t: T, status: string): string {
  if (status === "open") return t("status_open");
  if (status === "playing") return t("status_playing");
  if (status === "done") return t("status_done");
  if (status === "abandoned") return t("status_abandoned");
  return status;
}

function ago(lang: string, ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (diff < 60_000) return rtf.format(0, "minute");
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute");
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), "hour");
  return rtf.format(-Math.round(diff / 86_400_000), "day");
}

function MyGames({ games }: { games: MyMatchItem[] }) {
  const { t, lang } = useLang();
  const abandonMatch = useMutation<[string], { ok: true }>("abandonMatch");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function abandon(game: MyMatchItem) {
    if (!confirm(game.status === "open" ? t("cancelConfirm") : t("abandonConfirm"))) return;
    setBusy(game.id);
    setError(null);
    try {
      await withRetry(() => abandonMatch(game.id));
    } catch {
      setError(t("err_generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section class="pt-6">
      <SectionTitle>{t("myGames")}</SectionTitle>
      <ul class="divide-y divide-line">
        {games.map((g) => {
          const mine = DECKS[g.myDeck];
          const theirs = g.oppDeck ? DECKS[g.oppDeck] : null;
          return (
            <li key={g.id} class="flex flex-wrap items-center gap-x-5 gap-y-3 py-4">
              <div class="flex shrink-0 items-end">
                {mine ? <img src={mine.img} alt="" referrerpolicy="no-referrer" loading="lazy" class="w-11 -rotate-6 rounded shadow-lg shadow-black/40" /> : null}
                {theirs ? <img src={theirs.img} alt="" referrerpolicy="no-referrer" loading="lazy" class="-ml-3 w-11 rotate-6 rounded shadow-lg shadow-black/40" /> : null}
              </div>
              <div class="min-w-0 flex-1 basis-48">
                <p class="truncate text-base font-semibold text-ink">
                  {g.oppNick ? `${t("opponent")}: ${g.oppNick}` : t("waiting")}
                </p>
                <p class="truncate text-sm text-ink-muted">
                  {mine ? mine.name : g.myDeck}
                  {theirs ? ` vs ${theirs.name}` : ""} · {statusText(t, g.status)} · {t("lastMove")} {ago(lang, g.lastMoveAt)}
                </p>
              </div>
              <div class="ml-auto flex items-center gap-4">
                <span class="hidden sm:inline">
                  <FormatLabel format={g.format} />
                </span>
                {g.status === "playing" ? (
                  <Link
                    to={appHref(`/play?m=${encodeURIComponent(g.id)}`)}
                    title={t("opensResume")}
                    class="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-bold text-accent-foreground hover:brightness-110"
                  >
                    {t("resume")}
                  </Link>
                ) : null}
                {g.status === "playing" || g.status === "open" ? (
                  <button
                    type="button"
                    disabled={busy === g.id}
                    onClick={() => void abandon(g)}
                    class="text-sm font-semibold text-ink-muted hover:text-danger disabled:opacity-50"
                  >
                    {g.status === "open" ? t("cancelGame") : t("abandon")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorLine text={error} />
    </section>
  );
}

function WaitingRoom({ waiting, onClose }: { waiting: Waiting; onClose: () => void }) {
  const { t } = useLang();
  const match = useQuery<MatchView | null>("match", waiting.id);
  const abandonMatch = useMutation<[string], { ok: true }>("abandonMatch");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${location.origin}/join#${waiting.code}`;

  useEffect(() => {
    if (match && match.status === "playing") go(`/play?m=${encodeURIComponent(waiting.id)}`);
  }, [match?.status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.getElementById("invite-link") as HTMLInputElement | null;
      input?.select();
    }
  }

  async function cancel() {
    if (!confirm(t("cancelConfirm"))) return;
    try {
      await withRetry(() => abandonMatch(waiting.id));
      onClose();
    } catch {
      setError(t("err_generic"));
    }
  }

  if (match === null) {
    return (
      <section class="py-10">
        <PageTitle>{t("err_not_available")}</PageTitle>
        <Button variant="secondary" onClick={onClose}>
          {t("backToLobby")}
        </Button>
      </section>
    );
  }

  const deck = match ? DECKS[match.hostDeck] : null;
  return (
    <section class="grid gap-10 py-8 md:grid-cols-[1fr_auto] md:items-start">
      <div>
        <PageTitle lead={t("inviteLead")}>{t("inviteTitle")}</PageTitle>
        <div class="flex max-w-2xl flex-col gap-3 sm:flex-row">
          <input
            id="invite-link"
            readOnly
            value={link}
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
            class="h-11 min-w-0 flex-1 rounded-md bg-surface px-3 font-mono text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
          />
          <Button size="lg" onClick={() => void copy()}>
            {copied ? t("copied") : t("copy")}
          </Button>
        </div>
        {isLocalHost(location.hostname) ? (
          <p class="mt-3 font-mono text-xs text-ink-muted">sf dev: {`${location.origin}/join?guest=bob#${waiting.code}`}</p>
        ) : null}
        <div class="mt-10 flex items-center gap-3">
          <Spinner size="sm" />
          <p class="text-lg font-semibold text-ink">{t("waiting")}</p>
        </div>
        <p class="mt-1 text-sm text-ink-muted">{t("waitingLead")}</p>
        <button type="button" class="mt-8 text-sm font-semibold text-ink-muted hover:text-danger" onClick={() => void cancel()}>
          {t("cancelGame")}
        </button>
        <ErrorLine text={error} />
      </div>
      {deck ? (
        <figure class="hidden md:block">
          <img src={deck.img} alt="" referrerpolicy="no-referrer" class="w-56 rotate-3 rounded-xl shadow-2xl shadow-black/50" />
          <figcaption class="mt-3 text-center text-sm font-semibold text-ink">{deck.name}</figcaption>
        </figure>
      ) : null}
    </section>
  );
}
