import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import { api, type Channel } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";

export function FavoritesPage() {
  const [favorites, setFavorites] = useState<Channel[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await api.favorites();
    setFavorites(response.favorites);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load favorites"));
  }, []);

  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-line bg-panel p-4 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md bg-berry text-white"><Heart /></span>
          <div>
            <h1 className="text-2xl font-bold">Favorites</h1>
            <p className="text-sm text-ink/60">{favorites.length} saved channels</p>
          </div>
        </div>
      </section>
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      <section className="grid gap-3 md:grid-cols-2">
        {favorites.map((channel) => (
          <article key={channel.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-line bg-panel p-3 shadow-soft">
            <Link to={`/channel/${channel.id}`}><ChannelLogo src={channel.logo_url} name={channel.display_name} /></Link>
            <Link to={`/channel/${channel.id}`} className="min-w-0">
              <h2 className="truncate font-bold">{channel.display_name}</h2>
              <p className="truncate text-sm text-ink/60">{channel.group_title}</p>
            </Link>
            <FavoriteButton active onClick={async () => {
              await api.removeFavorite(channel.id);
              await load();
            }} />
          </article>
        ))}
      </section>
    </div>
  );
}
