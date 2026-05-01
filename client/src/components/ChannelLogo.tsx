import { Tv } from "lucide-react";

export function ChannelLogo({ src, name, size = "md" }: { src?: string; name: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "size-10" : size === "lg" ? "size-16" : "size-12";
  return (
    <div className={`${sizeClass} grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-white`}>
      {src ? (
        <img src={src} alt="" className="max-h-full max-w-full object-contain p-1" loading="lazy" />
      ) : (
        <Tv size={size === "lg" ? 28 : 20} className="text-slate-400" aria-label={name} />
      )}
    </div>
  );
}
