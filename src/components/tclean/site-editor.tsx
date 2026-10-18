import { useEffect, useState, useTransition } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { businessQuery } from "@/lib/business-query";
import {
  saveSiteColor,
  saveSiteSetting,
  clearSiteColors,
  updateButtonLink,
  permanentlyDeleteHidden,
} from "@/lib/business.functions";
import { elementColorKey } from "@/lib/site-colors";
import { HIDEABLE, hideKey, parseInfo } from "@/lib/editor-history";
import { SiteColorEditor } from "./site-color-editor";
import { Palette, Type, MousePointerClick, Trash2, ArrowUpRight, Video, Move } from "lucide-react";
import { EditorTypographyToolbar } from "./site-typography-toolbar";

type Mode = "colors" | "typography" | "buttons" | "delete" | "permanent-delete" | "history" | "media" | "move";

type Audience = "all" | "client" | "admin";

type PendingLink = {
  key: string;
  label: string;
};

type PendingMedia = {
  key: string;
  label: string;
};

type PendingMove = {
  key: string;
  label: string;
  element: HTMLElement;
};

export function SiteEditor() {
  const { data: c } = useSuspenseQuery(businessQuery);

  const save = useServerFn(saveSiteSetting);
  const saveColors = useServerFn(saveSiteColor);
  const clearColors = useServerFn(clearSiteColors);
  const linkRedirect = useServerFn(updateButtonLink);

  const [isAdmin, setIsAdmin] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("colors");
  const [audience, setAudience] = useState<Audience>("all");

  const [pending, setPending] = useState<PendingLink | null>(null);
  const [mediaPending, setMediaPending] = useState<PendingMedia | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaLayer, setMediaLayer] = useState<"behind" | "above" | "front">("behind");
  const [mediaOpacity, setMediaOpacity] = useState(1);

  const [movePending, setMovePending] = useState<PendingMove | null>(null);
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [moveAlign, setMoveAlign] = useState<"left" | "center" | "right">("center");

  const [inspectTarget, setInspectTarget] = useState<HTMLElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!alive || !session) {
        setIsAdmin(false);
        return;
      }

      const res = await supabase.rpc("has_role", {
        _user_id: session.user.id,
        _role: "admin",
      });

      if (alive) {
        setIsAdmin(res.data === true);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const hidden = (c.hidden ?? {}) as Record<string, string>;
  const permanentHidden = (c.permanentlyDeletedElements ?? {}) as Record<string, boolean>;
  const allHidden = { ...hidden, ...permanentHidden };

  useEffect(() => {
    if (!enabled) {
      setPending(null);
      setMediaPending(null);
      setMovePending(null);
      setInspectTarget(null);
      return;
    }

    const stored = window.sessionStorage.getItem("tc-editor-pending-link");

    if (stored) {
      try {
        setPending(JSON.parse(stored) as PendingLink);
      } catch {
        // Ignore invalid stored data.
      }
    }
  }, [enabled]);

  const choosePending = (next: PendingLink | null) => {
    setPending(next);

    if (next) {
      window.sessionStorage.setItem("tc-editor-pending-link", JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem("tc-editor-pending-link");
    }
  };

  const clickable = (el: Element): HTMLAnchorElement | HTMLButtonElement | null => {
    const a = el.closest("a");

    if (a instanceof HTMLAnchorElement && a.href) {
      return a;
    }

    const b = el.closest("button");

    if (b instanceof HTMLButtonElement) {
      return b;
    }

    return null;
  };

  const linkKey = (el: HTMLAnchorElement | HTMLButtonElement): string => {
    const label = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

    const orig =
      el instanceof HTMLAnchorElement ? (el.getAttribute("href") ?? "") : (el.getAttribute("data-action") ?? "action");

    return `${label}|${orig}`;
  };

  const mediaKey = (el: HTMLElement): string => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const firstClass = el.classList.length ? `.${el.classList[0]}` : "";

    const textPreview = (el.textContent ?? "").trim().slice(0, 30).replace(/\s+/g, "-");

    return `${pathname}::${tag}${id}${firstClass}::${textPreview}`;
  };

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      try {
        await fn();
        toast.success("Modification enregistrée.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Échec de l’enregistrement.");
      }
    });
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;

      if (!el || el.closest(".tc-site-editor-bar") || el.closest(".tc-site-editor-panel")) {
        return;
      }

      if (mode === "colors") {
        e.preventDefault();
        e.stopPropagation();
        setInspectTarget(el);
        return;
      }

      if (mode === "buttons") {
        const btn = clickable(el);

        if (!btn) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const key = linkKey(btn);

        choosePending({
          key,
          label: key.split("|")[0] ?? "",
        });

        toast("Naviguez jusqu’à la page voulue puis cliquez sur « Rediriger ici ».");

        return;
      }

      if (mode === "permanent-delete") {
        e.preventDefault();
        e.stopPropagation();

        let selected = el.closest(HIDEABLE) ?? el;
        let key = hideKey(selected);
        let ancestor = selected.parentElement;

        while (
          (!key || allHidden[key] === undefined || permanentHidden[key]) &&
          ancestor &&
          ancestor !== document.body
        ) {
          const candidate = hideKey(ancestor);

          if (candidate && allHidden[candidate] !== undefined && !permanentHidden[candidate]) {
            selected = ancestor;
            key = candidate;
            break;
          }

          ancestor = ancestor.parentElement;
        }

        if (!key || allHidden[key] === undefined || permanentHidden[key]) {
          toast.error("Cliquez sur un élément grisé qui a déjà été supprimé.");
          return;
        }

        const entry = allHidden[key];

        if (!entry) {
          return;
        }

        const info = parseInfo(entry);

        if (
          !window.confirm(`SUPPRESSION DÉFINITIVE : « ${info.label || key} » ne pourra plus être rétabli. Continuer ?`)
        ) {
          return;
        }

        void run(() =>
          permanentlyDeleteHidden({
            data: { key },
          }),
        );

        return;
      }

      if (mode === "delete") {
        e.preventDefault();
        e.stopPropagation();

        const selected = el.closest(HIDEABLE) ?? el;
        const legacy = elementColorKey(selected, pathname);

        if (legacy && c.elementColors?.[legacy]?.display === "none") {
          const cur = { ...c.elementColors[legacy] };

          delete cur.display;

          void run(() =>
            saveColors({
              data: {
                kind: "element",
                key: legacy,
                colors: Object.keys(cur).length ? cur : null,
              },
            }),
          );

          return;
        }

        const key = hideKey(selected);

        if (!key) {
          toast.error("Sélectionnez un autre élément.");
          return;
        }

        if (permanentHidden[key]) {
          toast.error("Cet élément a été supprimé définitivement.");
          return;
        }

        // Si l’élément est déjà masqué, le rétablir.
        if (hidden[key] !== undefined) {
          void run(() =>
            save({
              data: {
                kind: "hide",
                key,
                value: null,
              },
            }),
          );

          return;
        }

        if (!window.confirm("Supprimer cet élément sur tout le site ? Vous pourrez le rétablir depuis l’historique.")) {
          return;
        }

        const label =
          selected instanceof HTMLImageElement
            ? `Photo (${selected.alt || "sans titre"})`
            : (selected.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

        // Un seul appel save, correctement fermé.
        void run(() =>
          save({
            data: {
              kind: "hide",
              key,
              value: JSON.stringify({
                label,
                page: pathname,
                at: new Date().toISOString(),
              }),
              audience,
            },
          }),
        );

        return;
      }

      if (mode === "media") {
        e.preventDefault();
        e.stopPropagation();

        const key = mediaKey(el);

        setMediaPending({
          key,
          label: (el.textContent ?? "").trim().slice(0, 50) || el.tagName.toLowerCase(),
        });

        return;
      }

      if (mode === "move") {
        e.preventDefault();
        e.stopPropagation();

        const key = mediaKey(el);

        setMovePending({
          key,
          label: (el.textContent ?? "").trim().slice(0, 50) || el.tagName.toLowerCase(),
          element: el,
        });

        return;
      }
    };

    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, mode, audience, pathname, hidden, permanentHidden, allHidden, c.elementColors]);

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <div className="tc-site-editor-bar">
        <div className="tc-site-editor-bar-inner">
          <button
            type="button"
            className={enabled ? "tc-site-editor-toggle active" : "tc-site-editor-toggle"}
            onClick={() => setEnabled((v) => !v)}
          >
            {enabled ? "Quitter le mode édition" : "Mode édition"}
          </button>

          {enabled && (
            <>
              <div className="tc-site-editor-nav">
                <button type="button" className={mode === "colors" ? "active" : ""} onClick={() => setMode("colors")}>
                  <Palette size={15} /> Couleurs
                </button>

                <button
                  type="button"
                  className={mode === "typography" ? "active" : ""}
                  onClick={() => setMode("typography")}
                >
                  <Type size={15} /> Textes et photos
                </button>

                <button type="button" className={mode === "buttons" ? "active" : ""} onClick={() => setMode("buttons")}>
                  <MousePointerClick size={15} /> Redirections
                </button>

                <button type="button" className={mode === "delete" ? "active" : ""} onClick={() => setMode("delete")}>
                  <Trash2 size={15} /> Supprimer
                </button>

                <button
                  type="button"
                  className={mode === "permanent-delete" ? "active" : ""}
                  onClick={() => setMode("permanent-delete")}
                >
                  <Trash2 size={15} /> Suppression définitive
                </button>

                <button type="button" className={mode === "media" ? "active" : ""} onClick={() => setMode("media")}>
                  <Video size={15} /> Médias
                </button>

                <button type="button" className={mode === "move" ? "active" : ""} onClick={() => setMode("move")}>
                  <Move size={15} /> Déplacer
                </button>
              </div>

              <div className="tc-site-editor-audience">
                <span>Visible par :</span>

                <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                  <option value="all">Tout le monde</option>
                  <option value="client">Clients et visiteurs</option>
                  <option value="admin">Admin uniquement</option>
                </select>
              </div>

              {pending && (
                <div className="tc-site-editor-pending">
                  <span>
                    Bouton : <strong>{pending.label}</strong>
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      void run(() =>
                        linkRedirect({
                          data: {
                            key: pending.key,
                            target: pathname,
                          },
                        }),
                      );

                      choosePending(null);
                    }}
                  >
                    <ArrowUpRight size={14} /> Rediriger ici ({pathname})
                  </button>

                  <button type="button" onClick={() => choosePending(null)}>
                    Annuler
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {enabled && mode === "typography" && <EditorTypographyToolbar audience={audience} />}

      {enabled && mode === "colors" && inspectTarget && (
        <SiteColorEditor
          target={inspectTarget}
          onClose={() => setInspectTarget(null)}
          pathname={pathname}
          audience={audience}
        />
      )}
    </>
  );
}
