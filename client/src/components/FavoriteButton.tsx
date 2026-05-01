import { Heart } from "lucide-react";

export function FavoriteButton({ active, onClick }: { active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`grid size-10 place-items-center rounded-md border ${active ? "border-berry bg-berry text-white" : "border-line bg-white text-slate-500"}`}
      onClick={onClick}
      title={active ? "Remove favorite" : "Add favorite"}
    >
      <Heart size={18} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
