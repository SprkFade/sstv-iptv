import { Heart } from "lucide-react";

export function FavoriteButton({ active, onClick, tone = "default" }: { active?: boolean; onClick: () => void; tone?: "default" | "dark" }) {
  const inactiveClass = tone === "dark"
    ? "border-white/10 bg-black/35 text-white/55 hover:bg-white/10"
    : "border-line bg-panel text-ink/60";
  return (
    <button
      className={`grid size-10 place-items-center rounded-md border ${active ? "border-berry bg-berry text-white" : inactiveClass}`}
      onClick={onClick}
      title={active ? "Remove favorite" : "Add favorite"}
    >
      <Heart size={18} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
