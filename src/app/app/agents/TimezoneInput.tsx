"use client";

import { useEffect, useRef } from "react";

export function TimezoneInput({ initialValue }: { initialValue: string }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimeZone && inputRef.current) {
      inputRef.current.value = browserTimeZone;
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="hidden"
      name="timeZone"
      defaultValue={initialValue}
    />
  );
}
