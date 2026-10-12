"use client";

import { useState } from "preact/hooks";
import { Link, useMutation, useQuery } from "@spacefast/zero/client";
import { Button, Spinner } from "@spacefast/zero/kit";

import type { DeckFormat } from "../shared/decks";
import { isInviteCode, type JoinResult } from "../shared/rules";
import { useLang } from "../client/lang";
import { ChoiceBar, DeckPicker, NicknameForm, PageTitle, SignInPanel } from "../client/ui";
import { appHref, go, withRetry } from "../client/util";

type Profile = { nickname: string | null } | null;

// The invite code lives in the address fragment, which never reaches a server. It is read once, wiped from the
// address bar and history, and kept in memory. Only while signed out is it parked in this tab's sessionStorage, so it
// survives the sign-in round trip; the next load takes it back out.
const PARKED = "versus.join";
let remembered: string | null = null;

function takeCode(): string | null {
  const fromHash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
  if (isInviteCode(fromHash)) remembered = fromHash;
  let parked: string | null = null;
  try {
    parked = sessionStorage.getItem(PARKED);
    sessionStorage.removeItem(PARKED);
  } catch {
    parked = null;
  }
  if (!remembered && isInviteCode(parked)) remembered = parked;
  return remembered;
}

function park(code: string) {
  try {
    sessionStorage.setItem(PARKED, code);
  } catch {
    // Without storage the player opens the link again after signing in.
  }
}

function forget() {
  remembered = null;
  try {
    sessionStorage.removeItem(PARKED);
  } catch {
    // Nothing parked.
  }
}

export default function JoinPage() {
  const { t } = useLang();
  const [code] = useState(takeCode);
  const profile = useQuery<Profile>("myProfile");

  if (!code) {
    return (
      <section class="py-10">
        <PageTitle lead={t("joinNoCode")}>{t("joinTitle")}</PageTitle>
        <Link to={appHref("/")} class="font-semibold text-accent hover:underline">
          {t("backToLobby")}
        </Link>
      </section>
    );
  }
  if (profile === undefined) {
    return (
      <div class="flex justify-center py-24">
        <Spinner label={t("loading")} />
      </div>
    );
  }
  if (profile === null) {
    park(code);
    return <SignInPanel lead={t("signInToJoin")} />;
  }
  if (profile.nickname === null) return <NicknameForm />;
  return <JoinForm code={code} />;
}

function JoinForm({ code }: { code: string }) {
  const { t } = useLang();
  const joinMatch = useMutation<[string, string], JoinResult>("joinMatch");
  const [deck, setDeck] = useState<string | null>(null);
  const [only, setOnly] = useState<DeckFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dead, setDead] = useState(false);

  async function join() {
    if (!deck || busy || dead) return;
    setBusy(true);
    setError(null);
    try {
      const result = await withRetry(() => joinMatch(code, deck));
      if (result && typeof result.id === "string") {
        forget();
        go(`/play?m=${encodeURIComponent(result.id)}`, true);
        return;
      }
      const reason = result && result.id === null ? result.error : "not_available";
      if (reason === "wrong_format" && result && result.id === null && (result.format === "classic" || result.format === "modern")) {
        setOnly(result.format);
        setDeck(null);
        setError(t("err_wrong_format", { format: result.format === "modern" ? t("modern") : t("classic") }));
      } else if (reason === "slow_down") {
        setError(t("err_slow_down"));
      } else if (reason === "too_many") {
        setError(t("err_too_many"));
      } else {
        forget();
        setDead(true);
        setError(t("err_not_available"));
      }
    } catch {
      setError(t("err_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (dead) {
    return (
      <section class="py-10">
        <PageTitle lead={t("err_not_available")}>{t("joinTitle")}</PageTitle>
        <Link to={appHref("/")} class="font-semibold text-accent hover:underline">
          {t("myGames")}
        </Link>
      </section>
    );
  }

  return (
    <section class="pt-8">
      <PageTitle lead={t("joinLead")}>{t("joinTitle")}</PageTitle>
      <DeckPicker key={only ?? "both"} selected={deck} onSelect={setDeck} only={only} />
      <ChoiceBar deck={deck} error={error}>
        <span class="hidden text-sm text-ink-muted sm:inline">{t("opensJoin")}</span>
        <Button size="lg" disabled={!deck || busy} loading={busy} onClick={() => void join()}>
          {busy ? t("joining") : t("join")}
        </Button>
      </ChoiceBar>
    </section>
  );
}
