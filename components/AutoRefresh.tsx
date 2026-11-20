"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** collect が SQLite を更新するので、画面は定期的にサーバー側で読み直す */
export function AutoRefresh({ intervalSec = 30 }: { intervalSec?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalSec * 1000);
    return () => clearInterval(id);
  }, [router, intervalSec]);
  return null;
}
