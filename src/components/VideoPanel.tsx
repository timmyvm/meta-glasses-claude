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

export function VideoPanel({ stream, imageUrl, roi, onRoiChange, onElement, overlay }: Props) {
  const [aspect, setAspect] = useState(16 / 9);
  const [draft, setDraft] = useState<Roi | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const point = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!stream && !imageUrl) return;
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

  const shown = draft ?? roi;
  const hasSource = Boolean(stream || imageUrl);

  return (
    <div
      ref={box}
      className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-black ring-1 ring-white/10"
      style={{ aspectRatio: aspect, maxHeight: "62vh" }}
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
          className="absolute inset-0 h-full w-full object-fill"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          }}
          onResize={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          }}
        />
      )}
      {!stream && imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={(el) => onElement(el)}
          src={imageUrl}
          alt="Uploaded board"
          className="absolute inset-0 h-full w-full object-fill"
          onLoad={(e) => {
            const img = e.currentTarget;
            setAspect(img.naturalWidth / img.naturalHeight);
          }}
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
      {shown && (
        <div
          className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: `${shown.w * 100}%`,
            height: `${shown.h * 100}%`,
          }}
        />
      )}
      {overlay}
    </div>
  );
}
