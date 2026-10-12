"use client";

import { useRef, useState } from "preact/hooks";
import { Link, useAuth, useLocation, useMutation, useQuery } from "@spacefast/zero/client";
import { Spinner, Switch } from "@spacefast/zero/kit";

import { DECKS } from "../shared/decks";
import { isMatchId, type InboxItem, type MatchView } from "../shared/rules";
import { GameFrame } from "../client/GameFrame";
import { useLang } from "../client/lang";
import { PageTitle, SignInButtons } from "../client/ui";
import { appHref, go, readStorage, withRetry, writeStorage } from "../client/util";

const RELAY_KEY = "versus.relayOnly";
const IP_SEEN_KEY = "versus.ipNoticeSeen";

export default function PlayPage() {
  const { t } = useLang();
  const location = useLocation();
  const matchId = new URLSearchParams(location.search).get("m");
  if (!isMatchId(matchId)) return <NotAvailable text={t("err_not_available")} />;
  return <PlayRoom key={matchId} matchId={matchId} />;
}

function NotAvailable({ text }: { text: string }) {
  const { t } = useLang();
  const auth = useAuth();
  return (
    <section class="py-10">
      <PageTitle lead={!auth.isLoading && !auth.isSignedIn ? t("signInToPlay") : undefined}>{text}</PageTitle>
      {!auth.isLoading && !auth.isSignedIn ? <SignInButtons /> : null}
      <p class="mt-8">
        <Link to={appHref("/")} class="font-semibold text-accent hover:underline">
          {t("backToLobby")}
        </Link>
      </p>
    </section>
  );
}

function PlayRoom({ matchId }: { matchId: string }) {
  const { t, lang } = useLang();
  // The page's two subscriptions: the match and the caller's inbox after the last acknowledged message.
  const match = useQuery<MatchView | null>("match", matchId);
  const [afterSeq, setAfterSeq] = useState(0);
  const inbox = useQuery<InboxItem[]>("inbox", matchId, afterSeq);
  const abandonMatch = useMutation<[string], { ok: true }>("abandonMatch");
  // A direct (WebRTC) connection shows the opponent this player's IP address, so nothing connects until the player
  // has chosen: directly (the default suggestion) or relayed through Spacefast. The choice is remembered.
  const [choice, setChoice] = useState(() => readStorage(RELAY_KEY));
  const relayOnly = choice !== "0";
  const [noticeOpen, setNoticeOpen] = useState(() => readStorage(IP_SEEN_KEY) !== "1");
  const [leaving, setLeaving] = useState(false);
  // Once the frame is up it stays mounted, so it can show the result when the status changes.
  const framed = useRef(false);
  if (match && match.status === "playing") framed.current = true;

  if (match === undefined) {
    return (
      <div class="flex justify-center py-24">
        <Spinner label={t("loading")} />
      </div>
    );
  }
  if (match === null) return <NotAvailable text={t("err_not_available")} />;

  const opponent = match.role === "host" ? match.guestNick : match.hostNick;
  const oppDeck = match.role === "host" ? match.guestDeck : match.hostDeck;

  function toggleRelay(value: boolean) {
    setChoice(value ? "1" : "0");
    writeStorage(RELAY_KEY, value ? "1" : "0");
  }

  async function leave() {
    if (match && match.status === "playing") {
      if (!confirm(t("leaveConfirm"))) return;
      setLeaving(true);
      try {
        await withRetry(() => abandonMatch(matchId));
      } catch {
        // The game stays in My games; the player can abandon it from there.
      }
    }
    go("/");
  }

  const result =
    match.winner === "draw"
      ? t("result_draw")
      : match.winner
        ? match.winner === match.role
          ? t("result_won")
          : t("result_lost")
        : null;

  return (
    <div class="-mx-4 flex flex-col">
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pb-2">
        <div class="flex min-w-0 items-baseline gap-3">
          <p class="truncate text-base font-bold text-ink">
            {t("opponent")}: {opponent ?? "…"}
          </p>
          {oppDeck && DECKS[oppDeck] ? <span class="truncate text-sm text-ink-muted">{DECKS[oppDeck].name}</span> : null}
          <span class="text-sm text-ink-muted">
            ·{" "}
            {match.status === "playing"
              ? t("status_playing")
              : match.status === "open"
                ? t("status_open")
                : match.status === "done"
                  ? t("status_done")
                  : t("status_abandoned")}
            {result ? ` · ${result}` : ""}
          </span>
        </div>
        <div class="flex items-center gap-5">
          <button
            type="button"
            aria-expanded={noticeOpen}
            onClick={() => {
              setNoticeOpen(!noticeOpen);
              writeStorage(IP_SEEN_KEY, "1");
            }}
            class={noticeOpen ? "text-sm font-semibold text-ink underline decoration-accent decoration-2 underline-offset-4" : "text-sm text-ink-muted hover:text-ink"}
          >
            {t("ipTitle")}
          </button>
          <button
            type="button"
            disabled={leaving}
            onClick={() => void leave()}
            class="text-sm font-semibold text-ink-muted hover:text-danger disabled:opacity-50"
          >
            {t("leave")}
          </button>
        </div>
      </div>
      {noticeOpen ? (
        <div class="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 pb-3">
          <p class="max-w-3xl text-sm leading-relaxed text-ink-muted">
            {t("ipNotice")} {t("opensFrame")}
          </p>
          <Switch
            label={t("ipSwitch")}
            checked={relayOnly}
            onChange={(e) => toggleRelay((e.currentTarget as HTMLInputElement).checked)}
          />
        </div>
      ) : null}
      {framed.current && choice !== "0" && choice !== "1" ? (
        <section class="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-14">
          <p class="text-2xl font-bold text-ink">{t("connectTitle")}</p>
          <button type="button" onClick={() => toggleRelay(false)} class="rounded-xl bg-accent px-5 py-4 text-left text-canvas hover:opacity-90">
            <span class="block text-lg font-bold">{t("connectDirect")}</span>
            <span class="mt-1 block text-sm opacity-90">{t("connectDirectNote")}</span>
          </button>
          <button type="button" onClick={() => toggleRelay(true)} class="rounded-xl border border-line px-5 py-4 text-left text-ink hover:bg-surface">
            <span class="block text-lg font-bold">{t("connectRelay")}</span>
            <span class="mt-1 block text-sm text-ink-muted">{t("connectRelayNote")}</span>
          </button>
          <p class="text-sm text-ink-muted">{t("opensFrame")}</p>
        </section>
      ) : framed.current ? (
        <GameFrame
          key={relayOnly ? "relay" : "direct"}
          matchId={matchId}
          match={match}
          inbox={inbox}
          lang={lang}
          relayOnly={relayOnly}
          onAck={(upto) => setAfterSeq((prev) => (upto > prev ? upto : prev))}
        />
      ) : (
        <section class="px-4 py-16 text-center">
          <p class="text-2xl font-bold text-ink">{result ?? (match.status === "open" ? t("waiting") : t("status_done"))}</p>
          <p class="mt-6">
            <Link to={appHref("/")} class="font-semibold text-accent hover:underline">
              {t("backToLobby")}
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
