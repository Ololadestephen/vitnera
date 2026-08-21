import { Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatEther } from "viem";
import { Busy, Status } from "../components/Status";
import { useRooms } from "../hooks/useRooms";
import { roomStatuses } from "../lib/contract";

export function DirectoryPage() {
  const rooms = useRooms();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "review">("all");
  const visible = useMemo(
    () => (rooms.data ?? []).filter((room) => {
      const text = `${room.metadata?.title ?? ""} ${room.metadata?.assetLocation ?? ""} ${room.metadata?.issuerDisplayName ?? ""} ${room.metadata?.assetType ?? ""}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());
      const matchesFilter = filter === "all" || (filter === "active" ? room.status === 1 : room.status === 0);
      return matchesSearch && matchesFilter;
    }),
    [rooms.data, search, filter],
  );

  return (
    <div className="page page-enter">
      <div className="page-heading split-heading">
        <div><p className="eyebrow">Private asset directory</p><h1>RWA data rooms</h1><p>Review public asset facts. Protected evidence remains encrypted until approval.</p></div>
        <div className="chain-stamp"><ShieldCheck /> BOT Chain evidence</div>
      </div>
      <div className="directory-tools">
        <label><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issuer, asset, or location" /></label>
        <div className="segmented">
          {(["all", "active", "review"] as const).map((value) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{value === "review" ? "Needs review" : value}</button>)}
        </div>
      </div>
      {rooms.isLoading && <div className="empty-state"><Busy label="Reading BOT Chain" /></div>}
      {rooms.error && <div className="notice error">{rooms.error.message}</div>}
      {!rooms.isLoading && visible.length === 0 && <div className="empty-state">No data rooms match this view.</div>}
      <div className="room-grid">
        {visible.map((room) => (
          <article className="room-card" key={room.id.toString()}>
            <div className="card-top"><span>ROOM {room.id.toString().padStart(3, "0")}</span><Status tone={room.status === 1 ? "good" : "warn"}>{roomStatuses[room.status]}</Status></div>
            <div className="room-card-body">
              <p className="overline">{room.metadata ? [room.metadata.assetType.replaceAll("_", " "), room.metadata.assetLocation].filter(Boolean).join(" · ") : "Metadata unavailable"}</p>
              <h2>{room.metadata?.title ?? `Data room ${room.id}`}</h2>
              <p>{room.metadata?.summary ?? "The metadata URI could not be verified."}</p>
            </div>
            <div className="room-card-footer">
              <div><span>ACCESS</span><strong>{formatEther(room.accessPrice)} BOT</strong></div>
              <div><span>VERSION</span><strong>v{room.version.toString()}</strong></div>
              <Link className="button secondary small" to={`/rooms/${room.id}`}>Inspect room</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
