import Terminal from "@/components/Terminal";
import type { WorldFixture } from "@/lib/viewTypes";
import worldData from "@/fixtures/world.json";

export default function Page() {
  const fixture = worldData as unknown as WorldFixture;
  return <Terminal fixture={fixture} />;
}
