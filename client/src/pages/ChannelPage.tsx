import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, type Channel, type Program } from "../api/client";
import { ChannelLogo } from "../components/ChannelLogo";
import { FavoriteButton } from "../components/FavoriteButton";
import { ProgramBar } from "../components/ProgramBar";
import { VideoPlayer } from "../components/VideoPlayer";
import { formatTime } from "../utils/time";

export function ChannelPage() {
  const { id = "" } = useParams();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await api.channelGuide(id);
    setChannel(response.channel);
    setPrograms(response.programs);
  };

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load channel"));
  }, [id]);

  if (error) return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>;
  if (!channel) return <div className="text-sm text-slate-500">Loading channel...</div>;

  const current = programs.find((program) => new Date(program.start_time) <= new Date() && new Date(program.end_time) > new Date());

  return (
    <div className="grid gap-4">
      <Link to="/" className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold">
        <ArrowLeft size={17} /> Guide
      </Link>
      <section className="rounded-md border border-line bg-white p-4 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ChannelLogo src={channel.logo_url} name={channel.display_name} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{channel.display_name}</h1>
              <p className="truncate text-sm text-slate-500">{channel.group_title}</p>
            </div>
          </div>
          <FavoriteButton
            active={Boolean(channel.favorite)}
            onClick={async () => {
              if (channel.favorite) await api.removeFavorite(channel.id);
              else await api.addFavorite(channel.id);
              await load();
            }}
          />
        </div>
        <VideoPlayer src={channel.stream_url} title={channel.display_name} />
        {current && (
          <div className="mt-4 rounded-md border border-line bg-mist p-4">
            <div className="text-sm font-semibold text-slate-500">Now playing</div>
            <h2 className="mt-1 text-xl font-bold">{current.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{current.description}</p>
            <ProgramBar start={current.start_time} end={current.end_time} />
          </div>
        )}
      </section>

      <section className="rounded-md border border-line bg-white p-4 shadow-soft">
        <h2 className="text-xl font-bold">Upcoming</h2>
        <div className="mt-3 grid gap-2">
          {programs.map((program) => (
            <article key={program.id} className="rounded-md border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{program.title}</h3>
                  <p className="line-clamp-2 text-sm text-slate-600">{program.description || program.subtitle}</p>
                </div>
                <div className="shrink-0 text-right text-xs font-semibold text-slate-500">
                  {formatTime(program.start_time)}<br />{formatTime(program.end_time)}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
