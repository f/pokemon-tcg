import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { Link, signOut, useAuth } from "@spacefast/zero/client";
import { Spinner } from "@spacefast/zero/kit";

import { ACADEMY_URL } from "../shared/config";
import { LANGS, LANG_LABELS } from "../shared/i18n";
import { isDevGuestId } from "../shared/rules";
import { setLang, useLang } from "./lang";
import { appHref } from "./util";

function LangSwitch() {
  const { lang, t } = useLang();
  return (
    <div class="flex items-center gap-2 text-xs font-semibold" role="group" aria-label={t("language")}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
          class={
            lang === code
              ? "text-ink underline decoration-accent decoration-2 underline-offset-4"
              : "text-ink-muted hover:text-ink"
          }
        >
          {LANG_LABELS[code]}
        </button>
      ))}
    </div>
  );
}

function AuthControls() {
  const auth = useAuth();
  const { t } = useLang();
  if (auth.isLoading) return <Spinner size="sm" label={t("loading")} />;
  const devGuest = auth.isGuest && isDevGuestId(auth.userId);
  if (!auth.isSignedIn && !devGuest) return null;
  return (
    <div class="flex min-w-0 items-center gap-3 text-sm">
      <span class="max-w-[12rem] truncate text-ink-muted" title={auth.displayName}>
        {auth.displayName}
        {devGuest ? ` · ${t("devGuest")}` : ""}
      </span>
      {auth.isSignedIn ? (
        <button type="button" class="font-semibold text-ink hover:text-accent" onClick={() => void signOut()}>
          {t("signOut")}
        </button>
      ) : null}
    </div>
  );
}

export function Layout({ children }: { children: ComponentChildren }) {
  const { lang, t } = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.style.colorScheme = "dark";
    document.title = `Pokémon ${t("appName")}`;
  }, [lang]);
  return (
    <div class="flex min-h-dvh flex-col bg-canvas text-ink [color-scheme:dark]">
      <header class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div class="flex min-w-0 items-baseline gap-4">
          <Link to={appHref("/")} class="whitespace-nowrap text-lg font-extrabold tracking-tight text-ink hover:text-accent">
            {t("appName")}
          </Link>
          <a href={ACADEMY_URL} class="whitespace-nowrap text-sm text-ink-muted hover:text-ink">
            {t("academyLink")} ↗
          </a>
        </div>
        <div class="flex items-center gap-5">
          <LangSwitch />
          <AuthControls />
        </div>
      </header>
      <main class="mx-auto w-full max-w-6xl flex-1 px-4 pb-10">{children}</main>
    </div>
  );
}
