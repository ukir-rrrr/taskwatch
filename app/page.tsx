import { AppFrame, PageHeader } from "@/components/AppFrame";
import { SessionsView } from "@/components/SessionsView";
import { loadSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const snapshot = loadSnapshot();
  const now = Math.floor(Date.now() / 1000);
  return (
    <AppFrame active="sessions" snapshot={snapshot}>
      <SessionsView
        sessions={snapshot.sessions}
        now={now}
        header={<PageHeader title="セッション" lastCollectedAt={snapshot.lastCollectedAt} />}
      />
    </AppFrame>
  );
}
