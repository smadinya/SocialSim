"use client";

import type { FeedItem } from "@/lib/reducer";

interface Props {
  feed: FeedItem[];
}

export default function EventFeed({ feed }: Props) {
  return (
    <section className="panel feed">
      <div className="panel-head">
        <span>Word travels</span>
        <span style={{ color: "var(--muted)" }}>off-scene</span>
      </div>
      <div className="panel-body">
        {feed.length === 0 && (
          <div className="feed-empty">
            Nothing's reached you yet. Things happen off scene as turns pass.
          </div>
        )}
        {feed.map((item) => (
          <div className="feed-item" key={item.id}>
            <div className="stamp">turn {item.turn}</div>
            <div>{item.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
