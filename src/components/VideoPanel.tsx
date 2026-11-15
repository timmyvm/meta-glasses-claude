"use client";

import { useRef, useState } from "react";
import type { FrameSource, Roi } from "@/lib/frames";

type Props = {
  stream: MediaStream | null;
  imageUrl: string | null;
  roi: Roi | null;
  onRoiChange: (roi: Roi | null) => void;
  onElement: (el: FrameSource | null) => void;
  overlay?: React.ReactNode;
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Tallest the preview may get, as a fraction of the viewport height. */
const MAX_VH = 70;

export function VideoPanel({ stream, imageUrl, roi, onRoiChange, onElement, overlay }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Roi | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const hasSource = Boolean(stream || imageUrl);
  const aspect = size && hasSource ? size.w / size.h : 16 / 9;

  const point = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!hasSource) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = point(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = point(e);
    const s = start.current;
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (draft && draft.w > 0.05 && draft.h > 0.05) onRoiChange(draft);
    setDraft(null);
  };

  const updateSize = (w: number, h: number) => {
    if (w && h) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  };

  const shown = draft ?? roi;
  const lowRes = size ? Math.min(size.w, size.h) < 600 : false;

  return (
    <div className="flex w-full justify-center rounded-xl bg-black ring-1 ring-white/10">
      {/* The box always has the video's exact aspect ratio, so nothing gets
          stretched and crop coordinates map 1:1 onto the real frame. It is as
          wide as the column allows, but never taller than MAX_VH. */}
      <div
        ref={box}
        className="relative touch-none select-none overflow-hidden rounded-xl"
        style={{ aspectRatio: aspect, width: `min(100%, calc(${MAX_VH}vh * ${aspect}))` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {stream && (
          <video
            ref={(el) => {
              if (el && el.srcObject !== stream) {
                el.srcObject = stream;
                void el.play().catch(() => {});
              }
              onElement(el);
            }}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedMetadata={(e) => updateSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            onResize={(e) => updateSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          />
        )}
        {!stream && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={(el) => onElement(el)}
            src={imageUrl}
            alt="Uploaded board"
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => updateSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
        )}
        {!hasSource && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="text-4xl">🕶️</div>
            <p className="text-sm text-zinc-300">Share the video call window to start.</p>
            <p className="max-w-sm text-xs text-zinc-500">
              Start a WhatsApp or Messenger video call from your glasses to this computer, then click{" "}
              <span className="text-zinc-300">Share call window</span>.
            </p>
          </div>
        )}
        {hasSource && size && (
          <div
            className={`pointer-events-none absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] ${lowRes ? "text-amber-300" : "text-zinc-300"}`}
            title={lowRes ? "Low resolution: make the call window bigger" : undefined}
            data-testid="capture-size"
          >
            {size.w}×{size.h}
            {lowRes && " · low-res"}
          </div>
        )}
        {shown && (
          <div
            className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{
              left: `${shown.x * 100}%`,
              top: `${shown.y * 100}%`,
              width: `${shown.w * 100}%`,
              height: `${shown.h * 100}%`,
            }}
          >
            {size && <CropSize w={Math.round(shown.w * size.w)} h={Math.round(shown.h * size.h)} />}
          </div>
        )}
        {overlay}
      </div>
    </div>
  );
}

/** Real source pixels inside the crop box: this is the detail Claude gets. */
function CropSize({ w, h }: { w: number; h: number }) {
  const small = Math.min(w, h) < 300;
  return (
    <span
      className={`absolute left-0 top-0 whitespace-nowrap rounded-br-md px-1.5 py-0.5 font-mono text-[10px] ${small ? "bg-amber-400 text-amber-950" : "bg-emerald-400 text-emerald-950"}`}
      data-testid="crop-size"
    >
      {w}×{h}px{small ? " · tiny, make the call video bigger" : ""}
    </span>
  );
}
