"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, PencilLine } from "lucide-react";
import TranscriptEditor from "@/components/TranscriptEditor";
import ActionButton from "@/components/ActionButton";
import { alignTranscript, currentIndex, type Segment } from "@/lib/align";
import { queueTimings } from "@/app/actions/messages";

type Props = {
  messageId: string;
  text: string;
  audioUrl: string | null;
  timeline: Segment[] | null;
  timingsRunning: boolean;
  timingsFailed: string | null;
  approved: boolean;
  canEdit: boolean;
  needsDetails: boolean;
};

const PAUSE_AFTER_SCROLL_MS = 8000;

// The transcript with the recording. "Listen" highlights each sentence as it's spoken and
// plays from any sentence you click; "Edit" is the reviewer's text box. The player sits
// above both, so the audio keeps playing when you switch to fix something.
export default function TranscriptPanel(props: Props) {
  const { messageId, text, audioUrl, timeline, approved, canEdit, needsDetails } = props;
  const [value, setValue] = useState(text);
  const [view, setView] = useState<"listen" | "edit">(audioUrl && timeline ? "listen" : canEdit && !approved ? "edit" : "listen");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);

  // Matching uses the text as it is now, so the highlight follows unsaved edits too.
  const paragraphs = useMemo(() => alignTranscript(value, timeline), [value, timeline]);
  const starts = useMemo(() => paragraphs.flat().map((s) => s.start ?? 0), [paragraphs]);
  const timed = !!timeline && !!audioUrl;
  const active = timed && (playing || time > 0) ? currentIndex(starts, time) : -1;
  const sentences = paragraphs.flat();

  const playFrom = useCallback((seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds - 0.3);
    setTime(el.currentTime);
    el.play().catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {audioUrl && (
        <div className="flex flex-col gap-2 rounded-xl bg-banner p-4">
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={audioUrl}
            className="w-full"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          {view === "edit" && timed && active >= 0 && (
            <p className="text-sm text-muted" aria-live="off">
              <span className="font-medium text-ink">Now: </span>
              {sentences[active]?.text}
            </p>
          )}
          <TimingsNote {...props} />
        </div>
      )}

      {(audioUrl || canEdit) && (
        <div role="tablist" aria-label="Transcript view" className="inline-flex self-start rounded-[10px] bg-seg p-1">
          <Tab on={view === "listen"} onClick={() => setView("listen")} icon={<Headphones aria-hidden size={16} />}>
            Listen
          </Tab>
          <Tab on={view === "edit"} onClick={() => setView("edit")} icon={<PencilLine aria-hidden size={16} />}>
            {canEdit && !approved ? "Edit" : "Text"}
          </Tab>
        </div>
      )}

      {/* Both stay mounted, so switching views never loses unsaved edits or the scroll place. */}
      <div hidden={view !== "listen"}>
        <ListenView paragraphs={paragraphs} active={active} timed={timed} playing={playing} onPick={playFrom} visible={view === "listen"} />
      </div>
      <div hidden={view !== "edit"}>
        <TranscriptEditor
          messageId={messageId}
          text={text}
          value={value}
          onChange={setValue}
          approved={approved}
          canEdit={canEdit}
          needsDetails={needsDetails}
        />
      </div>
    </div>
  );
}

function Tab({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors ${on ? "bg-seg-on text-ink shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {icon}
      {children}
    </button>
  );
}

function TimingsNote({ messageId, timeline, timingsRunning, timingsFailed, canEdit }: Props) {
  if (timeline) return null;
  if (timingsRunning) return <p className="text-sm text-muted">Adding timings, so the text can follow the audio. Refresh in a few minutes.</p>;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
      <span>
        {timingsFailed ? `Adding timings failed: ${timingsFailed}` : "This transcript has no timings yet, so the text can’t follow the audio."}
      </span>
      {canEdit && (
        <ActionButton action={queueTimings.bind(null, messageId)} pendingLabel="Queueing…">
          {timingsFailed ? "Try again" : "Add timings"}
        </ActionButton>
      )}
    </div>
  );
}

function ListenView({
  paragraphs,
  active,
  timed,
  playing,
  onPick,
  visible,
}: {
  paragraphs: { text: string; start: number | null }[][];
  active: number;
  timed: boolean;
  playing: boolean;
  onPick: (seconds: number) => void;
  visible: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);
  const [away, setAway] = useState(false);

  const scrollToActive = useCallback((smooth: boolean) => {
    const container = box.current;
    const el = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !el) return;
    const top = el.offsetTop - container.clientHeight / 3;
    container.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Keep the current sentence in view, unless the reader has just scrolled away to look at
  // something else.
  useEffect(() => {
    if (!visible || active < 0 || !playing) return;
    if (Date.now() - userScrolledAt.current < PAUSE_AFTER_SCROLL_MS) return;
    scrollToActive(true);
  }, [active, visible, playing, scrollToActive]);

  const noteScroll = () => {
    userScrolledAt.current = Date.now();
    if (timed && playing) setAway(true);
  };

  useEffect(() => {
    if (!away) return;
    const t = setTimeout(() => setAway(false), PAUSE_AFTER_SCROLL_MS);
    return () => clearTimeout(t);
  }, [away]);

  let n = -1;
  return (
    <div className="relative">
      <div
        ref={box}
        onWheel={noteScroll}
        onTouchMove={noteScroll}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) noteScroll();
        }}
        tabIndex={0}
        aria-label="Transcript"
        className="relative max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-field/40 p-5 text-[16px] leading-8"
      >
        {paragraphs.map((sentences, p) => (
          <p key={p} className="mb-4 last:mb-0">
            {sentences.map((s) => {
              n++;
              const i = n;
              const on = i === active;
              return (
                <span key={i}>
                  <span
                    data-active={on || undefined}
                    onClick={timed && s.start !== null ? () => onPick(s.start!) : undefined}
                    title={timed ? "Play from here" : undefined}
                    className={`rounded-md box-decoration-clone px-0.5 transition-colors ${timed ? "cursor-pointer hover:bg-nav-on" : ""} ${
                      on ? "bg-[var(--chip-blue-bg)] text-ink shadow-[inset_0_-2px_0_var(--brand)]" : i < active ? "text-ink" : active >= 0 ? "text-ink/80" : ""
                    }`}
                  >
                    {s.text}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      {away && (
        <button
          type="button"
          className="btn-primary absolute right-4 bottom-4 h-9 text-xs shadow-md"
          onClick={() => {
            userScrolledAt.current = 0;
            setAway(false);
            scrollToActive(true);
          }}
        >
          Back to current line
        </button>
      )}
      {timed && <p className="mt-2 text-xs text-muted">Click any sentence to play from there.</p>}
    </div>
  );
}
